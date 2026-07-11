import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGrokArgs,
  humanizeGrokFailure,
  parseGrokJsonOutput
} from "../plugins/grok/scripts/lib/grok.mjs";

test("parseGrokJsonOutput reads success payload", () => {
  const parsed = parseGrokJsonOutput(
    JSON.stringify({
      text: "hello",
      stopReason: "EndTurn",
      sessionId: "sess-1",
      requestId: "req-1"
    })
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.text, "hello");
  assert.equal(parsed.sessionId, "sess-1");
});

test("parseGrokJsonOutput reads error payload", () => {
  const parsed = parseGrokJsonOutput(JSON.stringify({ type: "error", message: "nope" }));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /nope/);
});

test("buildGrokArgs write mode uses yolo", () => {
  const args = buildGrokArgs({ prompt: "hi", write: true, model: "grok-4.5" });
  assert.ok(args.includes("--yolo"));
  assert.ok(args.includes("-m"));
  assert.ok(args.includes("grok-4.5"));
});

test("buildGrokArgs read-only mode uses denylist not allowlist", () => {
  const args = buildGrokArgs({ prompt: "review", write: false });
  assert.ok(!args.includes("--yolo"));
  assert.ok(!args.includes("--tools"));
  assert.ok(args.includes("--disallowed-tools"));
  assert.ok(args.some((a) => String(a).includes("run_terminal_cmd")));
  assert.ok(args.includes("--rules"));
});

test("buildGrokArgs media mode avoids tools allowlist and yolo", () => {
  const args = buildGrokArgs({
    prompt: "draw a banner",
    media: true,
    write: false,
    yolo: false
  });
  assert.ok(!args.includes("--tools"));
  assert.ok(!args.includes("--yolo"));
  assert.ok(args.includes("--disallowed-tools"));
  assert.ok(args.some((a) => String(a).includes("run_terminal_cmd")));
});

test("humanizeGrokFailure maps RequirementError tool dumps", () => {
  const msg = humanizeGrokFailure({
    stderr:
      'RequirementError { message: "run_terminal_cmd background param constraint with --tools allowlist" }',
    exitCode: 1
  });
  assert.match(msg, /tool configuration/i);
  assert.match(msg, /disallowed-tools/i);
  assert.ok(!/RequirementError \{/.test(msg));
});

test("humanizeGrokFailure maps auth failures", () => {
  const msg = humanizeGrokFailure({ stderr: "Error: not logged in" });
  assert.match(msg, /not authenticated/i);
  assert.match(msg, /grok login/i);
});

test("parseGrokJsonOutput humanizes bare RequirementError text", () => {
  const parsed = parseGrokJsonOutput(
    'Error: RequirementError { kind: "tools", detail: "run_terminal_cmd background" }'
  );
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /tool configuration|requirement error/i);
});
