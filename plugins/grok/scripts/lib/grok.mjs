import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { binaryAvailable, runCommand } from "./process.mjs";

// Keep allowlists conservative. Some broader allowlists / Agent denylists
// trip a Grok CLI agent-build bug around run_terminal_cmd (0.2.93).
export const READ_ONLY_TOOLS = "read_file,grep,list_dir";
export const MEDIA_TOOLS = "image_gen,image_edit,image_to_video,reference_to_video,list_dir,read_file";

export function resolveGrokBinary() {
  const envPath = process.env.GROK_BINARY;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const which = runCommand("which", ["grok"]);
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim();
  }

  const homeCandidate = path.join(os.homedir(), ".grok", "bin", "grok");
  if (fs.existsSync(homeCandidate)) {
    return homeCandidate;
  }

  return null;
}

export function getGrokAvailability() {
  const binary = resolveGrokBinary();
  if (!binary) {
    return {
      available: false,
      binary: null,
      version: null,
      reason: "Grok CLI not found on PATH. Install Grok Build and ensure `grok` is available."
    };
  }

  const versionResult = runCommand(binary, ["version"]);
  const version = versionResult.status === 0 ? versionResult.stdout.trim().split("\n")[0] : null;
  return {
    available: true,
    binary,
    version,
    reason: null
  };
}

export function getGrokAuthStatus() {
  const binary = resolveGrokBinary();
  if (!binary) {
    return { authenticated: false, detail: "Grok CLI not found" };
  }

  const result = runCommand(binary, ["models"], { maxBuffer: 2 * 1024 * 1024 });
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  const combined = `${stdout}\n${stderr}`;

  if (result.status === 0 && /logged in|Available models|Default model/i.test(combined)) {
    const loginMatch = combined.match(/logged in with ([^\n.]+)/i);
    return {
      authenticated: true,
      detail: loginMatch ? `Logged in with ${loginMatch[1].trim()}` : "Authenticated"
    };
  }

  if (/not logged in|sign in|login|unauthorized|auth/i.test(combined)) {
    return {
      authenticated: false,
      detail: "Not authenticated. Run `grok login` or `!grok login` from Claude Code."
    };
  }

  if (result.status === 0 && /grok-/i.test(combined)) {
    return { authenticated: true, detail: "Authenticated (models list succeeded)" };
  }

  return {
    authenticated: false,
    detail: (stderr || stdout || "Unable to verify Grok authentication").trim()
  };
}

export function buildGrokArgs(options = {}) {
  const args = [];

  if (options.promptFile) {
    args.push("--prompt-file", options.promptFile);
  } else if (options.prompt != null) {
    args.push("-p", options.prompt);
  } else {
    throw new Error("A prompt or prompt file is required");
  }

  const outputFormat = options.outputFormat ?? (options.jsonSchema ? "json" : "json");
  args.push("--output-format", outputFormat);

  if (options.jsonSchema) {
    args.push("--json-schema", options.jsonSchema);
  }
  if (options.model) {
    args.push("-m", options.model);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }
  if (options.cwd) {
    args.push("--cwd", options.cwd);
  }
  if (options.resume) {
    args.push("-r", options.resume);
  } else if (options.continueSession) {
    args.push("-c");
  }
  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns));
  }
  if (options.bestOfN && Number(options.bestOfN) > 1) {
    args.push("--best-of-n", String(options.bestOfN));
  }
  if (options.check) {
    args.push("--check");
  }
  if (options.worktree) {
    if (typeof options.worktree === "string" && options.worktree !== "true") {
      args.push("--worktree", options.worktree);
    } else {
      args.push("--worktree");
    }
  }
  if (options.worktreeRef) {
    args.push("--worktree-ref", options.worktreeRef);
  }

  if (options.tools) {
    args.push("--tools", options.tools);
    if (options.yolo !== false && options.write !== false) {
      // Media and constrained modes still need auto-approve when tools mutate.
      if (options.yolo || options.write) {
        args.push("--yolo");
      }
    }
  } else if (options.write) {
    args.push("--yolo");
  } else {
    args.push("--tools", options.readOnlyTools ?? READ_ONLY_TOOLS);
  }

  if (options.rules) {
    args.push("--rules", options.rules);
  } else if (!options.write && !options.tools) {
    args.push(
      "--rules",
      "Read-only mode: do not modify files, create files, or run mutating shell commands. Review and report only."
    );
  }

  if (options.verbatim) {
    args.push("--verbatim");
  }

  return args;
}

export function parseGrokJsonOutput(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) {
    return { ok: false, error: "Grok produced empty output", raw: "" };
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = [...lines].reverse();
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        if (parsed.type === "error") {
          return {
            ok: false,
            error: parsed.message || "Grok returned an error object",
            raw: text,
            parsed
          };
        }
        return {
          ok: true,
          text: typeof parsed.text === "string" ? parsed.text : "",
          sessionId: parsed.sessionId ?? null,
          stopReason: parsed.stopReason ?? null,
          requestId: parsed.requestId ?? null,
          thought: parsed.thought ?? null,
          raw: text,
          parsed
        };
      }
    } catch {
      // try next candidate
    }
  }

  return {
    ok: true,
    text,
    sessionId: null,
    stopReason: null,
    requestId: null,
    thought: null,
    raw: text,
    parsed: null
  };
}

export function runGrok(options = {}) {
  const availability = getGrokAvailability();
  if (!availability.available) {
    throw new Error(availability.reason);
  }

  const args = buildGrokArgs(options);
  const result = runCommand(availability.binary, args, {
    cwd: options.cwd,
    maxBuffer: options.maxBuffer ?? 40 * 1024 * 1024,
    env: {
      ...process.env,
      ...(options.env ?? {}),
      RUST_LOG: options.rustLog ?? process.env.RUST_LOG ?? "off"
    }
  });

  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  const parsed = parseGrokJsonOutput(stdout);

  return {
    binary: availability.binary,
    args,
    status: result.status,
    signal: result.signal,
    stdout,
    stderr,
    parsed,
    ok: result.status === 0 && parsed.ok
  };
}

/**
 * Spawn Grok as a detached background process.
 * Uses streaming-json when progressFile is set so status can show live activity.
 */
export function spawnGrokBackground(options = {}) {
  const availability = getGrokAvailability();
  if (!availability.available) {
    throw new Error(availability.reason);
  }

  const useStreaming = Boolean(options.progressFile);
  const args = buildGrokArgs({
    ...options,
    outputFormat: useStreaming ? "streaming-json" : options.outputFormat ?? "json"
  });
  const resultFile = options.resultFile;
  const logFile = options.logFile;
  const progressFile = options.progressFile || "";
  if (!resultFile) {
    throw new Error("resultFile is required for background runs");
  }

  const wrapper = `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const binary = ${JSON.stringify(availability.binary)};
const args = ${JSON.stringify(args)};
const resultFile = ${JSON.stringify(resultFile)};
const logFile = ${JSON.stringify(logFile || "")};
const progressFile = ${JSON.stringify(progressFile)};
const cwd = ${JSON.stringify(options.cwd || process.cwd())};
const streaming = ${JSON.stringify(useStreaming)};

function append(line) {
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, "[" + new Date().toISOString() + "] " + line + "\\n");
  } catch {}
}

function writeProgress(patch) {
  if (!progressFile) return;
  try {
    let current = {};
    if (fs.existsSync(progressFile)) {
      current = JSON.parse(fs.readFileSync(progressFile, "utf8"));
    }
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(progressFile, JSON.stringify(next, null, 2) + "\\n");
  } catch {}
}

append("Starting Grok: " + binary + " " + args.join(" "));
writeProgress({ phase: "starting", message: "Launching Grok", lines: 0 });

const child = spawn(binary, args, {
  cwd,
  env: { ...process.env, RUST_LOG: process.env.RUST_LOG || "off" },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
let textAcc = "";
let sessionId = null;
let lineCount = 0;
let lastMessage = "running";

function handleStreamLine(line) {
  lineCount += 1;
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const evt = JSON.parse(trimmed);
    if (evt.type === "text" && evt.data) {
      textAcc += evt.data;
      lastMessage = String(evt.data).replace(/\\s+/g, " ").slice(0, 120);
    } else if (evt.type === "thought" && evt.data) {
      lastMessage = "thinking: " + String(evt.data).replace(/\\s+/g, " ").slice(0, 100);
    } else if (evt.type === "end") {
      sessionId = evt.sessionId || sessionId;
      lastMessage = "finishing";
    } else if (evt.type === "error") {
      lastMessage = evt.message || "error";
    }
    if (evt.sessionId) sessionId = evt.sessionId;
  } catch {
    lastMessage = trimmed.slice(0, 120);
  }
  if (lineCount % 3 === 0 || /end|error/i.test(trimmed)) {
    writeProgress({
      phase: "running",
      message: lastMessage,
      lines: lineCount,
      sessionId
    });
  }
}

let stdoutBuf = "";
child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  stdout += text;
  append(text.trimEnd());
  if (streaming) {
    stdoutBuf += text;
    let idx;
    while ((idx = stdoutBuf.indexOf("\\n")) !== -1) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      handleStreamLine(line);
    }
  }
});
child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  stderr += text;
  append("[stderr] " + text.trimEnd());
  writeProgress({ phase: "running", message: text.trim().slice(0, 120), lines: lineCount });
});
child.on("close", (code, signal) => {
  if (streaming && stdoutBuf.trim()) {
    handleStreamLine(stdoutBuf);
  }

  let finalStdout = stdout;
  if (streaming) {
    // Reconstruct a json-format-like payload for the companion parser.
    finalStdout = JSON.stringify({
      text: textAcc || stdout,
      stopReason: code === 0 ? "EndTurn" : "Error",
      sessionId,
      requestId: null
    });
  }

  const payload = {
    exitCode: code,
    signal,
    stdout: finalStdout,
    stderr,
    finishedAt: new Date().toISOString(),
    sessionId
  };
  try {
    fs.writeFileSync(resultFile, JSON.stringify(payload, null, 2) + "\\n");
    writeProgress({
      phase: code === 0 ? "completed" : "failed",
      message: code === 0 ? "completed" : "failed with code " + code,
      lines: lineCount,
      sessionId
    });
    append("Finished with code " + code);
  } catch (error) {
    append("Failed to write result: " + error.message);
  }
  process.exit(code === null ? 1 : code);
});
`.trim();

  const child = spawn(process.execPath, ["-e", wrapper], {
    cwd: options.cwd,
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();
  return { pid: child.pid, binary: availability.binary, args };
}

export function hasNode() {
  return binaryAvailable("node");
}
