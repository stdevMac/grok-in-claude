#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { resolveReviewTarget } from "./lib/git.mjs";
import {
  getGrokAuthStatus,
  getGrokAvailability,
  parseGrokJsonOutput,
  runGrok,
  spawnGrokBackground
} from "./lib/grok.mjs";
import {
  generateJobId,
  getLastTaskSessionId,
  listJobs,
  nowIso,
  readJobFile,
  resolveJob,
  resolveJobLogFile,
  resolveJobPidFile,
  setLastTaskSessionId,
  upsertJob,
  writeJobFile
} from "./lib/jobs.mjs";
import { readPidFile, terminateProcessTree, writePidFile } from "./lib/process.mjs";
import {
  renderBackgroundStarted,
  renderCancelReport,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult
} from "./lib/render.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const VALID_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MODEL_ALIASES = new Map([
  ["fast", "grok-composer-2.5-fast"],
  ["default", "grok-4.5"],
  ["grok", "grok-4.5"]
]);

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/grok-companion.mjs setup [--json]",
      "  node scripts/grok-companion.mjs task [--background] [--write|--read-only] [--resume-last|--fresh] [--model <id>] [--effort <level>] [--worktree] [prompt]",
      "  node scripts/grok-companion.mjs task-resume-candidate [--json]",
      "  node scripts/grok-companion.mjs review [--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <id>] [--effort <level>] [focus text]",
      "  node scripts/grok-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/grok-companion.mjs result [job-id] [--json]",
      "  node scripts/grok-companion.mjs cancel [job-id] [--json]"
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function normalizeModel(model) {
  if (model == null) {
    return null;
  }
  const normalized = String(model).trim();
  if (!normalized) {
    return null;
  }
  return MODEL_ALIASES.get(normalized.toLowerCase()) ?? normalized;
}

function normalizeEffort(effort) {
  if (effort == null) {
    return null;
  }
  const normalized = String(effort).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!VALID_EFFORTS.has(normalized)) {
    throw new Error(`Invalid --effort value: ${effort}. Expected one of ${[...VALID_EFFORTS].join(", ")}`);
  }
  return normalized === "max" ? "xhigh" : normalized;
}

function titleFromPrompt(prompt, fallback = "Grok task") {
  const compact = String(prompt ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) {
    return fallback;
  }
  return compact.length > 72 ? `${compact.slice(0, 71)}…` : compact;
}

function expandArgv(argv) {
  if (argv.length === 1 && typeof argv[0] === "string" && /\s/.test(argv[0]) && !argv[0].startsWith("-")) {
    // Common Claude Code pattern: entire arg string as one positional.
    // Leave as-is for prompts. Commands parse flags from full argv.
  }
  if (argv.length === 1 && typeof argv[0] === "string" && argv[0].includes("--")) {
    return splitRawArgumentString(argv[0]);
  }
  return argv;
}

function writePromptFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-companion-"));
  const filePath = path.join(dir, "prompt.md");
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function finalizeForegroundJob(cwd, job, grokResult) {
  const parsed = grokResult.parsed;
  const ok = grokResult.ok;
  const text = parsed?.text || (!ok ? parsed?.error || grokResult.stderr : "") || grokResult.stdout;
  const sessionId = parsed?.sessionId ?? null;
  const status = ok ? "completed" : "failed";
  const finishedAt = nowIso();
  const summary = titleFromPrompt(text, status);

  const fullJob = {
    ...job,
    status,
    finishedAt,
    updatedAt: finishedAt,
    summary,
    resultText: text,
    grokSessionId: sessionId,
    exitCode: grokResult.status,
    error: ok ? null : parsed?.error || grokResult.stderr || `Grok exited with code ${grokResult.status}`,
    stderr: grokResult.stderr || null
  };

  upsertJob(cwd, {
    id: job.id,
    status,
    finishedAt,
    summary,
    grokSessionId: sessionId,
    exitCode: fullJob.exitCode,
    error: fullJob.error
  });
  writeJobFile(cwd, fullJob);

  if (sessionId && job.kind === "task") {
    setLastTaskSessionId(cwd, sessionId);
  }

  return fullJob;
}

function maybeFinalizeBackgroundJob(cwd, job) {
  if (!job || job.status !== "running") {
    return job;
  }

  const resultPath = job.resultFile;
  if (!resultPath || !fs.existsSync(resultPath)) {
    return job;
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch {
    return job;
  }

  const parsed = parseGrokJsonOutput(payload.stdout || "");
  const ok = payload.exitCode === 0 && parsed.ok;
  const text = parsed.text || parsed.error || payload.stdout || "";
  const sessionId = parsed.sessionId ?? null;
  const status = ok ? "completed" : "failed";
  const finishedAt = payload.finishedAt || nowIso();

  const fullJob = {
    ...job,
    status,
    finishedAt,
    updatedAt: finishedAt,
    summary: titleFromPrompt(text, status),
    resultText: text,
    grokSessionId: sessionId,
    exitCode: payload.exitCode,
    error: ok ? null : parsed.error || payload.stderr || `Grok exited with code ${payload.exitCode}`,
    stderr: payload.stderr || null
  };

  upsertJob(cwd, {
    id: job.id,
    status,
    finishedAt,
    summary: fullJob.summary,
    grokSessionId: sessionId,
    exitCode: fullJob.exitCode,
    error: fullJob.error
  });
  writeJobFile(cwd, fullJob);

  if (sessionId && job.kind === "task") {
    setLastTaskSessionId(cwd, sessionId);
  }

  return fullJob;
}

async function commandSetup(argv) {
  const { options } = parseArgs(argv, { booleanOptions: ["json"] });
  const availability = getGrokAvailability();
  const auth = availability.available
    ? getGrokAuthStatus()
    : { authenticated: false, detail: availability.reason };

  const nextSteps = [];
  if (!availability.available) {
    nextSteps.push("Install the Grok Build CLI and ensure `grok` is on your PATH.");
    nextSteps.push("Typical install location: `~/.grok/bin/grok`.");
  } else if (!auth.authenticated) {
    nextSteps.push("Run `grok login` (or `!grok login` inside Claude Code).");
  }

  const payload = {
    ready: Boolean(availability.available && auth.authenticated),
    available: availability.available,
    binary: availability.binary,
    version: availability.version,
    authenticated: auth.authenticated,
    authDetail: auth.detail,
    nextSteps,
    pluginRoot: ROOT_DIR
  };

  outputResult(options.json ? payload : renderSetupReport(payload), Boolean(options.json));
  process.exitCode = payload.ready ? 0 : 1;
}

async function commandTaskResumeCandidate(argv) {
  const { options } = parseArgs(argv, { booleanOptions: ["json"] });
  const cwd = resolveWorkspaceRoot(process.cwd());
  const sessionId = getLastTaskSessionId(cwd);
  const payload = {
    available: Boolean(sessionId),
    sessionId,
    workspaceRoot: cwd
  };
  outputResult(payload, true);
}

async function commandTask(argv) {
  const expanded = expandArgv(argv);
  const { options, positionals } = parseArgs(expanded, {
    booleanOptions: ["background", "write", "read-only", "resume-last", "fresh", "worktree", "json", "verbatim"],
    valueOptions: ["model", "effort", "max-turns", "cwd"],
    aliasMap: {
      "read-only": "read-only",
      "resume-last": "resume-last",
      "max-turns": "max-turns"
    }
  });

  const cwd = resolveWorkspaceRoot(options.cwd || process.cwd());
  const prompt = positionals.join(" ").trim();
  if (!prompt) {
    throw new Error("Missing task prompt. Example: task --write fix the failing tests");
  }

  // Default write-capable for rescue tasks unless --read-only.
  const writeMode = !options["read-only"];
  const model = normalizeModel(options.model);
  const effort = normalizeEffort(options.effort);
  const background = Boolean(options.background);

  let resume = null;
  if (options["resume-last"] && !options.fresh) {
    resume = getLastTaskSessionId(cwd);
    if (!resume) {
      throw new Error("No previous Grok task session found for this repository. Run without --resume-last.");
    }
  }

  const jobId = generateJobId("task");
  const logFile = resolveJobLogFile(cwd, jobId);
  const resultFile = path.join(path.dirname(logFile), `${jobId}.result.json`);
  const promptFile = writePromptFile(prompt);

  const job = {
    id: jobId,
    kind: "task",
    title: titleFromPrompt(prompt),
    prompt,
    status: background ? "running" : "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    write: writeMode,
    model,
    effort,
    resume,
    workspaceRoot: cwd,
    logFile,
    resultFile,
    promptFile
  };

  upsertJob(cwd, {
    id: jobId,
    kind: "task",
    title: job.title,
    status: "running",
    write: writeMode,
    model,
    summary: job.title,
    logFile,
    resultFile
  });
  writeJobFile(cwd, job);
  fs.writeFileSync(logFile, "", "utf8");

  const grokOptions = {
    promptFile,
    cwd,
    write: writeMode,
    model,
    effort,
    resume,
    maxTurns: options["max-turns"] ? Number(options["max-turns"]) : undefined,
    worktree: Boolean(options.worktree),
    verbatim: Boolean(options.verbatim),
    resultFile,
    logFile
  };

  if (background) {
    const spawned = spawnGrokBackground(grokOptions);
    const pidFile = resolveJobPidFile(cwd, jobId);
    writePidFile(pidFile, spawned.pid);
    const runningJob = {
      ...job,
      pid: spawned.pid,
      pidFile,
      binary: spawned.binary,
      args: spawned.args
    };
    upsertJob(cwd, { id: jobId, pid: spawned.pid, status: "running" });
    writeJobFile(cwd, runningJob);

    const payload = {
      jobId,
      kind: "task",
      pid: spawned.pid,
      title: job.title,
      status: "running"
    };
    outputResult(options.json ? payload : renderBackgroundStarted(payload), Boolean(options.json));
    return;
  }

  const grokResult = runGrok(grokOptions);
  const finished = finalizeForegroundJob(cwd, job, grokResult);
  const payload = {
    jobId,
    kind: "task",
    status: finished.status,
    model,
    write: writeMode,
    grokSessionId: finished.grokSessionId,
    text: finished.resultText,
    error: finished.error
  };
  outputResult(options.json ? payload : renderTaskResult(payload), Boolean(options.json));
  process.exitCode = finished.status === "completed" ? 0 : 1;
}

function buildReviewPrompt(target, focusText) {
  const focus = focusText?.trim()
    ? `\n\nAdditional review focus from the user:\n${focusText.trim()}\n`
    : "";

  return `You are performing a read-only code review. Do not modify files.

Review target: ${target.label}
${target.branch ? `Current branch: ${target.branch}` : ""}
${target.baseRef ? `Base ref: ${target.baseRef}` : ""}

## Git status / summary
${target.status || "(clean)"}

## Diff
${target.diff || "(no diff content captured; inspect the repository with read-only tools if needed)"}
${focus}
## Instructions
- Identify bugs, regressions, security issues, missing tests, and design risks.
- Cite file paths and line numbers when possible.
- Order findings by severity (critical, high, medium, low).
- End with a short verdict and concrete next steps.
- Do not implement fixes.`;
}

async function commandReview(argv) {
  const expanded = expandArgv(argv);
  const { options, positionals } = parseArgs(expanded, {
    booleanOptions: ["background", "json", "wait"],
    valueOptions: ["base", "scope", "model", "effort", "cwd"]
  });

  const cwd = resolveWorkspaceRoot(options.cwd || process.cwd());
  const focusText = positionals.join(" ").trim();
  const target = resolveReviewTarget(cwd, {
    base: options.base,
    scope: options.scope || "auto"
  });

  if (target.empty) {
    const message = "Nothing to review: working tree/branch diff looks empty.\n";
    outputResult(options.json ? { empty: true, message } : message, Boolean(options.json));
    return;
  }

  const prompt = buildReviewPrompt(target, focusText);
  const model = normalizeModel(options.model);
  const effort = normalizeEffort(options.effort);
  const background = Boolean(options.background);
  const jobId = generateJobId("review");
  const logFile = resolveJobLogFile(cwd, jobId);
  const resultFile = path.join(path.dirname(logFile), `${jobId}.result.json`);
  const promptFile = writePromptFile(prompt);

  const job = {
    id: jobId,
    kind: "review",
    title: titleFromPrompt(focusText || `Review ${target.label}`, "Grok review"),
    prompt,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    write: false,
    model,
    effort,
    workspaceRoot: cwd,
    logFile,
    resultFile,
    promptFile,
    reviewTarget: {
      kind: target.kind,
      label: target.label,
      baseRef: target.baseRef || null
    }
  };

  upsertJob(cwd, {
    id: jobId,
    kind: "review",
    title: job.title,
    status: "running",
    write: false,
    model,
    summary: job.title,
    logFile,
    resultFile
  });
  writeJobFile(cwd, job);
  fs.writeFileSync(logFile, "", "utf8");

  const grokOptions = {
    promptFile,
    cwd,
    write: false,
    model,
    effort,
    resultFile,
    logFile
  };

  if (background) {
    const spawned = spawnGrokBackground(grokOptions);
    const pidFile = resolveJobPidFile(cwd, jobId);
    writePidFile(pidFile, spawned.pid);
    const runningJob = { ...job, pid: spawned.pid, pidFile, binary: spawned.binary, args: spawned.args };
    upsertJob(cwd, { id: jobId, pid: spawned.pid, status: "running" });
    writeJobFile(cwd, runningJob);
    const payload = { jobId, kind: "review", pid: spawned.pid, title: job.title, status: "running" };
    outputResult(options.json ? payload : renderBackgroundStarted(payload), Boolean(options.json));
    return;
  }

  const grokResult = runGrok(grokOptions);
  const finished = finalizeForegroundJob(cwd, job, grokResult);
  const payload = {
    jobId,
    kind: "review",
    status: finished.status,
    model,
    write: false,
    grokSessionId: finished.grokSessionId,
    text: finished.resultText,
    error: finished.error
  };
  outputResult(options.json ? payload : renderTaskResult(payload), Boolean(options.json));
  process.exitCode = finished.status === "completed" ? 0 : 1;
}

async function commandStatus(argv) {
  const { options, positionals } = parseArgs(argv, {
    booleanOptions: ["json", "all"],
    valueOptions: ["timeout-ms"]
  });
  const cwd = resolveWorkspaceRoot(process.cwd());
  const jobId = positionals[0] || null;

  let jobs = listJobs(cwd).map((job) => {
    const stored = readJobFile(cwd, job.id) || job;
    return maybeFinalizeBackgroundJob(cwd, stored);
  });

  if (!options.all) {
    jobs = jobs.slice(0, 15);
  }

  if (jobId) {
    const job = maybeFinalizeBackgroundJob(cwd, resolveJob(cwd, jobId));
    const payload = job;
    outputResult(options.json ? payload : renderStatusReport([job], { jobId }), Boolean(options.json));
    return;
  }

  const payload = { jobs, workspaceRoot: cwd };
  outputResult(options.json ? payload : renderStatusReport(jobs), Boolean(options.json));
}

async function commandResult(argv) {
  const { options, positionals } = parseArgs(argv, { booleanOptions: ["json"] });
  const cwd = resolveWorkspaceRoot(process.cwd());
  const jobId = positionals[0] || null;
  let job = resolveJob(cwd, jobId);
  job = maybeFinalizeBackgroundJob(cwd, readJobFile(cwd, job.id) || job);
  outputResult(options.json ? job : renderStoredJobResult(job), Boolean(options.json));
  process.exitCode = job.status === "completed" ? 0 : job.status === "running" ? 0 : 1;
}

async function commandCancel(argv) {
  const { options, positionals } = parseArgs(argv, { booleanOptions: ["json"] });
  const cwd = resolveWorkspaceRoot(process.cwd());
  const jobId = positionals[0] || null;
  let job = resolveJob(cwd, jobId);
  job = readJobFile(cwd, job.id) || job;

  if (job.status !== "running") {
    const payload = { jobId: job.id, cancelled: false, reason: `Job is already ${job.status}` };
    outputResult(options.json ? payload : `Job \`${job.id}\` is already ${job.status}.\n`, Boolean(options.json));
    return;
  }

  const pid = job.pid ?? readPidFile(resolveJobPidFile(cwd, job.id));
  const killed = pid ? terminateProcessTree(pid, "SIGTERM") : false;

  const finishedAt = nowIso();
  const fullJob = {
    ...job,
    status: "cancelled",
    finishedAt,
    updatedAt: finishedAt,
    summary: "Cancelled by user",
    error: "Cancelled"
  };
  upsertJob(cwd, {
    id: job.id,
    status: "cancelled",
    finishedAt,
    summary: fullJob.summary,
    error: fullJob.error
  });
  writeJobFile(cwd, fullJob);

  const payload = { jobId: job.id, cancelled: true, killed, pid };
  outputResult(options.json ? payload : renderCancelReport(job, killed), Boolean(options.json));
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);

  if (!command || command === "-h" || command === "--help" || command === "help") {
    printUsage();
    return;
  }

  try {
    switch (command) {
      case "setup":
        await commandSetup(rest);
        break;
      case "task":
        await commandTask(rest);
        break;
      case "task-resume-candidate":
        await commandTaskResumeCandidate(rest);
        break;
      case "review":
        await commandReview(rest);
        break;
      case "status":
        await commandStatus(rest);
        break;
      case "result":
        await commandResult(rest);
        break;
      case "cancel":
        await commandCancel(rest);
        break;
      default:
        printUsage();
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

await main();
