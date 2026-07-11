import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isProcessRunning, readPidFile } from "./process.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 3;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT = path.join(os.homedir(), ".grok", "claude-plugin", "state");
const MAX_JOBS = 50;
const MAX_TASK_SESSIONS = 20;

export function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    version: STATE_VERSION,
    lastTaskSessionId: null,
    taskSessions: [],
    config: {
      stopReviewGate: false
    },
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

export function resolveJobProgressFile(cwd, jobId) {
  return path.join(resolveJobsDir(cwd), `${jobId}.progress.json`);
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
      config: {
        ...defaultState().config,
        ...(parsed.config ?? {})
      },
      taskSessions: Array.isArray(parsed.taskSessions) ? parsed.taskSessions : [],
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

function pruneTaskSessions(sessions) {
  return [...(sessions ?? [])]
    .filter((entry) => entry && entry.sessionId)
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, MAX_TASK_SESSIONS);
}

export function saveState(cwd, state) {
  ensureStateDir(cwd);
  const next = {
    version: STATE_VERSION,
    lastTaskSessionId: state.lastTaskSessionId ?? null,
    taskSessions: pruneTaskSessions(state.taskSessions ?? []),
    config: {
      ...defaultState().config,
      ...(state.config ?? {})
    },
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

export function getConfig(cwd) {
  return loadState(cwd).config;
}

export function setConfig(cwd, patch) {
  return updateState(cwd, (state) => {
    state.config = {
      ...state.config,
      ...patch
    };
  }).config;
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

/**
 * Record a finished task/rescue session for multi-session resume.
 * Keeps lastTaskSessionId as the latest (backward compatible).
 */
export function recordTaskSession(cwd, { sessionId, jobId = null, title = null, kind = "task" } = {}) {
  if (!sessionId) {
    return;
  }
  updateState(cwd, (state) => {
    state.lastTaskSessionId = sessionId;
    const entry = {
      sessionId,
      jobId,
      title,
      kind,
      updatedAt: nowIso()
    };
    const existing = Array.isArray(state.taskSessions) ? state.taskSessions : [];
    state.taskSessions = [entry, ...existing.filter((s) => s.sessionId !== sessionId)];
  });
}

/** @deprecated Prefer recordTaskSession — kept for call sites that only have a session id. */
export function setLastTaskSessionId(cwd, sessionId) {
  recordTaskSession(cwd, { sessionId });
}

export function getLastTaskSessionId(cwd) {
  const state = loadState(cwd);
  if (state.lastTaskSessionId) {
    return state.lastTaskSessionId;
  }
  const sessions = listTaskSessions(cwd);
  return sessions[0]?.sessionId ?? null;
}

export function listTaskSessions(cwd) {
  const state = loadState(cwd);
  const sessions = pruneTaskSessions(state.taskSessions ?? []);
  if (sessions.length) {
    return sessions;
  }
  // Migrate v2 state that only had lastTaskSessionId
  if (state.lastTaskSessionId) {
    return [
      {
        sessionId: state.lastTaskSessionId,
        jobId: null,
        title: null,
        kind: "task",
        updatedAt: null
      }
    ];
  }
  return [];
}

export function readJobProgress(cwd, jobId) {
  const filePath = resolveJobProgressFile(cwd, jobId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function tailLog(filePath, maxLines = 12) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxLines);
  } catch {
    return [];
  }
}

export function refreshJobLiveness(cwd, job) {
  if (!job || job.status !== "running") {
    return job;
  }

  const pid = job.pid ?? readPidFile(resolveJobPidFile(cwd, job.id));
  if (pid && isProcessRunning(pid)) {
    const progress = readJobProgress(cwd, job.id);
    return { ...job, pid, alive: true, progress };
  }

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

export function listRunningJobs(cwd) {
  return listJobs(cwd)
    .map((job) => refreshJobLiveness(cwd, job))
    .filter((job) => job.status === "running");
}

export class AmbiguousJobError extends Error {
  constructor(running) {
    const ids = running.map((job) => `\`${job.id}\``).join(", ");
    super(
      `Multiple Grok jobs are running (${running.length}). Pass a job id: ${ids}. Use \`/grok:status\` to list them.`
    );
    this.name = "AmbiguousJobError";
    this.running = running;
  }
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

  const running = jobs.filter((job) => job.status === "running");
  if (running.length === 1) {
    return running[0];
  }
  if (running.length > 1) {
    throw new AmbiguousJobError(running);
  }
  if (jobs[0]) {
    return jobs[0];
  }
  throw new Error("No Grok jobs found for this repository. Run a /grok command first.");
}
