import { describe, expect, test } from "bun:test";

import { HarnessError, runHarness, validateOptions } from "../src/agent-harness.js";

const noSleep = async () => {};

describe("agent harness", () => {
  test("caps concurrency with multiple jobs", async () => {
    let active = 0;
    let peak = 0;
    const adapter = { query: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(5);
      active -= 1;
      return { ok: true, checked: 1, matches: 0 };
    } };
    await runHarness({ queries: ["a", "b", "c", "d"], platforms: ["x"], concurrency: 2, adapter });
    expect(peak).toBe(2);
  });

  test("retries transient failure then succeeds", async () => {
    let calls = 0;
    const adapter = { query: async () => {
      calls += 1;
      if (calls === 1) throw new HarnessError("BRIDGE_TIMEOUT", { retryable: true });
      return { ok: true, checked: 2, matches: 1 };
    } };
    const report = await runHarness({ queries: ["a"], platforms: ["x", "y"], adapter, sleep: noSleep, random: () => 0 });
    expect(report.aggregate.totalAttempts).toBe(2);
    expect(report.aggregate.successfulQueries).toBe(1);
  });

  test("does not retry permanent failure and continues peers", async () => {
    const adapter = { query: async (query) => {
      if (query === "bad") throw new HarnessError("PLATFORM_INVALID");
      return { ok: true, checked: 2, matches: 1 };
    } };
    const report = await runHarness({ queries: ["bad", "good"], platforms: ["x", "y"], adapter, sleep: noSleep });
    expect(report.aggregate).toEqual({
      totalQueries: 2,
      successfulQueries: 1,
      failedQueries: 1,
      totalAttempts: 2,
      platformChecksRequested: 4,
      platformChecksCompleted: 2,
      matches: 1,
      failuresByCode: { PLATFORM_INVALID: 1 },
    });
  });

  test("sanitizes recognizable canaries from reports", async () => {
    const canaries = ["person@example.test", "unique_username", "https://secret.invalid/profile", "provider raw message"];
    const adapter = { query: async () => {
      const error = new Error(canaries.join(" "));
      error.code = "unsafe code person@example.test";
      throw error;
    } };
    const report = await runHarness({ queries: [canaries[0]], platforms: ["x"], adapter });
    const serialized = JSON.stringify(report);
    for (const canary of canaries) expect(serialized).not.toContain(canary);
    expect(report.aggregate.failuresByCode.ADAPTER_FAILURE).toBe(1);
  });

  test("validates empty and malformed options", () => {
    const adapter = { query: async () => ({ ok: true, checked: 1, matches: 0 }) };
    expect(() => validateOptions({ queries: [], platforms: ["x"], adapter })).toThrow("INVALID_OPTIONS");
    expect(() => validateOptions({ queries: ["a"], platforms: [], adapter })).toThrow("INVALID_OPTIONS");
    expect(() => validateOptions({ queries: ["a"], platforms: ["x"], concurrency: 0, adapter })).toThrow("INVALID_OPTIONS");
  });

  test("fails malformed adapter output safely", async () => {
    const report = await runHarness({ queries: ["a"], platforms: ["x"], adapter: { query: async () => ({ raw: "secret" }) } });
    expect(report.aggregate.failedQueries).toBe(1);
    expect(report.aggregate.failuresByCode.MALFORMED_ADAPTER_RESPONSE).toBe(1);
    expect(JSON.stringify(report)).not.toContain("secret");
  });
});
