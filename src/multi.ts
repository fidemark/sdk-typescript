/**
 * Multi-party co-attestation (Layer 2).
 *
 * N independent attesters each sign the same EIP-712 claim over a content
 * hash. A coordinator collects the signed slips and submits ONE on-chain
 * attestation containing all of them. The FidemarkMultiResolver recovers each
 * signature and validates it against the declared attesters[] array atomically.
 *
 * Use cases:
 *   - EU AI Act-style audits where multiple parties co-sign provenance.
 *   - Co-authored content (newsroom, research lab) attesting jointly.
 *   - Witness-style verification: third-party attesters co-sign creator claims.
 *
 * The coordinator who pays gas is irrelevant to the trust guarantee, anyone
 * can submit, the truth is in the signatures.
 */

import { TypedDataEncoder, type Signer, type TypedDataDomain } from "ethers";
import { hashContent } from "./hashing.js";
import { FidemarkError } from "./errors.js";
import type { NetworkConfig } from "./networks.js";

/** EIP-712 typed-data definition. Mirrors FidemarkMultiResolver.CLAIM_TYPEHASH. */
const CLAIM_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  MultiPartyClaim: [
    { name: "contentHash", type: "bytes32" },
    { name: "contentType", type: "string" },
    { name: "createdAt", type: "uint64" },
  ],
};

const DOMAIN_NAME = "Fidemark MultiParty";
const DOMAIN_VERSION = "1";

export interface MultiPartyClaim {
  /** SHA-256 of the content, 0x-prefixed 32 bytes. */
  contentHash: string;
  contentType: string;
  /** Unix seconds. Must match across all co-signers. */
  createdAt: number;
}

export interface MultiPartySlip {
  /** Address of the co-signer. Must match the recovered ECDSA address. */
  signer: string;
  /** EIP-712 signature, 0x-prefixed 65 bytes (r ‖ s ‖ v). */
  signature: string;
}

function requireMultiResolver(network: NetworkConfig): string {
  const addr = network.contracts.multiResolver;
  if (!addr) {
    throw new FidemarkError(
      "INVALID_INPUT",
      `Network ${network.name} has no multiResolver address. Multi-party attestation is unavailable.`,
    );
  }
  return addr;
}

function buildDomain(network: NetworkConfig): TypedDataDomain {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: network.chainId,
    verifyingContract: requireMultiResolver(network),
  };
}

/**
 * Compute the EIP-712 digest a co-signer must sign for a given claim. Useful
 * for verifying a slip without reconstructing the domain manually, or for
 * comparing against the resolver's `claimDigest()` view function.
 */
export function multiPartyClaimDigest(claim: MultiPartyClaim, network: NetworkConfig): string {
  const domain = buildDomain(network);
  return TypedDataEncoder.hash(domain, CLAIM_TYPES, claim);
}

/**
 * Sign one co-signer's slip for a multi-party claim. The returned object can
 * be sent over any transport (HTTP, file, queue) to the coordinator.
 *
 * Note: the SDK does NOT lock the slip to a specific verifying contract beyond
 * the chainId + resolver address baked into the domain. If those change (e.g.
 * a new MultiResolver deploy), old slips become invalid by design.
 */
export async function signMultiPartyClaim(
  signer: Signer,
  claim: MultiPartyClaim,
  network: NetworkConfig,
): Promise<MultiPartySlip> {
  const domain = buildDomain(network);
  const signerAddress = await signer.getAddress();
  const signature = await signer.signTypedData(domain, CLAIM_TYPES, claim);
  return { signer: signerAddress, signature };
}

/**
 * Helper: derive a normalized claim from raw content + a coordinator-chosen
 * timestamp. All co-signers must produce a slip from the SAME claim object,
 * use this to keep them in sync.
 */
export function buildMultiPartyClaim(input: {
  content: string | Uint8Array;
  contentType: string;
  createdAt?: number;
}): MultiPartyClaim {
  return {
    contentHash: hashContent(input.content),
    contentType: input.contentType,
    createdAt: input.createdAt ?? Math.floor(Date.now() / 1000),
  };
}

export const MULTI_PARTY_TYPES = CLAIM_TYPES;
export const MULTI_PARTY_DOMAIN_NAME = DOMAIN_NAME;
export const MULTI_PARTY_DOMAIN_VERSION = DOMAIN_VERSION;
