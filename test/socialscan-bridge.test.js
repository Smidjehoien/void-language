import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bridgePath = new URL("../scripts/socialscan-bridge.py", import.meta.url).pathname;
const temporaryDirectories = [];

async function fakeSocialScan() {
  const directory = await mkdtemp(join(tmpdir(), "fake-socialscan-"));
  temporaryDirectories.push(directory);
  const packageDirectory = join(directory, "socialscan");
  await mkdir(packageDirectory);
  await writeFile(join(packageDirectory, "util.py"), [
    "from enum import Enum",
    "class Platforms(Enum):",
    "    GITHUB = 'github'",
    "    GITLAB = 'gitlab'",
    "async def execute_queries(queries, platforms):",
    "    return {queries[0]: {platforms[0].value: {'success': True, 'valid': True, 'available': False}, platforms[1].value: {'success': True, 'valid': True, 'available': True}}}",
    "",
  ].join("\n"));
  await writeFile(join(packageDirectory, "__init__.py"), "");
  return directory;
}

async function fakeObjectSocialScan() {
  const directory = await mkdtemp(join(tmpdir(), "fake-socialscan-objects-"));
  temporaryDirectories.push(directory);
  const packageDirectory = join(directory, "socialscan");
  await mkdir(packageDirectory);
  await writeFile(join(packageDirectory, "util.py"), [
    "from dataclasses import dataclass",
    "from enum import Enum",
    "class Platforms(Enum):",
    "    GITHUB = 'github'",
    "    GITLAB = 'gitlab'",
    "@dataclass",
    "class PlatformResponse:",
    "    success: bool",
    "    valid: bool",
    "    available: bool",
    "async def execute_queries(queries, platforms):",
    "    return [",
    "        PlatformResponse(success=True, valid=True, available=False),",
    "        PlatformResponse(success=True, valid=True, available=True),",
    "        PlatformResponse(success=False, valid=True, available=False),",
    "        PlatformResponse(success=True, valid=False, available=False),",
    "    ]",
    "",
  ].join("\n"));
  await writeFile(join(packageDirectory, "__init__.py"), "");
  return directory;
}

async function invokeBridge(request, pythonPath) {
  const process = Bun.spawn(["python3", bridgePath], {
    env: { ...Bun.env, PYTHONPATH: pythonPath },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  process.stdin.write(JSON.stringify(request));
  process.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("bridge resolves platforms and sanitizes nested SocialScan results", async () => {
  const pythonPath = await fakeSocialScan();
  const result = await invokeBridge({ action: "query", query: "private-value", platforms: ["github", "gitlab"] }, pythonPath);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({ ok: true, checked: 2, matches: 1 });
  expect(result.stdout).not.toContain("private-value");
});

test("bridge classifies object-shaped PlatformResponse availability", async () => {
  const pythonPath = await fakeObjectSocialScan();
  const result = await invokeBridge({ action: "query", query: "object-private-value", platforms: ["github", "gitlab"] }, pythonPath);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({ ok: true, checked: 4, matches: 1 });
  expect(result.stdout).not.toContain("object-private-value");
});

test("bridge returns only a stable code for invalid platforms", async () => {
  const pythonPath = await fakeSocialScan();
  const result = await invokeBridge({ action: "preflight", platforms: ["secret-platform"] }, pythonPath);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({ ok: false, code: "PLATFORM_INVALID" });
  expect(result.stdout).not.toContain("secret-platform");
});
