#!/usr/bin/env node

/**
 * Claude Code Stop hook.
 * When stop-review-gate is enabled for the workspace, runs a structured Grok
 * review and blocks stop (exit 2) if critical/high findings exist.
 *
 * WARNING: This can create long Claude↔Grok loops and consume usage quickly.
 */

import process from "node:process";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getConfig } from "./lib/jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const companion = path.join(ROOT_DIR, "scripts", "grok-companion.mjs");

const cwd = resolveWorkspaceRoot(process.cwd());
const config = getConfig(cwd);

if (!config.stopReviewGate) {
  process.exit(0);
}

const result = spawnSync(process.execPath, [companion, "stop-gate-review", "--json"], {
  cwd,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
  env: process.env
});

const stdout = String(result.stdout || "").trim();
const stderr = String(result.stderr || "").trim();

let payload = null;
try {
  payload = JSON.parse(stdout);
} catch {
  // ignore
}

if (payload?.enabled === false || payload?.empty) {
  process.exit(0);
}

if (payload?.blocked) {
  const summary = payload.review?.summary || "Blocking findings detected";
  const findings = (payload.review?.findings || [])
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .slice(0, 5)
    .map((f) => `- [${f.severity}] ${f.title} (${f.file})`)
    .join("\n");

  process.stderr.write(
    [
      "Grok stop-review gate blocked the stop.",
      summary,
      findings,
      payload.jobId ? `Details: /grok:result ${payload.jobId}` : null,
      "Disable with: /grok:setup --disable-review-gate"
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
  process.exit(2);
}

if (result.status && result.status !== 0) {
  // Soft-fail: do not hard-block on infra errors.
  if (stderr) {
    process.stderr.write(`Grok stop-gate warning: ${stderr}\n`);
  }
  process.exit(0);
}

process.exit(0);
