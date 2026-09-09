import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installBufferGlobal } from "./bufferPolyfill";
import { defaultBridgeDeps } from "./midnightProviders";

/**
 * Several @midnight-ntwrk packages reach for Node's `Buffer` global without
 * importing it: compact-runtime's `toHex`/`fromHex` — which the wallet bridge
 * encodes and decodes every transaction with — plus platform-js and
 * wallet-sdk-address-format. A browser has no such global, so a deploy died on
 * the first serialised transaction with `ReferenceError: Buffer is not defined`.
 *
 * Vitest runs on Node, where the global is always there, which is why nothing
 * here caught it. These tests take it away to stand in for a browser.
 */

const globals = globalThis as { Buffer?: unknown };

/** Synchronous on purpose: the restore has to land before anything else runs. */
function asBrowser<T>(body: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
  delete globals.Buffer;
  try {
    return body();
  } finally {
    delete globals.Buffer;
    if (original) Object.defineProperty(globalThis, "Buffer", original);
  }
}

describe("Buffer in a browser", () => {
  it("is what the Midnight hex helpers fail on when it is missing", () => {
    asBrowser(() => {
      expect(() => defaultBridgeDeps.encode(Uint8Array.from([0xde, 0xad]))).toThrow(/Buffer is not defined/);
    });
  });

  it("lets the wallet bridge encode and decode once installed", () => {
    asBrowser(() => {
      installBufferGlobal();
      expect(defaultBridgeDeps.encode(Uint8Array.from([0xde, 0xad]))).toBe("dead");
      expect([...defaultBridgeDeps.decode("dead")]).toEqual([0xde, 0xad]);
    });
  });

  it("leaves a host that brings its own Buffer alone", () => {
    const own = globals.Buffer;
    installBufferGlobal();
    expect(globals.Buffer).toBe(own);
  });
});

describe("the browser entry", () => {
  const entry = readFileSync(path.resolve(import.meta.dirname, "..", "main.tsx"), "utf-8");

  /**
   * Installing the global works only because nothing has called Buffer yet, so
   * it has to be the first import the entry evaluates.
   */
  it("installs the global before importing anything else", () => {
    expect(entry.match(/^import .*$/m)?.[0]).toMatch(/bufferPolyfill/);
  });
});
