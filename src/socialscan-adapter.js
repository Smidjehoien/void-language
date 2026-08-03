import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { HarnessError } from "./agent-harness.js";

const DEFAULT_BRIDGE = fileURLToPath(new URL("../scripts/socialscan-bridge.py", import.meta.url));
const STABLE_CODES = new Set([
  "BRIDGE_CONFIGURATION",
  "BRIDGE_IMPORT_FAILURE",
  "BRIDGE_INPUT_INVALID",
  "BRIDGE_EXECUTION_FAILURE",
  "BRIDGE_OUTPUT_INVALID",
  "BRIDGE_TIMEOUT",
  "PLATFORM_INVALID",
]);
const RETRYABLE_CODES = new Set(["BRIDGE_EXECUTION_FAILURE", "BRIDGE_TIMEOUT"]);

function stableError(code) {
  const stableCode = STABLE_CODES.has(code) ? code : "BRIDGE_EXECUTION_FAILURE";
  return new HarnessError(stableCode, { retryable: RETRYABLE_CODES.has(stableCode) });
}

function runBridge({ python, bridgePath, timeoutMs, request }) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let settled = false;
    let child;
    try {
      child = spawn(python, [bridgePath], { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      reject(stableError("BRIDGE_CONFIGURATION"));
      return;
    }

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(stableError("BRIDGE_TIMEOUT")));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1_000_000) child.kill("SIGKILL");
    });
    child.stderr.resume();
    child.on("error", () => finish(() => reject(stableError("BRIDGE_CONFIGURATION"))));
    child.on("close", () => finish(() => {
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(stableError("BRIDGE_OUTPUT_INVALID"));
        return;
      }
      if (!parsed || typeof parsed !== "object" || typeof parsed.ok !== "boolean") {
        reject(stableError("BRIDGE_OUTPUT_INVALID"));
        return;
      }
      if (!parsed.ok) {
        reject(stableError(parsed.code));
        return;
      }
      resolve(parsed);
    }));
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

export function createSocialScanAdapter(options = {}) {
  const settings = {
    python: options.python ?? "python3",
    bridgePath: options.bridgePath ?? DEFAULT_BRIDGE,
    timeoutMs: options.timeoutMs ?? 30_000,
  };
  if (typeof settings.python !== "string" || settings.python.length === 0 ||
      typeof settings.bridgePath !== "string" || settings.bridgePath.length === 0 ||
      !Number.isSafeInteger(settings.timeoutMs) || settings.timeoutMs < 1) {
    throw stableError("BRIDGE_CONFIGURATION");
  }

  return {
    async preflight(platforms) {
      const response = await runBridge({ ...settings, request: { action: "preflight", platforms } });
      if (response.ready !== true) throw stableError("BRIDGE_OUTPUT_INVALID");
    },
    async query(query, platforms) {
      const response = await runBridge({ ...settings, request: { action: "query", query, platforms } });
      if (!Number.isSafeInteger(response.checked) || response.checked < 0 ||
          !Number.isSafeInteger(response.matches) || response.matches < 0 ||
          response.matches > response.checked) {
        throw stableError("BRIDGE_OUTPUT_INVALID");
      }
      return { ok: true, checked: response.checked, matches: response.matches };
    },
  };
}
