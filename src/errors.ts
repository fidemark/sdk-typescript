/**
 * Surface every SDK failure as a single typed error with a stable code, so
 * callers can branch on `err.code` without parsing strings.
 */

export type FidemarkErrorCode =
  | "NETWORK_NOT_DEPLOYED"
  | "INVALID_INPUT"
  | "ATTESTATION_NOT_FOUND"
  | "ATTESTATION_REVOKED"
  | "INSUFFICIENT_FUNDS"
  | "VALIDATION_REJECTED"
  | "USER_REJECTED"
  | "RPC_ERROR"
  | "NOT_YET_IMPLEMENTED"
  | "UNKNOWN";

export class FidemarkError extends Error {
  readonly code: FidemarkErrorCode;
  readonly cause?: unknown;

  constructor(code: FidemarkErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "FidemarkError";
    this.code = code;
    this.cause = cause;
  }
}

/** Map an ethers/EAS error into a FidemarkError with a useful message. */
export function mapChainError(err: unknown): FidemarkError {
  const e = err as {
    code?: string;
    reason?: string;
    shortMessage?: string;
    message?: string;
    data?: unknown;
    info?: { error?: { data?: unknown; message?: string } };
  };
  const reason = e?.shortMessage ?? e?.reason ?? e?.message ?? "unknown chain error";

  if (e?.code === "ACTION_REJECTED") {
    return new FidemarkError("USER_REJECTED", "User rejected the transaction.", err);
  }
  if (e?.code === "INSUFFICIENT_FUNDS") {
    return new FidemarkError("INSUFFICIENT_FUNDS", "Insufficient funds for gas on this network.", err);
  }

  // Look at the entire error tree (including ethers' nested `info.error.data`)
  // because resolver custom errors arrive as opaque revert data the EAS-only
  // ABI can't decode. Stringifying surfaces them by name.
  const haystack = `${reason} ${safeStringify(e?.data)} ${safeStringify(e?.info)}`;

  if (typeof haystack === "string") {
    if (haystack.includes("EmptyContentHash")) {
      return new FidemarkError("VALIDATION_REJECTED", "Content hash cannot be zero.", err);
    }
    if (haystack.includes("EmptyField")) {
      return new FidemarkError("VALIDATION_REJECTED", "A required attestation field was empty.", err);
    }
    if (haystack.includes("FieldTooLong")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "A string field exceeded the resolver's length bound (proofMethod ≤ 64, contentType ≤ 128).",
        err,
      );
    }
    if (haystack.includes("EnforcedPause")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "The resolver is paused. Attestations are temporarily disabled by the resolver owner.",
        err,
      );
    }
    if (haystack.includes("CreatorMismatch")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "Human Proof creator must match the signing wallet.",
        err,
      );
    }
    if (haystack.includes("UnknownProofMethod")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "proofMethod is not on the resolver allowlist.",
        err,
      );
    }
    if (haystack.includes("UnknownSchema")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "The resolver does not recognize this schema. Wrong network?",
        err,
      );
    }
    if (haystack.includes("TimestampTooFarInFuture")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "createdAt is too far in the future. Check your client clock.",
        err,
      );
    }
    if (haystack.includes("NullifierAlreadyUsed")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "This World ID nullifier has already attested this content.",
        err,
      );
    }
    if (haystack.includes("InvalidProof")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "World ID proof verification failed.",
        err,
      );
    }
    if (haystack.includes("WorldIdNotConfigured")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "PoP resolver has no World ID verifier or app id configured.",
        err,
      );
    }
    if (haystack.includes("InvalidSignature")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "Multi-party signature did not recover to the declared attester.",
        err,
      );
    }
    if (haystack.includes("DuplicateAttester")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "Duplicate attester address in multi-party slips.",
        err,
      );
    }
    if (haystack.includes("AttesterCountMismatch") || haystack.includes("TooFewAttesters") || haystack.includes("TooManyAttesters")) {
      return new FidemarkError(
        "VALIDATION_REJECTED",
        "Multi-party attester / signature count is invalid.",
        err,
      );
    }
    // Fallback: a chain-level revert during an attest/revoke flow that didn't
    // surface a decoded custom error (the resolver's errors aren't in the EAS
    // contract ABI ethers used to decode). Classify as validation, not RPC.
    if (/execution reverted|reverted|could not coalesce/i.test(haystack)) {
      return new FidemarkError("VALIDATION_REJECTED", `Resolver rejected the attestation: ${reason}`, err);
    }
  }

  return new FidemarkError("RPC_ERROR", reason, err);
}

function safeStringify(v: unknown): string {
  if (v == null) return "";
  try {
    return JSON.stringify(v, (_, val) => (typeof val === "bigint" ? val.toString() : val));
  } catch {
    return String(v);
  }
}
