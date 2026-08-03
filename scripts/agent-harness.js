#!/usr/bin/env bun
import { rename, unlink, writeFile } from "node:fs/promises";

import { HarnessError, runHarness } from "../src/agent-harness.js";
import { createSocialScanAdapter } from "../src/socialscan-adapter.js";

export const HELP = `Usage: bun run agent:run -- --input <file> --output <file> --platform <name> [options]

Required:
  --input <file>          Newline-delimited query input
  --output <file>         Aggregate JSON report path
  --platform <name>       SocialScan platform (repeatable)

Options:
  --concurrency <number>  Concurrent queries (default: 4)
  --retries <number>      Retries per transient failure (default: 2)
  --python <executable>   Python executable (default: python3)
  --help                  Show this help
`;

export function parseArgs(args) {
  const options = { platforms: [], concurrency: 4, retries: 2, python: "python3" };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help") return { help: true };
    if (!["--input", "--output", "--platform", "--concurrency", "--retries", "--python"].includes(flag)) {
      throw new HarnessError("INVALID_CLI_OPTIONS");
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new HarnessError("INVALID_CLI_OPTIONS");
    if (flag === "--platform") options.platforms.push(value);
    else if (flag === "--concurrency") options.concurrency = Number(value);
    else if (flag === "--retries") options.retries = Number(value);
    else options[flag.slice(2)] = value;
  }
  if (!options.input || !options.output || options.platforms.length === 0) {
    throw new HarnessError("INVALID_CLI_OPTIONS");
  }
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 ||
      !Number.isSafeInteger(options.retries) || options.retries < 0 ||
      typeof options.python !== "string" || options.python.length === 0 ||
      options.platforms.some((platform) => !/^[A-Za-z0-9_-]+$/.test(platform))) {
    throw new HarnessError("INVALID_CLI_OPTIONS");
  }
  return options;
}

async function atomicWrite(path, contents) {
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function main(args = Bun.argv.slice(2)) {
  try {
    const cli = parseArgs(args);
    if (cli.help) {
      process.stdout.write(HELP);
      return 0;
    }
    const input = await Bun.file(cli.input).text();
    const queries = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (queries.length === 0) throw new HarnessError("INVALID_INPUT");
    const adapter = createSocialScanAdapter({ python: cli.python });
    await adapter.preflight(cli.platforms);
    const report = await runHarness({
      queries,
      platforms: cli.platforms,
      concurrency: cli.concurrency,
      maxRetries: cli.retries,
      adapter,
    });
    await atomicWrite(cli.output, `${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof HarnessError ? error.code : "AGENT_RUN_FAILED";
    process.stderr.write(`${code}\n`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main());
