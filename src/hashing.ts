import { sha256, toUtf8Bytes, hexlify, isHexString } from "ethers";

/**
 * Compute the canonical content hash. Accepts:
 *   - `string`, UTF-8 encoded then SHA-256.
 *   - `Uint8Array | Buffer`, hashed directly.
 *
 * Returns a 0x-prefixed 32-byte hex digest, ready for the `bytes32` schema field.
 */
export function hashContent(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? toUtf8Bytes(input) : input;
  return sha256(hexlify(bytes));
}

/**
 * Compute the canonical prompt hash. Same shape as `hashContent`, but accepts a
 * pre-computed digest as a passthrough, useful when the caller already hashed
 * the prompt off-band (e.g. enterprise pipelines that never expose plaintext).
 */
export function hashPrompt(input: string | Uint8Array): string {
  if (typeof input === "string" && isHexString(input, 32)) return input.toLowerCase();
  return hashContent(input);
}
