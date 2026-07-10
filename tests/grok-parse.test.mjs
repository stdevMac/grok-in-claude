import assert from "node:assert/strict";
import test from "node:test";

import { buildGrokArgs, parseGrokJsonOutput } from "../plugins/grok/scripts/lib/grok.mjs";

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
