import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { binaryAvailable, runCommand } from "./process.mjs";

// Keep this list conservative. Broader allowlists (web tools) and
// `--disallowed-tools Agent` currently trip a Grok CLI agent-build bug
// around run_terminal_cmd background params (observed on grok 0.2.93).
const READ_ONLY_TOOLS = "read_file,grep,list_dir";

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

  // `grok models` requires auth and is non-interactive.
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

  // Some versions print models without an explicit "logged in" line.
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

  args.push("--output-format", options.outputFormat ?? "json");

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
  if (options.worktree) {
    args.push("--worktree");
    if (typeof options.worktree === "string" && options.worktree !== "true") {
      // --worktree takes optional name; keep as bare flag for boolean true
    }
  }
  if (options.write) {
    args.push("--yolo");
  } else {
    args.push("--tools", options.tools ?? READ_ONLY_TOOLS);
  }
  if (options.rules) {
    args.push("--rules", options.rules);
  } else if (!options.write) {
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

  // Prefer the last JSON object in case of incidental log noise.
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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
      // Keep headless stderr quiet unless caller opts into logs.
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
 * The child writes final JSON to resultFile and exits.
 */
export function spawnGrokBackground(options = {}) {
  const availability = getGrokAvailability();
  if (!availability.available) {
    throw new Error(availability.reason);
  }

  const args = buildGrokArgs(options);
  const resultFile = options.resultFile;
  const logFile = options.logFile;
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
const cwd = ${JSON.stringify(options.cwd || process.cwd())};

function append(line) {
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, "[" + new Date().toISOString() + "] " + line + "\\n");
  } catch {}
}

append("Starting Grok: " + binary + " " + args.join(" "));
const child = spawn(binary, args, {
  cwd,
  env: { ...process.env, RUST_LOG: process.env.RUST_LOG || "off" },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  stdout += text;
  append(text.trimEnd());
});
child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  stderr += text;
  append("[stderr] " + text.trimEnd());
});
child.on("close", (code, signal) => {
  const payload = {
    exitCode: code,
    signal,
    stdout,
    stderr,
    finishedAt: new Date().toISOString()
  };
  try {
    fs.writeFileSync(resultFile, JSON.stringify(payload, null, 2) + "\\n");
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
