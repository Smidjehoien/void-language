export class HarnessError extends Error {
  constructor(code, { retryable = false } = {}) {
    super(code);
    this.name = "HarnessError";
    this.code = code;
    this.retryable = retryable;
  }
}

const POSITIVE_INTEGER_FIELDS = ["concurrency", "maxRetries"];

export function validateOptions(options = {}) {
  const concurrency = options.concurrency ?? 4;
  const maxRetries = options.maxRetries ?? 2;

  for (const field of POSITIVE_INTEGER_FIELDS) {
    const value = field === "concurrency" ? concurrency : maxRetries;
    const minimum = field === "maxRetries" ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new HarnessError("INVALID_OPTIONS");
    }
  }

  if (!Array.isArray(options.queries) || options.queries.length === 0) {
    throw new HarnessError("INVALID_OPTIONS");
  }
  if (!Array.isArray(options.platforms) || options.platforms.length === 0) {
    throw new HarnessError("INVALID_OPTIONS");
  }
  if (options.queries.some((query) => typeof query !== "string" || query.trim() === "")) {
    throw new HarnessError("INVALID_OPTIONS");
  }
  if (options.platforms.some((platform) => typeof platform !== "string" || !/^[A-Za-z0-9_-]+$/.test(platform))) {
    throw new HarnessError("INVALID_OPTIONS");
  }
  if (!options.adapter || typeof options.adapter.query !== "function") {
    throw new HarnessError("INVALID_OPTIONS");
  }

  return {
    concurrency,
    maxRetries,
    queries: [...options.queries],
    platforms: [...new Set(options.platforms)],
    adapter: options.adapter,
    sleep: options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds)),
    random: options.random ?? Math.random,
    baseDelayMs: options.baseDelayMs ?? 250,
    maxDelayMs: options.maxDelayMs ?? 4_000,
  };
}

function validateAdapterResponse(response, maximumChecks) {
  if (
    !response ||
    typeof response !== "object" ||
    response.ok !== true ||
    !Number.isSafeInteger(response.checked) ||
    response.checked < 0 ||
    !Number.isSafeInteger(response.matches) ||
    response.matches < 0 ||
    response.matches > response.checked ||
    response.checked > maximumChecks
  ) {
    throw new HarnessError("MALFORMED_ADAPTER_RESPONSE");
  }
  return response;
}

function normalizeError(error) {
  if (error instanceof HarnessError) return error;
  if (error && typeof error === "object" && typeof error.code === "string") {
    return new HarnessError(error.code, { retryable: error.retryable === true });
  }
  return new HarnessError("ADAPTER_FAILURE");
}

function retryDelay(attempt, options) {
  const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * (2 ** attempt));
  return Math.floor(exponential * (0.75 + options.random() * 0.5));
}

async function runQuery(query, options) {
  let attempts = 0;
  while (true) {
    attempts += 1;
    try {
      const response = validateAdapterResponse(
        await options.adapter.query(query, options.platforms),
        options.platforms.length,
      );
      return { success: true, attempts, checked: response.checked, matches: response.matches };
    } catch (caught) {
      const error = normalizeError(caught);
      const retriesUsed = attempts - 1;
      if (!error.retryable || retriesUsed >= options.maxRetries) {
        return { success: false, attempts, checked: 0, matches: 0, code: error.code };
      }
      await options.sleep(retryDelay(retriesUsed, options));
    }
  }
}

export function createReport(results, platformCount) {
  const failuresByCode = {};
  const aggregate = {
    totalQueries: results.length,
    successfulQueries: 0,
    failedQueries: 0,
    totalAttempts: 0,
    platformChecksRequested: results.length * platformCount,
    platformChecksCompleted: 0,
    matches: 0,
    failuresByCode,
  };

  for (const result of results) {
    aggregate.totalAttempts += result.attempts;
    if (result.success) {
      aggregate.successfulQueries += 1;
      aggregate.platformChecksCompleted += result.checked;
      aggregate.matches += result.matches;
    } else {
      aggregate.failedQueries += 1;
      const code = /^[A-Z0-9_]+$/.test(result.code ?? "") ? result.code : "ADAPTER_FAILURE";
      failuresByCode[code] = (failuresByCode[code] ?? 0) + 1;
    }
  }

  return { schemaVersion: 1, aggregate };
}

export async function runHarness(input) {
  const options = validateOptions(input);
  const results = new Array(options.queries.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= options.queries.length) return;
      results[index] = await runQuery(options.queries[index], options);
    }
  }

  const workerCount = Math.min(options.concurrency, options.queries.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return createReport(results, options.platforms.length);
}
