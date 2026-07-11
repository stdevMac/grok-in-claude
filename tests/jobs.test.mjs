import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AmbiguousJobError,
  getLastTaskSessionId,
  listRunningJobs,
  listTaskSessions,
  loadState,
  recordTaskSession,
  resolveJob,
  saveState,
  upsertJob
} from "../plugins/grok/scripts/lib/jobs.mjs";

function withTempWorkspace(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-jobs-"));
  const pluginData = path.join(root, "plugin-data");
  fs.mkdirSync(pluginData, { recursive: true });
  const cwd = path.join(root, "repo");
  fs.mkdirSync(cwd, { recursive: true });
  const prev = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginData;
  try {
    return fn(cwd);
  } finally {
    if (prev === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = prev;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("recordTaskSession keeps multi-session history and latest pointer", () => {
  withTempWorkspace((cwd) => {
    recordTaskSession(cwd, {
      sessionId: "sess-a",
      jobId: "task-1",
      title: "first",
      kind: "task"
    });
    recordTaskSession(cwd, {
      sessionId: "sess-b",
      jobId: "task-2",
      title: "second",
      kind: "task"
    });

    assert.equal(getLastTaskSessionId(cwd), "sess-b");
    const sessions = listTaskSessions(cwd);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].sessionId, "sess-b");
    assert.equal(sessions[1].sessionId, "sess-a");
    assert.equal(sessions[0].jobId, "task-2");
  });
});

test("recordTaskSession dedupes by sessionId", () => {
  withTempWorkspace((cwd) => {
    recordTaskSession(cwd, { sessionId: "sess-a", jobId: "task-1", title: "old" });
    recordTaskSession(cwd, { sessionId: "sess-a", jobId: "task-9", title: "new" });
    const sessions = listTaskSessions(cwd);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].jobId, "task-9");
    assert.equal(sessions[0].title, "new");
  });
});

test("resolveJob requires id when multiple jobs are running", () => {
  withTempWorkspace((cwd) => {
    upsertJob(cwd, { id: "job-a", kind: "task", status: "running", title: "A" });
    upsertJob(cwd, { id: "job-b", kind: "review", status: "running", title: "B" });
    // Mark as not alive via dead pid so refresh doesn't flip them failed without pid files —
    // write job files as running without live pids; refreshJobLiveness will mark failed.
    // Instead keep status completed for one path: listRunningJobs uses status===running after refresh.
    // Force-write job files that stay "running" by using a fake alive pid of current process.
    const selfPid = process.pid;
    upsertJob(cwd, { id: "job-a", kind: "task", status: "running", title: "A", pid: selfPid });
    upsertJob(cwd, { id: "job-b", kind: "review", status: "running", title: "B", pid: selfPid });

    const running = listRunningJobs(cwd);
    assert.ok(running.length >= 2);

    assert.throws(() => resolveJob(cwd, null), (err) => {
      assert.ok(err instanceof AmbiguousJobError);
      assert.ok(err.running.length >= 2);
      return true;
    });

    const picked = resolveJob(cwd, "job-a");
    assert.equal(picked.id, "job-a");
  });
});

test("loadState migrates v2 lastTaskSessionId into listTaskSessions", () => {
  withTempWorkspace((cwd) => {
    saveState(cwd, {
      version: 2,
      lastTaskSessionId: "legacy-sess",
      taskSessions: [],
      config: { stopReviewGate: false },
      jobs: []
    });
    const sessions = listTaskSessions(cwd);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, "legacy-sess");
    const state = loadState(cwd);
    assert.equal(state.lastTaskSessionId, "legacy-sess");
  });
});
