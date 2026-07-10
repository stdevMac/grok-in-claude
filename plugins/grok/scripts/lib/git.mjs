import { formatCommandFailure, runCommand, runCommandChecked } from "./process.mjs";

function git(cwd, args, options = {}) {
  return runCommand("git", args, { cwd, ...options });
}

function gitChecked(cwd, args, options = {}) {
  return runCommandChecked("git", args, { cwd, ...options });
}

export function ensureGitRepository(cwd) {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  const errorCode = result.error && "code" in result.error ? result.error.code : null;
  if (errorCode === "ENOENT") {
    throw new Error("git is not installed. Install Git and retry.");
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.");
  }
  return result.stdout.trim();
}

export function detectDefaultBranch(cwd) {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const remoteHead = symbolic.stdout.trim();
    if (remoteHead.startsWith("refs/remotes/origin/")) {
      return remoteHead.replace("refs/remotes/origin/", "");
    }
  }

  for (const candidate of ["main", "master", "trunk"]) {
    const local = git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (local.status === 0) {
      return candidate;
    }
    const remote = git(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]);
    if (remote.status === 0) {
      return `origin/${candidate}`;
    }
  }

  throw new Error("Unable to detect the default branch. Pass --base <ref> or use --scope working-tree.");
}

export function getCurrentBranch(cwd) {
  return gitChecked(cwd, ["branch", "--show-current"]).stdout.trim() || "HEAD";
}

export function getWorkingTreeStatus(cwd) {
  return gitChecked(cwd, ["status", "--short", "--untracked-files=all"]).stdout.trim();
}

export function getWorkingTreeDiff(cwd, maxBytes = 200_000) {
  const staged = git(cwd, ["diff", "--cached"], { maxBuffer: maxBytes + 1 });
  const unstaged = git(cwd, ["diff"], { maxBuffer: maxBytes + 1 });
  const parts = [];
  if (staged.status === 0 && staged.stdout.trim()) {
    parts.push("### Staged changes\n" + staged.stdout.trim());
  }
  if (unstaged.status === 0 && unstaged.stdout.trim()) {
    parts.push("### Unstaged changes\n" + unstaged.stdout.trim());
  }
  const combined = parts.join("\n\n");
  if (combined.length > maxBytes) {
    return combined.slice(0, maxBytes) + "\n\n[diff truncated]";
  }
  return combined;
}

export function getBranchDiff(cwd, baseRef, maxBytes = 200_000) {
  const range = `${baseRef}...HEAD`;
  const result = git(cwd, ["diff", range], { maxBuffer: maxBytes + 1 });
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result, "git", ["diff", range]));
  }
  const text = result.stdout.trim();
  if (text.length > maxBytes) {
    return text.slice(0, maxBytes) + "\n\n[diff truncated]";
  }
  return text;
}

export function getPrReviewTarget(cwd, prNumber, maxBytes = 200_000) {
  const pr = String(prNumber).replace(/^#/, "");
  const view = runCommand("gh", ["pr", "view", pr, "--json", "title,body,baseRefName,headRefName,url,number"], {
    cwd,
    maxBuffer: 2 * 1024 * 1024
  });
  if (view.error && view.error.code === "ENOENT") {
    throw new Error("`gh` is not installed. Install GitHub CLI to use --pr.");
  }
  if (view.status !== 0) {
    throw new Error(formatCommandFailure(view, "gh", ["pr", "view", pr]));
  }

  let meta;
  try {
    meta = JSON.parse(view.stdout);
  } catch {
    throw new Error(`Unable to parse gh pr view output for PR #${pr}`);
  }

  const diff = runCommand("gh", ["pr", "diff", pr], { cwd, maxBuffer: maxBytes + 1 });
  if (diff.status !== 0) {
    throw new Error(formatCommandFailure(diff, "gh", ["pr", "diff", pr]));
  }

  let diffText = diff.stdout.trim();
  if (diffText.length > maxBytes) {
    diffText = diffText.slice(0, maxBytes) + "\n\n[diff truncated]";
  }

  const status = [
    `PR #${meta.number}: ${meta.title || ""}`,
    meta.url || "",
    `${meta.baseRefName || "?"} ← ${meta.headRefName || "?"}`,
    meta.body ? meta.body.slice(0, 2000) : ""
  ]
    .filter(Boolean)
    .join("\n");

  return {
    kind: "pr",
    label: `pull request #${meta.number}`,
    pr: meta.number,
    branch: meta.headRefName || null,
    baseRef: meta.baseRefName || null,
    status,
    diff: diffText,
    empty: !diffText
  };
}

export function resolveReviewTarget(cwd, options = {}) {
  if (options.pr) {
    return getPrReviewTarget(cwd, options.pr);
  }

  const scope = options.scope ?? "auto";
  const base = options.base ?? null;
  const status = getWorkingTreeStatus(cwd);

  if (scope === "working-tree" || (scope === "auto" && status && !base)) {
    return {
      kind: "working-tree",
      label: "working tree (staged + unstaged + untracked)",
      status,
      diff: getWorkingTreeDiff(cwd),
      empty: !status
    };
  }

  const baseRef = base || detectDefaultBranch(cwd);
  const diff = getBranchDiff(cwd, baseRef);
  const shortstat = gitChecked(cwd, ["diff", "--shortstat", `${baseRef}...HEAD`]).stdout.trim();
  return {
    kind: "branch",
    label: `branch vs ${baseRef}`,
    baseRef,
    branch: getCurrentBranch(cwd),
    status: shortstat,
    diff,
    empty: !diff && !shortstat
  };
}

/** Recent uncommitted + branch tip for stop-gate reviews. */
export function collectStopGateContext(cwd, maxBytes = 120_000) {
  const status = getWorkingTreeStatus(cwd);
  if (status) {
    return {
      kind: "working-tree",
      label: "working tree changes from the latest Claude turn",
      status,
      diff: getWorkingTreeDiff(cwd, maxBytes),
      empty: false
    };
  }

  try {
    const baseRef = detectDefaultBranch(cwd);
    const diff = getBranchDiff(cwd, baseRef, maxBytes);
    const shortstat = gitChecked(cwd, ["diff", "--shortstat", `${baseRef}...HEAD`]).stdout.trim();
    return {
      kind: "branch",
      label: `branch vs ${baseRef} (no working-tree changes)`,
      baseRef,
      branch: getCurrentBranch(cwd),
      status: shortstat,
      diff,
      empty: !diff && !shortstat
    };
  } catch {
    return {
      kind: "working-tree",
      label: "repository",
      status: "(clean)",
      diff: "",
      empty: true
    };
  }
}
