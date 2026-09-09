/**
 * Turns an unknown throwable into something readable.
 *
 * The Midnight SDK is built on Effect, whose failures often carry an empty
 * `message` and put the real detail in a nested `cause` — so a plain
 * `error.message` reads as "" and `String(cause)` as "[object Object]". This
 * walks the chain and keeps whatever fields are actually there.
 */

const MAX_DEPTH = 5;
const MAX_STACK_LINES = 12;

/**
 * Effect builds causes with `Object.create(null)`, which has no `toString`, so
 * a bare `String(value)` throws "Cannot convert object to primitive value".
 */
function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    try {
      return Object.prototype.toString.call(value);
    } catch {
      return "(unprintable)";
    }
  }
}

function ownProperties(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "stack" || key === "message" || key === "name" || key === "cause") continue;
    try {
      const raw = (value as Record<string, unknown>)[key];
      if (raw === undefined || typeof raw === "function") continue;
      out[key] = typeof raw === "object" && raw !== null ? summarise(raw) : raw;
    } catch { /* getters may throw */ }
  }
  return out;
}

function summarise(value: unknown): unknown {
  try {
    const text = JSON.stringify(value);
    if (text && text !== "{}") return JSON.parse(text.slice(0, 600));
  } catch { /* circular or non-serialisable */ }
  return safeString(value).slice(0, 300);
}

export type DescribedError = {
  name: string;
  message: string;
  text: string;
  stack?: string;
  properties?: Record<string, unknown>;
  cause?: DescribedError;
};

export function describeError(error: unknown, depth = 0): DescribedError {
  if (depth > MAX_DEPTH) return { name: "…", message: "(cause chain truncated)", text: "" };

  if (!(error instanceof Error)) {
    return { name: typeof error, message: "", text: safeString(error).slice(0, 400), properties: error && typeof error === "object" ? ownProperties(error) : undefined };
  }

  const properties = ownProperties(error);
  return {
    name: error.name,
    message: error.message,
    // Effect errors frequently render their detail only through toString().
    text: safeString(error).slice(0, 800),
    stack: error.stack ? error.stack.split("\n").slice(0, MAX_STACK_LINES).join("\n") : undefined,
    properties: Object.keys(properties).length ? properties : undefined,
    cause: error.cause === undefined ? undefined : describeError(error.cause, depth + 1),
  };
}

/**
 * Effect wraps the real failure in `cause.properties.failure`, where it keeps
 * its own `message` — so the chain's own `message` fields stay empty all the way
 * down and a naive walk finds nothing to show. Look inside the properties too.
 */
function messageFromProperties(properties?: Record<string, unknown>): string | undefined {
  if (!properties) return undefined;
  for (const key of ["failure", "error", "defect", "cause"]) {
    const nested = properties[key];
    if (nested && typeof nested === "object") {
      const message = (nested as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
  }
  const own = properties.message;
  return typeof own === "string" && own ? own : undefined;
}

/** The first meaningful message anywhere in the chain, for showing to a user. */
export function readableMessage(error: unknown, fallback = "The wallet did not complete the action."): string {
  let described: DescribedError | undefined = describeError(error);
  while (described) {
    if (described.message) return described.message;
    const fromProperties = messageFromProperties(described.properties);
    if (fromProperties) return fromProperties;
    if (described.text && described.text !== "[object Object]" && !/^\w*Error$/.test(described.text)) return described.text;
    described = described.cause;
  }
  return fallback;
}
