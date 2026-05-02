/**
 * Proof-of-personhood (Layer 4) helpers.
 *
 * Mirrors World ID's hash-to-field conventions so frontends and on-chain
 * resolvers compute identical signal / externalNullifier values.
 *
 * Domain (matches `FidemarkPoPResolver`):
 *   - action     = `f1{first28HexCharsOfContentHash}` (30 chars)
 *   - signal     = lowercase string `"0x<contentHash_hex>:0x<attester_hex>"`
 *                  (109 chars) -> hashToField
 *   - extNul     = hashToField(hashToField(appId) || action)
 *                  (two-pass per Worldcoin's official template)
 *   - hashToField(x) = uint256(keccak256(x)) >> 8
 *
 * Single-pass `hashToField(appId || action)` does NOT match what IDKit's
 * WASM bakes into the proof, the legacy formula was wrong and shipped with
 * an early build of the resolver; the canonical formula is the one above.
 */

import { keccak256, solidityPacked, toUtf8Bytes, type BytesLike } from "ethers";

export interface WorldIdProof {
  /** Merkle root of the World ID identity tree at proof time. */
  root: string | bigint;
  /** Unique per (user, externalNullifier). */
  nullifierHash: string | bigint;
  /** Groth16 proof, 8 uint256 elements. */
  proof: [
    string | bigint,
    string | bigint,
    string | bigint,
    string | bigint,
    string | bigint,
    string | bigint,
    string | bigint,
    string | bigint,
  ];
}

/** World ID's hash-to-field reduction: keccak256(input) >> 8 (BN254 field-fit). */
export function hashToField(input: BytesLike): bigint {
  return BigInt(keccak256(input)) >> 8n;
}

/**
 * Canonical World ID action string for a Fidemark attestation of `contentHash`.
 * Format: `f1{first28HexCharsOfContentHash}` (30 chars total, alphanumeric only).
 * Worldcoin's Developer Portal caps identifiers at 32 chars and strips
 * non-alphanumeric characters, so we use a 2-char prefix + 28 hex chars (= 14
 * bytes = 112 bits of entropy).
 */
export function actionForContent(contentHash: string): string {
  const lower = contentHash.toLowerCase();
  const hex = lower.startsWith("0x") ? lower.slice(2) : lower;
  return `f1${hex.slice(0, 28)}`;
}

/** Compute the externalNullifier matching `FidemarkPoPResolver.externalNullifierFor`. */
export function externalNullifierFor(appId: string, contentHash: string): bigint {
  const action = actionForContent(contentHash);
  const appIdHash = hashToField(toUtf8Bytes(appId));
  // abi.encodePacked(uint256, string) = 32-byte uint256 || UTF-8 bytes of action.
  return hashToField(solidityPacked(["uint256", "string"], [appIdHash, action]));
}

/**
 * Canonical signal STRING the dapp must pass to IDKit's `orbLegacy({ signal })`.
 * Returns the lowercase `"0x<contentHash_hex>:0x<attester_hex>"` (109 chars).
 */
export function signalStringFor(contentHash: string, attester: string): string {
  const ch = contentHash.toLowerCase();
  const att = attester.toLowerCase();
  const chPrefixed = ch.startsWith("0x") ? ch : `0x${ch}`;
  const attPrefixed = att.startsWith("0x") ? att : `0x${att}`;
  return `${chPrefixed}:${attPrefixed}`;
}

/** Compute the signalHash matching `FidemarkPoPResolver.signalHashFor`. */
export function signalHashFor(contentHash: string, attester: string): bigint {
  return hashToField(toUtf8Bytes(signalStringFor(contentHash, attester)));
}

/** Normalize a World ID proof into the array-of-bigints shape the SDK consumes. */
export function normalizeWorldIdProof(p: WorldIdProof): {
  root: bigint;
  nullifierHash: bigint;
  proof: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
} {
  const toBig = (v: string | bigint): bigint => (typeof v === "bigint" ? v : BigInt(v));
  return {
    root: toBig(p.root),
    nullifierHash: toBig(p.nullifierHash),
    proof: p.proof.map(toBig) as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ],
  };
}
