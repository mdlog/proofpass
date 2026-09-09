import { Buffer } from "buffer";

/**
 * Installs Node's `Buffer` as a global when the host has none.
 *
 * Several @midnight-ntwrk packages call `Buffer` without importing it —
 * compact-runtime's `toHex`/`fromHex`, platform-js's byte codecs,
 * wallet-sdk-address-format's bech32m codecs. Bundled for a browser those
 * references resolve to nothing, and the first one a deploy reaches throws
 * `ReferenceError: Buffer is not defined`.
 *
 * Every one of them sits inside a function body rather than at module scope, so
 * installing the global before the app renders is early enough. The `buffer`
 * package is the shim the bundler already pulls in for the one Midnight package
 * that does import it, so this adds no second implementation.
 */
export function installBufferGlobal(host: { Buffer?: unknown } = globalThis): void {
  if (typeof host.Buffer === "undefined") host.Buffer = Buffer;
}

installBufferGlobal();
