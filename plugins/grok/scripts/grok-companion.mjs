#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { collectStopGateContext, resolveReviewTarget } from "./lib/git.mjs";
import {
  getGrokAuthStatus,
  getGrokAvailability,
  humanizeGrokFailure,
  parseGrokJsonOutput,
  runGrok,
  spawnGrokBackground
} from "./lib/grok.mjs";
import {
  AmbiguousJobError,
  generateJobId,
  getConfig,
  getLastTaskSessionId,
  listJobs,
  listRunningJobs,
  listTaskSessions,
  nowIso,
  readJobFile,
  readJobProgress,
  recordTaskSession,
  resolveJob,
  resolveJobLogFile,
  resolveJobPidFile,
  resolveJobProgressFile,
  setConfig,
  tailLog,
  upsertJob,
  writeJobFile
} from "./lib/jobs.mjs";
import {
  buildImagePrompt,
  buildVideoPrompt,
  collectMediaArtifacts,
  extractArtifactPaths,
  resolveMediaOutputDir
} from "./lib/media.mjs";
import { readPidFile, terminateProcessTree, writePidFile } from "./lib/process.mjs";
import {
  renderBackgroundStarted,
  renderCancelReport,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult,
  renderTransferReport
} from "./lib/render.mjs";
import {
  buildStructuredReviewPrompt,
  getReviewSchemaPath,
  reviewHasBlockingFindings,
  tryParseStructuredReview
} from "./lib/review.mjs";
import { buildTransferPlan } from "./lib/transfer.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const VALID_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MODEL_ALIASES = new Map([
  ["fast", "grok-composer-2.5-fast"],
  ["default", "grok-4.5"],
  ["deep", "grok-4.5"],
  ["grok", "grok-4.5"]
]);
const PRESET_EFFORT = new Map([
  ["deep", "high"]
]);

function printUsage() {
  console.log(
    [
      "Usage:",
      "  setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  task [--background] [--read-only] [--resume-last|--resume-session <id>|--fresh]",
      "       [--model <id|fast|deep>] [--effort <level>] [--worktree [name]] [--check]",
      "       [--best-of-n <n>] [prompt]",
      "  task-resume-candidate [--json]",
      "  review [--background] [--adversarial] [--base <ref>] [--scope auto|working-tree|branch]",
      "         [--pr <number>] [--model <id>] [--effort <level>] [focus]",
      "  image [--background] [--edit <path>] [--aspect <ratio>] [--model <id>] [prompt]",
      "  video [--background] [--image <path>] [--ref <path>]... [--duration 6|10]",
      "        [--aspect <ratio>] [--model <id>] [prompt]",
      "  transfer [--source <claude-transcript.jsonl>] [--json]",
      "  stop-gate-review [--json]",
      "  status [job-id] [--all] [--json]",
      "  result [job-id] [--json]",
      "  cancel [job-id] [--json]"
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

function normalizeEffort(effort, modelAlias) {
  if (effort == null && modelAlias && PRESET_EFFORT.has(String(modelAlias).toLowerCase())) {
    return PRESET_EFFORT.get(String(modelAlias).toLowerCase());
  }
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

function enrichJob(cwd, job) {
  if (!job) {
    return job;
  }
  const progress = readJobProgress(cwd, job.id);
  const logTail = tailLog(job.logFile, 12);
  return { ...job, progress, logTail };
}

function resolveMediaArtifactsForJob(job, text, sessionId) {
  const cwd = job.workspaceRoot || process.cwd();
  const kind = job.kind === "video" ? "video" : "image";
  const outputDir = job.mediaDir || resolveMediaOutputDir(cwd, kind);
  const startedMs = Date.parse(job.createdAt || "") || Date.now() - 120_000;
  return collectMediaArtifacts({
    cwd,
    kind,
    outputDir,
    sessionId,
    sinceMs: startedMs,
    text
  });
}

function finalizeJob(cwd, job, grokResult, extras = {}) {
  const parsed = grokResult.parsed;
  const ok = grokResult.ok;
  const text = parsed?.text || (!ok ? parsed?.error || grokResult.stderr : "") || grokResult.stdout;
  const sessionId = parsed?.sessionId ?? null;
  const status = ok ? "completed" : "failed";
  const finishedAt = nowIso();
  const review = extras.parseReview ? tryParseStructuredReview(text) : null;
  let artifacts = extras.artifacts || extractArtifactPaths(text, job.workspaceRoot || cwd);
  if (job.kind === "image" || job.kind === "video") {
    artifacts = resolveMediaArtifactsForJob(job, text, sessionId);
  }
  const summary = review
    ? `${review.verdict}: ${titleFromPrompt(review.summary, status)}`
    : titleFromPrompt(text, status);

  const error = ok
    ? null
    : humanizeGrokFailure({
        parsedError: parsed?.error,
        stderr: grokResult.stderr,
        stdout: grokResult.stdout,
        exitCode: grokResult.status
      });

  const fullJob = {
    ...job,
    status,
    finishedAt,
    updatedAt: finishedAt,
    summary,
    resultText: text,
    review,
    artifacts,
    grokSessionId: sessionId,
    exitCode: grokResult.status,
    error,
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

  if (sessionId && (job.kind === "task" || job.kind === "rescue")) {
    recordTaskSession(cwd, {
      sessionId,
      jobId: job.id,
      title: job.title || fullJob.summary,
      kind: job.kind
    });
  }

  return fullJob;
}

function maybeFinalizeBackgroundJob(cwd, job) {
  if (!job || job.status !== "running") {
    return enrichJob(cwd, job);
  }

  const resultPath = job.resultFile;
  if (!resultPath || !fs.existsSync(resultPath)) {
    return enrichJob(cwd, job);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch {
    return enrichJob(cwd, job);
  }

  const parsed = parseGrokJsonOutput(payload.stdout || "");
  const ok = payload.exitCode === 0 && parsed.ok;
  const text = parsed.text || parsed.error || payload.stdout || "";
  const sessionId = parsed.sessionId ?? payload.sessionId ?? null;
  const status = ok ? "completed" : "failed";
  const finishedAt = payload.finishedAt || nowIso();
  const review = job.kind === "review" || job.kind === "adversarial-review" || job.kind === "stop-gate"
    ? tryParseStructuredReview(text)
    : null;
  const artifacts =
    job.kind === "image" || job.kind === "video"
      ? resolveMediaArtifactsForJob(job, text, sessionId)
      : extractArtifactPaths(text, job.workspaceRoot || cwd);

  const error = ok
    ? null
    : humanizeGrokFailure({
        parsedError: parsed.error,
        stderr: payload.stderr,
        stdout: payload.stdout,
        exitCode: payload.exitCode
      });

  const fullJob = {
    ...job,
    status,
    finishedAt,
    updatedAt: finishedAt,
    summary: review ? `${review.verdict}: ${titleFromPrompt(review.summary, status)}` : titleFromPrompt(text, status),
    resultText: text,
    review,
    artifacts: [...new Set(artifacts)],
    grokSessionId: sessionId,
    exitCode: payload.exitCode,
    error,
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

  if (sessionId && (job.kind === "task" || job.kind === "rescue")) {
    recordTaskSession(cwd, {
      sessionId,
      jobId: job.id,
      title: job.title || fullJob.summary,
      kind: job.kind
    });
  }

  return enrichJob(cwd, fullJob);
}

function createJobShell(cwd, { kind, title, prompt, write, model, effort, extras = {} }) {
  const jobId = generateJobId(kind === "adversarial-review" ? "review" : kind);
  const logFile = resolveJobLogFile(cwd, jobId);
  const resultFile = path.join(path.dirname(logFile), `${jobId}.result.json`);
  const progressFile = resolveJobProgressFile(cwd, jobId);
  const promptFile = writePromptFile(prompt);
  const job = {
    id: jobId,
    kind,
    title,
    prompt,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    write: Boolean(write),
    model,
    effort,
    workspaceRoot: cwd,
    logFile,
    resultFile,
    progressFile,
    promptFile,
    ...extras
  };

  upsertJob(cwd, {
    id: jobId,
    kind,
    title,
    status: "running",
    write: Boolean(write),
    model,
    summary: title,
    logFile,
    resultFile
  });
  writeJobFile(cwd, job);
  fs.writeFileSync(logFile, "", "utf8");
  fs.writeFileSync(progressFile, `${JSON.stringify({ phase: "queued", message: "queued", updatedAt: nowIso() }, null, 2)}\n`);
  return job;
}

function runOrBackground(cwd, job, grokOptions, { background, json, renderPayload }) {
  if (background) {
    const spawned = spawnGrokBackground({
      ...grokOptions,
      resultFile: job.resultFile,
      logFile: job.logFile,
      progressFile: job.progressFile
    });
    const pidFile = resolveJobPidFile(cwd, job.id);
    writePidFile(pidFile, spawned.pid);
    const runningJob = {
      ...job,
      pid: spawned.pid,
      pidFile,
      binary: spawned.binary,
      args: spawned.args
    };
    upsertJob(cwd, { id: job.id, pid: spawned.pid, status: "running" });
    writeJobFile(cwd, runningJob);
    const otherRunning = listRunningJobs(cwd)
      .filter((item) => item.id !== job.id)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title || item.summary || null
      }));
    const payload = {
      jobId: job.id,
      kind: job.kind,
      pid: spawned.pid,
      title: job.title,
      status: "running",
      concurrent: true,
      otherRunning
    };
    outputResult(json ? payload : renderBackgroundStarted(payload), Boolean(json));
    return null;
  }

  const grokResult = runGrok(grokOptions);
  const finished = finalizeJob(cwd, job, grokResult, renderPayload?.finalizeExtras || {});
  const payload = renderPayload?.build
    ? renderPayload.build(finished, grokResult)
    : {
        jobId: job.id,
        kind: job.kind,
        status: finished.status,
        model: job.model,
        write: job.write,
        grokSessionId: finished.grokSessionId,
        text: finished.resultText,
        error: finished.error,
        review: finished.review,
        artifacts: finished.artifacts,
        bestOfN: job.bestOfN,
        worktree: job.worktree,
        check: job.check
      };
  outputResult(json ? payload : renderTaskResult(payload), Boolean(json));
  process.exitCode = finished.status === "completed" ? 0 : 1;
  return finished;
}

async function commandSetup(argv) {
  const { options } = parseArgs(argv, {
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"]
  });
  const cwd = resolveWorkspaceRoot(process.cwd());

  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Pass only one of --enable-review-gate or --disable-review-gate");
  }
  if (options["enable-review-gate"]) {
    setConfig(cwd, { stopReviewGate: true });
  } else if (options["disable-review-gate"]) {
    setConfig(cwd, { stopReviewGate: false });
  }

  const availability = getGrokAvailability();
  const auth = availability.available
    ? getGrokAuthStatus()
    : { authenticated: false, detail: availability.reason };
  const config = getConfig(cwd);

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
    stopReviewGate: Boolean(config.stopReviewGate),
    nextSteps,
    pluginRoot: ROOT_DIR
  };

  outputResult(options.json ? payload : renderSetupReport(payload), Boolean(options.json));
  process.exitCode = payload.ready ? 0 : 1;
}

async function commandTaskResumeCandidate(argv) {
  parseArgs(argv, { booleanOptions: ["json"] });
  const cwd = resolveWorkspaceRoot(process.cwd());
  const sessions = listTaskSessions(cwd);
  const sessionId = getLastTaskSessionId(cwd);
  const runningJobs = listRunningJobs(cwd).map((job) => ({
    id: job.id,
    kind: job.kind,
    title: job.title || job.summary || null,
    status: job.status,
    grokSessionId: job.grokSessionId || null
  }));
  outputResult(
    {
      available: Boolean(sessionId) || sessions.length > 0,
      sessionId,
      sessions,
      runningJobs,
      canRunConcurrent: true,
      workspaceRoot: cwd
    },
    true
  );
}

async function commandTask(argv) {
  const expanded = expandArgv(argv);
  const { options, positionals } = parseArgs(expanded, {
    booleanOptions: [
      "background",
      "write",
      "read-only",
      "resume-last",
      "fresh",
      "worktree",
      "check",
      "json",
      "verbatim"
    ],
    valueOptions: [
      "model",
      "effort",
      "max-turns",
      "cwd",
      "best-of-n",
      "worktree-ref",
      "worktree-name",
      "resume-session"
    ],
    aliasMap: {
      "read-only": "read-only",
      "resume-last": "resume-last",
      "resume-session": "resume-session",
      "max-turns": "max-turns",
      "best-of-n": "best-of-n",
      "worktree-ref": "worktree-ref",
      "worktree-name": "worktree-name"
    }
  });

  const cwd = resolveWorkspaceRoot(options.cwd || process.cwd());
  const prompt = positionals.join(" ").trim();
  if (!prompt) {
    throw new Error("Missing task prompt. Example: task fix the failing tests");
  }

  const writeMode = !options["read-only"];
  const modelAlias = options.model;
  const model = normalizeModel(options.model);
  const effort = normalizeEffort(options.effort, modelAlias);
  const background = Boolean(options.background);
  const bestOfN = options["best-of-n"] ? Number(options["best-of-n"]) : null;
  const worktree =
    options["worktree-name"] ||
    (options.worktree ? true : false);
  const check = Boolean(options.check);

  let resume = null;
  if (options.fresh) {
    resume = null;
  } else if (options["resume-session"]) {
    resume = String(options["resume-session"]).trim();
    if (!resume) {
      throw new Error("Empty --resume-session value.");
    }
  } else if (options["resume-last"]) {
    resume = getLastTaskSessionId(cwd);
    if (!resume) {
      throw new Error("No previous Grok task session found for this repository. Run without --resume-last.");
    }
  }

  const job = createJobShell(cwd, {
    kind: "task",
    title: titleFromPrompt(prompt),
    prompt,
    write: writeMode,
    model,
    effort,
    extras: {
      resume,
      bestOfN,
      worktree: Boolean(worktree),
      check
    }
  });

  const grokOptions = {
    promptFile: job.promptFile,
    cwd,
    write: writeMode,
    model,
    effort,
    resume,
    maxTurns: options["max-turns"] ? Number(options["max-turns"]) : undefined,
    bestOfN,
    check,
    worktree,
    worktreeRef: options["worktree-ref"],
    verbatim: Boolean(options.verbatim)
  };

  runOrBackground(cwd, job, grokOptions, {
    background,
    json: options.json,
    renderPayload: {
      build: (finished) => ({
        jobId: job.id,
        kind: "task",
        status: finished.status,
        model,
        write: writeMode,
        grokSessionId: finished.grokSessionId,
        text: finished.resultText,
        error: finished.error,
        bestOfN,
        worktree: Boolean(worktree),
        check
      })
    }
  });
}

async function commandReview(argv, { adversarial = false } = {}) {
  const expanded = expandArgv(argv);
  const { options, positionals } = parseArgs(expanded, {
    booleanOptions: ["background", "json", "wait", "adversarial", "structured"],
    valueOptions: ["base", "scope", "model", "effort", "cwd", "pr"]
  });

  const cwd = resolveWorkspaceRoot(options.cwd || process.cwd());
  const focusText = positionals.join(" ").trim();
  const isAdversarial = adversarial || Boolean(options.adversarial);
  const target = resolveReviewTarget(cwd, {
    base: options.base,
    scope: options.scope || "auto",
    pr: options.pr
  });

  if (target.empty) {
    const message = "Nothing to review: working tree/branch/PR diff looks empty.\n";
    outputResult(options.json ? { empty: true, message } : message, Boolean(options.json));
    return;
  }

  const prompt = buildStructuredReviewPrompt(target, focusText, { adversarial: isAdversarial });
  const model = normalizeModel(options.model);
  const effort = normalizeEffort(options.effort, options.model);
  const kind = isAdversarial ? "adversarial-review" : "review";
  const job = createJobShell(cwd, {
    kind,
    title: titleFromPrompt(focusText || `${isAdversarial ? "Adversarial review" : "Review"} ${target.label}`, "Grok review"),
    prompt,
    write: false,
    model,
    effort,
    extras: {
      reviewTarget: {
        kind: target.kind,
        label: target.label,
        baseRef: target.baseRef || null,
        pr: target.pr || null
      }
    }
  });

  const schema = fs.readFileSync(getReviewSchemaPath(), "utf8");
  const grokOptions = {
    promptFile: job.promptFile,
    cwd,
    write: false,
    model,
    effort,
    jsonSchema: schema
  };

  runOrBackground(cwd, job, grokOptions, {
    background: Boolean(options.background),
    json: options.json,
    renderPayload: {
      finalizeExtras: { parseReview: true },
      build: (finished) => ({
        jobId: job.id,
        kind,
        status: finished.status,
        model,
        write: false,
        grokSessionId: finished.grokSessionId,
        text: finished.resultText,
        error: finished.error,
        review: finished.review
      })
    }
  });
}

async function commandMedia(argv, kind) {
  const expanded = expandArgv(argv);
  const multiRef = [];
  const filtered = [];
  for (let i = 0; i < expanded.length; i += 1) {
    if (expanded[i] === "--ref" || expanded[i] === "--refs") {
      const value = expanded[i + 1];
      if (!value) {
        throw new Error(`Missing value for ${expanded[i]}`);
      }
      multiRef.push(value);
      i += 1;
      continue;
    }
    filtered.push(expanded[i]);
  }

  const { options, positionals } = parseArgs(filtered, {
    booleanOptions: ["background", "json"],
    valueOptions: ["model", "effort", "edit", "image", "aspect", "duration", "cwd", "out"]
  });

  const cwd = resolveWorkspaceRoot(options.cwd || process.cwd());
  const promptText = positionals.join(" ").trim();
  if (!promptText && !options.edit && !options.image && !multiRef.length) {
    throw new Error(`Missing ${kind} prompt`);
  }

  const outputDir = options.out
    ? path.resolve(cwd, options.out)
    : resolveMediaOutputDir(cwd, kind);
  fs.mkdirSync(outputDir, { recursive: true });

  const model = normalizeModel(options.model);
  const effort = normalizeEffort(options.effort, options.model);
  const prompt =
    kind === "image"
      ? buildImagePrompt({
          prompt: promptText || "Improve or regenerate the asset",
          edit: options.edit ? path.resolve(cwd, options.edit) : null,
          outputDir,
          aspectRatio: options.aspect
        })
      : buildVideoPrompt({
          prompt: promptText || "Create a short product video",
          image: options.image ? path.resolve(cwd, options.image) : null,
          refs: multiRef.map((ref) => path.resolve(cwd, ref)),
          outputDir,
          duration: options.duration,
          aspectRatio: options.aspect
        });

  const job = createJobShell(cwd, {
    kind,
    title: titleFromPrompt(promptText || `${kind} generation`, `Grok ${kind}`),
    prompt,
    write: false,
    model,
    effort,
    extras: { mediaDir: outputDir, media: true }
  });

  // Grok 0.2.93: never pass --tools allowlist here (session create fails).
  // Use default toolset + denylist; do not pass --yolo (classifier may deny it;
  // single-prompt auto-approve still applies when configured).
  // Grok media tools write under ~/.grok/sessions/...; the companion copies into outputDir.
  const grokOptions = {
    promptFile: job.promptFile,
    cwd,
    media: true,
    write: false,
    yolo: false,
    model,
    effort,
    rules: `Media-only mode. Prefer image_gen / image_edit / image_to_video / reference_to_video. Session media paths are fine; the companion copies them into ${outputDir}. Do not edit application source code. Do not run shell commands or try to move files. When finished, print absolute paths to every created file.`
  };

  const finished = runOrBackground(cwd, job, grokOptions, {
    background: Boolean(options.background),
    json: options.json,
    renderPayload: {
      build: (done) => {
        const artifacts =
          done.artifacts?.length
            ? done.artifacts
            : resolveMediaArtifactsForJob(
                { ...job, ...done, mediaDir: outputDir, kind },
                done.resultText || "",
                done.grokSessionId
              );
        return {
          jobId: job.id,
          kind,
          status: done.status,
          model,
          write: false,
          mediaDir: outputDir,
          grokSessionId: done.grokSessionId,
          text: done.resultText,
          error: done.error,
          artifacts: [...new Set(artifacts)]
        };
      }
    }
  });

  // Foreground: re-collect in case session files landed after parse.
  if (finished) {
    finished.artifacts = resolveMediaArtifactsForJob(
      { ...finished, mediaDir: outputDir, kind },
      finished.resultText || "",
      finished.grokSessionId
    );
    writeJobFile(cwd, finished);
  }
}

async function commandTransfer(argv) {
  const { options } = parseArgs(argv, {
    booleanOptions: ["json"],
    valueOptions: ["source"]
  });
  const cwd = resolveWorkspaceRoot(process.cwd());
  const availability = getGrokAvailability();
  const plan = buildTransferPlan(cwd, {
    source: options.source,
    grokBinary: availability.binary
  });
  outputResult(options.json ? plan : renderTransferReport(plan), Boolean(options.json));
  process.exitCode = plan.ok ? 0 : 1;
}

async function commandStopGateReview(argv) {
  const { options } = parseArgs(argv, { booleanOptions: ["json"] });
  const cwd = resolveWorkspaceRoot(process.cwd());
  const config = getConfig(cwd);
  if (!config.stopReviewGate) {
    const payload = { enabled: false, blocked: false, message: "Stop review gate is disabled." };
    outputResult(options.json ? payload : "Stop review gate is disabled.\n", Boolean(options.json));
    return;
  }

  const target = collectStopGateContext(cwd);
  if (target.empty) {
    const payload = { enabled: true, blocked: false, empty: true, message: "No changes to review." };
    outputResult(options.json ? payload : "No changes to review for stop gate.\n", Boolean(options.json));
    return;
  }

  const prompt = buildStructuredReviewPrompt(
    target,
    "Stop-gate review of the previous Claude turn. Focus on bugs, security, and data-loss risks.",
    { adversarial: false }
  );
  const job = createJobShell(cwd, {
    kind: "stop-gate",
    title: "Stop-gate review",
    prompt,
    write: false,
    model: null,
    effort: null
  });

  const schema = fs.readFileSync(getReviewSchemaPath(), "utf8");
  const grokResult = runGrok({
    promptFile: job.promptFile,
    cwd,
    write: false,
    jsonSchema: schema
  });
  const finished = finalizeJob(cwd, job, grokResult, { parseReview: true });
  const blocked = Boolean(finished.review && reviewHasBlockingFindings(finished.review));
  const payload = {
    enabled: true,
    blocked,
    jobId: job.id,
    review: finished.review,
    text: finished.resultText,
    status: finished.status
  };

  if (options.json) {
    outputResult(payload, true);
  } else if (finished.review) {
    process.stdout.write(
      renderTaskResult({
        jobId: job.id,
        kind: "stop-gate",
        status: finished.status,
        review: finished.review,
        text: finished.resultText,
        grokSessionId: finished.grokSessionId
      })
    );
    if (blocked) {
      process.stdout.write(
        "\n**Stop gate:** blocking issues found (critical/high). Address them before ending the turn.\n"
      );
    }
  } else {
    process.stdout.write(finished.resultText || finished.error || "Stop-gate review finished.\n");
  }

  process.exitCode = blocked ? 2 : finished.status === "completed" ? 0 : 1;
}

async function commandStatus(argv) {
  const { options, positionals } = parseArgs(argv, {
    booleanOptions: ["json", "all"]
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
    outputResult(options.json ? job : renderStatusReport([job], { jobId }), Boolean(options.json));
    return;
  }

  const config = getConfig(cwd);
  const runningJobs = jobs.filter((job) => job.status === "running");
  const payload = {
    jobs,
    runningCount: runningJobs.length,
    concurrent: runningJobs.length > 1,
    workspaceRoot: cwd,
    stopReviewGate: config.stopReviewGate
  };
  outputResult(options.json ? payload : renderStatusReport(jobs, { concurrent: payload.concurrent }), Boolean(options.json));
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
        await commandReview(rest, { adversarial: false });
        break;
      case "adversarial-review":
        await commandReview(rest, { adversarial: true });
        break;
      case "image":
        await commandMedia(rest, "image");
        break;
      case "video":
        await commandMedia(rest, "video");
        break;
      case "transfer":
        await commandTransfer(rest);
        break;
      case "stop-gate-review":
        await commandStopGateReview(rest);
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
