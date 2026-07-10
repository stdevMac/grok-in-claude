function escapeCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function short(value, max = 80) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

export function renderSetupReport(payload) {
  const lines = ["# Grok setup", ""];
  lines.push(`- **CLI**: ${payload.available ? "found" : "missing"}`);
  if (payload.binary) {
    lines.push(`- **Binary**: \`${payload.binary}\``);
  }
  if (payload.version) {
    lines.push(`- **Version**: ${payload.version}`);
  }
  lines.push(`- **Auth**: ${payload.authenticated ? "ok" : "not ready"}`);
  if (payload.authDetail) {
    lines.push(`- **Auth detail**: ${payload.authDetail}`);
  }
  if (payload.ready) {
    lines.push("", "Grok is ready for `/grok:rescue` and `/grok:review`.");
  } else {
    lines.push("", "## Next steps");
    for (const step of payload.nextSteps ?? []) {
      lines.push(`- ${step}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderTaskResult(payload) {
  const lines = [];
  lines.push(`# Grok ${payload.kind || "task"} result`);
  lines.push("");
  lines.push(`- **Job**: \`${payload.jobId}\``);
  lines.push(`- **Status**: ${payload.status}`);
  if (payload.model) {
    lines.push(`- **Model**: ${payload.model}`);
  }
  if (payload.grokSessionId) {
    lines.push(`- **Grok session**: \`${payload.grokSessionId}\``);
    lines.push(`- **Resume in Grok TUI**: \`grok --resume ${payload.grokSessionId}\``);
  }
  if (payload.write) {
    lines.push("- **Mode**: write-capable (`--yolo`)");
  } else {
    lines.push("- **Mode**: read-only");
  }
  lines.push("");
  lines.push("## Output");
  lines.push("");
  lines.push(payload.text || payload.error || "(empty)");
  if (payload.error && payload.text) {
    lines.push("");
    lines.push("## Error");
    lines.push("");
    lines.push(payload.error);
  }
  lines.push("");
  lines.push("## Follow-ups");
  lines.push("");
  lines.push(`- \`/grok:status ${payload.jobId}\``);
  lines.push(`- \`/grok:result ${payload.jobId}\``);
  if (payload.grokSessionId) {
    lines.push(`- \`/grok:rescue --resume continue from this session\``);
  }
  return `${lines.join("\n")}\n`;
}

export function renderBackgroundStarted(payload) {
  const lines = [
    `# Grok ${payload.kind || "task"} started in background`,
    "",
    `- **Job**: \`${payload.jobId}\``,
    `- **PID**: ${payload.pid ?? "n/a"}`,
    `- **Title**: ${payload.title || "(untitled)"}`,
    "",
    "Check progress with:",
    "",
    `- \`/grok:status ${payload.jobId}\``,
    `- \`/grok:result ${payload.jobId}\``,
    `- \`/grok:cancel ${payload.jobId}\``
  ];
  return `${lines.join("\n")}\n`;
}

export function renderStatusReport(jobs, options = {}) {
  if (!jobs.length) {
    return "No Grok jobs recorded for this repository yet.\n";
  }

  if (options.jobId) {
    const job = jobs[0];
    const lines = [
      `# Job ${job.id}`,
      "",
      `- **Kind**: ${job.kind || "task"}`,
      `- **Status**: ${job.status}`,
      `- **Title**: ${job.title || ""}`,
      `- **Created**: ${job.createdAt || ""}`,
      `- **Updated**: ${job.updatedAt || ""}`
    ];
    if (job.finishedAt) {
      lines.push(`- **Finished**: ${job.finishedAt}`);
    }
    if (job.pid) {
      lines.push(`- **PID**: ${job.pid}`);
    }
    if (job.grokSessionId) {
      lines.push(`- **Grok session**: \`${job.grokSessionId}\``);
    }
    if (job.summary) {
      lines.push(`- **Summary**: ${job.summary}`);
    }
    if (job.error) {
      lines.push(`- **Error**: ${job.error}`);
    }
    if (job.logFile) {
      lines.push(`- **Log**: \`${job.logFile}\``);
    }
    lines.push("", "Follow-ups:", "", `- \`/grok:result ${job.id}\``, `- \`/grok:cancel ${job.id}\``);
    return `${lines.join("\n")}\n`;
  }

  const lines = [
    "| Job | Kind | Status | Summary |",
    "| --- | --- | --- | --- |"
  ];
  for (const job of jobs) {
    lines.push(
      `| \`${escapeCell(job.id)}\` | ${escapeCell(job.kind || "task")} | ${escapeCell(job.status)} | ${escapeCell(short(job.summary || job.title || ""))} |`
    );
  }
  lines.push("", "Use `/grok:status <job-id>` or `/grok:result <job-id>` for details.");
  return `${lines.join("\n")}\n`;
}

export function renderStoredJobResult(job) {
  if (!job) {
    return "No job found.\n";
  }

  if (job.status === "running") {
    return [
      `# Job ${job.id} is still running`,
      "",
      `- **Title**: ${job.title || ""}`,
      `- **PID**: ${job.pid ?? "n/a"}`,
      "",
      "Wait a bit, then retry `/grok:result`, or check `/grok:status`.",
      ""
    ].join("\n");
  }

  return renderTaskResult({
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    model: job.model,
    grokSessionId: job.grokSessionId,
    write: job.write,
    text: job.resultText || job.summary || "",
    error: job.error || null
  });
}

export function renderCancelReport(job, killed) {
  const lines = [
    `# Cancel ${job.id}`,
    "",
    `- **Previous status**: ${job.status}`,
    `- **Signal sent**: ${killed ? "yes" : "no (process already stopped)"}`,
    `- **New status**: cancelled`
  ];
  return `${lines.join("\n")}\n`;
}

export function renderResumeCandidate(payload) {
  if (!payload.available) {
    return JSON.stringify(payload, null, 2);
  }
  return JSON.stringify(payload, null, 2);
}
