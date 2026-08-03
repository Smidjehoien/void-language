import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSocialScanAdapter } from "../src/socialscan-adapter.js";

const temporaryDirectories = [];

async function fakeBridge(source) {
  const directory = await mkdtemp(join(tmpdir(), "agent-adapter-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "bridge.py");
  await writeFile(path, source);
  await chmod(path, 0o700);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("normalizes a valid bridge response", async () => {
  const bridgePath = await fakeBridge('import sys\nsys.stdin.read()\nprint("{\\"ok\\":true,\\"checked\\":2,\\"matches\\":1}")\n');
  const adapter = createSocialScanAdapter({ bridgePath });
  expect(await adapter.query("private-value", ["one", "two"])).toEqual({ ok: true, checked: 2, matches: 1 });
});

test("rejects malformed output without leaking bridge content", async () => {
  const canary = "person@example.test https://secret.invalid raw-provider-message";
  const bridgePath = await fakeBridge(`import sys\nsys.stdin.read()\nprint(${JSON.stringify(canary)})\n`);
  const adapter = createSocialScanAdapter({ bridgePath });
  let caught;
  try {
    await adapter.query("private-value", ["one"]);
  } catch (error) {
    caught = error;
  }
  expect(caught.code).toBe("BRIDGE_OUTPUT_INVALID");
  expect(String(caught)).not.toContain(canary);
  expect(String(caught)).not.toContain("private-value");
});

test("maps timeouts to a retryable stable code", async () => {
  const bridgePath = await fakeBridge('import sys, time\nsys.stdin.read()\ntime.sleep(1)\n');
  const adapter = createSocialScanAdapter({ bridgePath, timeoutMs: 10 });
  let caught;
  try {
    await adapter.query("private-value", ["one"]);
  } catch (error) {
    caught = error;
  }
  expect(caught.code).toBe("BRIDGE_TIMEOUT");
  expect(caught.retryable).toBe(true);
});
