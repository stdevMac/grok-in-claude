import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = path.resolve(
  fileURLToPath(new URL("../../schemas/review-output.schema.json", import.meta.url))
);

export function readReviewSchema() {
  return fs.readFileSync(SCHEMA_PATH, "utf8");
}

export function getReviewSchemaPath() {
  return SCHEMA_PATH;
}

export function buildStructuredReviewPrompt(target, focusText, { adversarial = false } = {}) {
  const focus = focusText?.trim()
    ? `\n\nAdditional review focus from the user:\n${focusText.trim()}\n`
    : "";

  const mode = adversarial
    ? `You are performing an adversarial, steerable code review.
Challenge the design, tradeoffs, hidden assumptions, failure modes, and safer alternatives.
Do not rubber-stamp. Prefer findings that question whether this was the right approach.`
    : `You are performing a thorough read-only code review.
Focus on bugs, regressions, security issues, missing tests, and maintainability risks.`;

  return `${mode}

Do not modify files. Do not implement fixes.

Review target: ${target.label}
${target.branch ? `Current branch: ${target.branch}` : ""}
${target.baseRef ? `Base ref: ${target.baseRef}` : ""}
${target.pr ? `Pull request: #${target.pr}` : ""}

## Git status / summary
${target.status || "(clean)"}

## Diff
${target.diff || "(no diff content captured; inspect the repository with read-only tools if needed)"}
${focus}
## Output contract
Return ONLY JSON matching the provided schema with:
- verdict
- summary
- findings[] with severity, title, body, file, optional line_start/line_end, recommendation
- next_steps[]

Order findings by severity (critical > high > medium > low).
If there are no issues, return an empty findings array and a clear approve-style verdict.`;
}

export function tryParseStructuredReview(text) {
  if (!text || typeof text !== "string") {
    return null;
  }
  const trimmed = text.trim();
  const candidates = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    candidates.unshift(fenced[1].trim());
  }

  // Sometimes model returns prose + JSON object
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.verdict === "string" &&
        typeof parsed.summary === "string" &&
        Array.isArray(parsed.findings) &&
        Array.isArray(parsed.next_steps)
      ) {
        return normalizeReview(parsed);
      }
    } catch {
      // try next
    }
  }
  return null;
}

function normalizeReview(data) {
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  const findings = data.findings.map((finding, index) => {
    const source = finding && typeof finding === "object" ? finding : {};
    const lineStart =
      Number.isInteger(source.line_start) && source.line_start > 0 ? source.line_start : null;
    const lineEnd =
      Number.isInteger(source.line_end) && source.line_end > 0 ? source.line_end : lineStart;
    return {
      severity:
        typeof source.severity === "string" && source.severity.trim()
          ? source.severity.trim().toLowerCase()
          : "low",
      title:
        typeof source.title === "string" && source.title.trim()
          ? source.title.trim()
          : `Finding ${index + 1}`,
      body:
        typeof source.body === "string" && source.body.trim()
          ? source.body.trim()
          : "No details provided.",
      file:
        typeof source.file === "string" && source.file.trim() ? source.file.trim() : "unknown",
      line_start: lineStart,
      line_end: lineEnd,
      recommendation:
        typeof source.recommendation === "string" ? source.recommendation.trim() : ""
    };
  });

  findings.sort(
    (a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)
  );

  return {
    verdict: data.verdict.trim(),
    summary: data.summary.trim(),
    findings,
    next_steps: data.next_steps
      .filter((step) => typeof step === "string" && step.trim())
      .map((step) => step.trim())
  };
}

export function reviewHasBlockingFindings(review) {
  if (!review) {
    return false;
  }
  return review.findings.some((f) => f.severity === "critical" || f.severity === "high");
}
