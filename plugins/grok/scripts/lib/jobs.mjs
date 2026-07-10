import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isProcessRunning, readPidFile } from "./process.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT = path.join(os.homedir(), ".grok", "claude-plugin", "state");
const MAX_JOBS = 50;

export function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    version: STATE_VERSION,
    lastTaskSessionId: null,
    jobs: []
  };
}

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonical = workspaceRoot;
  try {
    canonical = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonical = workspaceRoot;
  }

  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  const stateRoot = pluginDataDir ? path.join(pluginDataDir, "state") : FALLBACK_STATE_ROOT;
  return path.join(stateRoot, `${slug}-${hash}`);
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), "jobs");
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), "state.json");
}

export function resolveJobFile(cwd, jobId) {
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}

export function resolveJobLogFile(cwd, jobId) {
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function resolveJobPidFile(cwd, jobId) {
  return path.join(resolveJobsDir(cwd), `${jobId}.pid`);
}

export function ensureStateDir(cwd) {
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

export function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState();
  }
}

function pruneJobs(jobs) {
  return [...jobs]
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
}

export function saveState(cwd, state) {
  ensureStateDir(cwd);
  const next = {
    version: STATE_VERSION,
    lastTaskSessionId: state.lastTaskSessionId ?? null,
    jobs: pruneJobs(state.jobs ?? [])
  };
  fs.writeFileSync(resolveStateFile(cwd), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function updateState(cwd, mutate) {
  const state = loadState(cwd);
  mutate(state);
  return saveState(cwd, state);
}

export function generateJobId(prefix = "job") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function upsertJob(cwd, jobPatch) {
  return updateState(cwd, (state) => {
    const timestamp = nowIso();
    const index = state.jobs.findIndex((job) => job.id === jobPatch.id);
    if (index === -1) {
      state.jobs.unshift({
        createdAt: timestamp,
        updatedAt: timestamp,
        ...jobPatch
      });
      return;
    }
    state.jobs[index] = {
      ...state.jobs[index],
      ...jobPatch,
      updatedAt: timestamp
    };
  });
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

export function writeJobFile(cwd, job) {
  ensureStateDir(cwd);
  const filePath = resolveJobFile(cwd, job.id);
  fs.writeFileSync(filePath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  return filePath;
}

export function readJobFile(cwd, jobId) {
  const filePath = resolveJobFile(cwd, jobId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function setLastTaskSessionId(cwd, sessionId) {
  updateState(cwd, (state) => {
    state.lastTaskSessionId = sessionId ?? null;
  });
}

export function getLastTaskSessionId(cwd) {
  return loadState(cwd).lastTaskSessionId ?? null;
}

export function refreshJobLiveness(cwd, job) {
  if (!job || job.status !== "running") {
    return job;
  }

  const pid = job.pid ?? readPidFile(resolveJobPidFile(cwd, job.id));
  if (pid && isProcessRunning(pid)) {
    return { ...job, pid, alive: true };
  }

  // Background worker may have finished and written the job file already.
  const stored = readJobFile(cwd, job.id);
  if (stored && stored.status && stored.status !== "running") {
    upsertJob(cwd, {
      id: job.id,
      status: stored.status,
      finishedAt: stored.finishedAt ?? nowIso(),
      summary: stored.summary ?? job.summary,
      exitCode: stored.exitCode ?? null,
      grokSessionId: stored.grokSessionId ?? job.grokSessionId,
      error: stored.error ?? null
    });
    return { ...job, ...stored, alive: false };
  }

  if (job.status === "running") {
    const finished = {
      ...job,
      status: "failed",
      finishedAt: nowIso(),
      summary: job.summary || "Process exited without writing a result",
      error: "Background Grok process is no longer running",
      alive: false
    };
    upsertJob(cwd, {
      id: job.id,
      status: "failed",
      finishedAt: finished.finishedAt,
      summary: finished.summary,
      error: finished.error
    });
    writeJobFile(cwd, finished);
    return finished;
  }

  return { ...job, alive: false };
}

export function resolveJob(cwd, jobId) {
  const jobs = listJobs(cwd).map((job) => refreshJobLiveness(cwd, job));
  if (jobId) {
    const match = jobs.find((job) => job.id === jobId) || readJobFile(cwd, jobId);
    if (!match) {
      throw new Error(`Unknown job id: ${jobId}`);
    }
    return refreshJobLiveness(cwd, match);
  }

  const running = jobs.find((job) => job.status === "running");
  if (running) {
    return running;
  }
  if (jobs[0]) {
    return jobs[0];
  }
  throw new Error("No Grok jobs found for this repository. Run /grok:rescue or /grok:review first.");
}
