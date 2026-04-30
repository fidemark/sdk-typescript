/**
 * TEE-attested trust layer (Layer 3 in the PRD trust model).
 *
 * Status: **planned, not yet shippable.** The SDK exposes a forward-declared
 * surface (TEEQuote, TEEVerifier, validateTEEQuote) so application code can
 * be written against it now and adapted with minimal churn when the real
 * path lands. None of this provides any on-chain trust property today:
 *
 * - The Fidemark Resolver does NOT have `tee-attested` on its proofMethod
 *   allowlist. Production attestations claiming this label would revert.
 * - There is no on-chain TDX/SGX quote verifier integration. A real Layer 3
 *   will ship as a new schema + resolver pair that calls a verifier contract
 *   (e.g. Automata DCAP) during attest, analogous to how Layer 4 (PoP)
 *   calls IWorldID.verifyProof.
 *
 * `Fidemark.attestHumanWithTEE()` therefore throws NOT_YET_IMPLEMENTED by
 * default; the off-chain validation path can be exercised in development by
 * passing the explicit `acknowledgeOffchainOnlyTrust` flag.
 */

import { FidemarkError } from "./errors.js";

export interface TEEQuote {
  /** The TEE technology that produced this quote. */
  technology: "intel-tdx" | "amd-sev-snp" | "intel-sgx" | "eigencloud" | "stub";
  /** Raw quote bytes (DER, hex-encoded). */
  quote: string;
  /** Optional certificate chain (hex). */
  certs?: string[];
  /** The content hash that the TEE measured during execution. */
  measuredContentHash: string;
}

export interface TEEVerifier {
  /**
   * Validate a TEE quote. Return `null` if invalid; on success, return the
   * extracted measurement (typically a hash of the code that ran inside the
   * TEE) so callers can correlate it with the content being attested.
   */
  verify(quote: TEEQuote): Promise<{ measurement: string } | null>;
}

/**
 * Stub verifier, always rejects. Replace with a real implementation in
 * `Fidemark` config (`teeVerifier`) when integrating Intel TDX / EigenCloud.
 */
export const STUB_VERIFIER: TEEVerifier = {
  async verify() {
    return null;
  },
};

/** Convenience for tests, always accepts. NEVER use in production. */
export const ALWAYS_VALID_VERIFIER: TEEVerifier = {
  async verify(quote) {
    return { measurement: quote.measuredContentHash };
  },
};

/**
 * Validate a quote and assert it covers the given content hash. Used by
 * `Fidemark.attestHumanWithTEE` before issuing the on-chain attestation.
 */
export async function validateTEEQuote(
  verifier: TEEVerifier,
  quote: TEEQuote,
  expectedContentHash: string,
): Promise<void> {
  const result = await verifier.verify(quote);
  if (!result) {
    throw new FidemarkError(
      "VALIDATION_REJECTED",
      "TEE quote failed verification.",
    );
  }
  if (result.measurement.toLowerCase() !== expectedContentHash.toLowerCase()) {
    throw new FidemarkError(
      "VALIDATION_REJECTED",
      "TEE measurement does not match content hash. Tampered or wrong content.",
    );
  }
  if (quote.measuredContentHash.toLowerCase() !== expectedContentHash.toLowerCase()) {
    throw new FidemarkError(
      "VALIDATION_REJECTED",
      "Quote's measuredContentHash does not match content hash.",
    );
  }
}
