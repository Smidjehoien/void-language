import { expect, test } from "bun:test";

import { parseArgs } from "../scripts/agent-harness.js";

test("parses repeatable platforms and numeric options", () => {
  expect(parseArgs(["--input", "in.txt", "--output", "out.json", "--platform", "github", "--platform", "gitlab", "--concurrency", "2", "--retries", "1"])).toEqual({
    input: "in.txt", output: "out.json", platforms: ["github", "gitlab"], concurrency: 2, retries: 1, python: "python3",
  });
});

test("rejects unknown or incomplete flags", () => {
  expect(() => parseArgs(["--wat"])).toThrow("INVALID_CLI_OPTIONS");
  expect(() => parseArgs(["--input", "in.txt"])).toThrow("INVALID_CLI_OPTIONS");
  expect(() => parseArgs(["--input", "in.txt", "--output", "out.json", "--platform", "github", "--concurrency", "0"])).toThrow("INVALID_CLI_OPTIONS");
});
