import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCommand } from "./process.mjs";

function encodeProjectDir(cwd) {
  // Claude Code stores projects as path with / replaced by -
  return cwd.replace(/\//g, "-");
}

export function findLatestClaudeTranscript(cwd, explicitSource) {
  if (explicitSource) {
    const resolved = path.resolve(explicitSource);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Transcript not found: ${resolved}`);
    }
    return resolved;
  }

  const projectsRoot = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsRoot)) {
    return null;
  }

  const encoded = encodeProjectDir(cwd);
  const candidates = [];

  // Exact project folder
  const exact = path.join(projectsRoot, encoded);
  if (fs.existsSync(exact)) {
    candidates.push(exact);
  }

  // Fuzzy: folder name contains basenames
  const base = path.basename(cwd);
  for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.includes(base) || entry.name.includes(encoded.slice(0, 40))) {
      candidates.push(path.join(projectsRoot, entry.name));
    }
  }

  let latest = null;
  let latestMtime = 0;
  for (const dir of candidates) {
    let files;
    try {
      files = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latest = full;
        }
      } catch {
        // ignore
      }
    }
  }

  return latest;
}

export function buildTransferPlan(cwd, options = {}) {
  const sessionPath = findLatestClaudeTranscript(cwd, options.source);
  if (!sessionPath) {
    return {
      ok: false,
      error:
        "No Claude Code transcript found for this repository under ~/.claude/projects. Pass --source <path-to.jsonl>.",
      sessionPath: null,
      importCommand: null,
      resumeCommand: null,
      notes: [
        "Claude stores sessions in ~/.claude/projects/<encoded-cwd>/*.jsonl",
        "You can also continue work with: /grok:rescue --resume <instruction>"
      ]
    };
  }

  // Probe whether grok import exists
  const help = runCommand(options.grokBinary || "grok", ["help"]);
  const helpText = `${help.stdout || ""}\n${help.stderr || ""}`;
  const supportsImport = /\bimport\b/i.test(helpText);

  const notes = [
    "Transfer is best-effort. Grok import support depends on your CLI version.",
    "After import/resume, continue the work in Grok TUI or with /grok:rescue --resume."
  ];

  if (supportsImport) {
    return {
      ok: true,
      sessionPath,
      importCommand: `grok import "${sessionPath}"`,
      resumeCommand: "grok --continue",
      notes
    };
  }

  return {
    ok: true,
    sessionPath,
    importCommand: null,
    resumeCommand: null,
    notes: [
      ...notes,
      "This Grok CLI does not expose a documented `import` subcommand in `grok help`.",
      "Open the transcript path above and summarize context into /grok:rescue, or upgrade Grok and retry."
    ]
  };
}
