import { describe, it, expect } from "vitest";
import { FidemarkError, mapChainError } from "../../src/errors.js";

describe("FidemarkError", () => {
  it("preserves the original error as cause", () => {
    const original = new Error("rpc bang");
    const wrapped = new FidemarkError("RPC_ERROR", "wrapped", original);
    expect(wrapped.code).toBe("RPC_ERROR");
    expect(wrapped.cause).toBe(original);
  });
});

describe("mapChainError", () => {
  it("maps user rejection to USER_REJECTED", () => {
    const out = mapChainError({ code: "ACTION_REJECTED", message: "rejected" });
    expect(out.code).toBe("USER_REJECTED");
  });

  it("maps insufficient funds", () => {
    const out = mapChainError({ code: "INSUFFICIENT_FUNDS", message: "no eth" });
    expect(out.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("translates resolver custom errors to validation rejections", () => {
    const cases: { reason: string; expected: string }[] = [
      { reason: "execution reverted: EmptyContentHash()", expected: "Content hash cannot be zero" },
      { reason: "EmptyField(\"contentType\")", expected: "required attestation field was empty" },
      { reason: "CreatorMismatch()", expected: "creator must match" },
      { reason: "UnknownProofMethod()", expected: "allowlist" },
      { reason: "UnknownSchema()", expected: "Wrong network" },
      { reason: "TimestampTooFarInFuture()", expected: "client clock" },
    ];
    for (const c of cases) {
      const out = mapChainError({ shortMessage: c.reason });
      expect(out.code).toBe("VALIDATION_REJECTED");
      expect(out.message).toContain(c.expected);
    }
  });

  it("falls back to RPC_ERROR for unrecognized failures", () => {
    const out = mapChainError({ message: "network blip" });
    expect(out.code).toBe("RPC_ERROR");
    expect(out.message).toBe("network blip");
  });
});
