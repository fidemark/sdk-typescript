/**
 * Proof-of-personhood (Layer 4) helpers.
 *
 * Mirrors World ID's hash-to-field conventions so frontends and on-chain
 * resolvers compute identical signal / externalNullifier values.
 *
 * Domain:
 *   - signal     = abi.encodePacked(contentHash, attester) -> hashToField
 *   - action     = "fidemark.attest.v1:" + contentHash (lowercase hex with 0x)
 *   - extNul     = abi.encodePacked(appId, action) -> hashToField
 *   - hashToField(x) = uint256(keccak256(x)) >> 8
 *
 * Frontends pass `action` (and the `signal` content + attester) to IDKit;
 * IDKit's verifier produces a proof tied to those values. The on-chain
 * `FidemarkPoPResolver` recomputes the same digests from the encoded
 * attestation data and calls `IWorldID.verifyProof` against them.
 */

import { keccak256, solidityPacked, type BytesLike } from "ethers";

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
  return hashToField(solidityPacked(["string", "string"], [appId, action]));
}

/** Compute the signalHash matching `FidemarkPoPResolver.signalHashFor`. */
export function signalHashFor(contentHash: string, attester: string): bigint {
  return hashToField(solidityPacked(["bytes32", "address"], [contentHash, attester]));
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
