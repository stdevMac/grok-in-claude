import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, splitRawArgumentString } from "../plugins/grok/scripts/lib/args.mjs";

test("parseArgs handles booleans and values", () => {
  const { options, positionals } = parseArgs(
    ["--background", "--model", "fast", "--effort=high", "fix the bug"],
    {
      booleanOptions: ["background"],
      valueOptions: ["model", "effort"]
    }
  );

  assert.equal(options.background, true);
  assert.equal(options.model, "fast");
  assert.equal(options.effort, "high");
  assert.deepEqual(positionals, ["fix the bug"]);
});

test("splitRawArgumentString respects quotes", () => {
  const tokens = splitRawArgumentString(`--model fast "fix the 'quoted' bug"`);
  assert.deepEqual(tokens, ["--model", "fast", "fix the 'quoted' bug"]);
});
