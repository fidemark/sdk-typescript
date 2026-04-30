import { describe, it, expect } from "vitest";
import {
  validateTEEQuote,
  STUB_VERIFIER,
  ALWAYS_VALID_VERIFIER,
  type TEEQuote,
  type TEEVerifier,
} from "../../src/tee.js";

const HASH = "0x" + "ab".repeat(32);
const OTHER = "0x" + "cd".repeat(32);

const quote = (measuredHash: string): TEEQuote => ({
  technology: "stub",
  quote: "0x00",
  measuredContentHash: measuredHash,
});

describe("validateTEEQuote", () => {
  it("rejects when verifier returns null (stub default)", async () => {
    await expect(validateTEEQuote(STUB_VERIFIER, quote(HASH), HASH)).rejects.toMatchObject({
      code: "VALIDATION_REJECTED",
    });
  });

  it("accepts when measurement matches expected content hash", async () => {
    await validateTEEQuote(ALWAYS_VALID_VERIFIER, quote(HASH), HASH);
  });

  it("rejects when verifier's measurement disagrees with the expected hash", async () => {
    const verifier: TEEVerifier = {
      async verify() {
        return { measurement: OTHER };
      },
    };
    await expect(validateTEEQuote(verifier, quote(HASH), HASH)).rejects.toMatchObject({
      code: "VALIDATION_REJECTED",
    });
  });

  it("rejects when the quote's own measuredContentHash disagrees", async () => {
    await expect(
      validateTEEQuote(ALWAYS_VALID_VERIFIER, quote(OTHER), HASH),
    ).rejects.toMatchObject({ code: "VALIDATION_REJECTED" });
  });

  it("comparison is case-insensitive", async () => {
    await validateTEEQuote(ALWAYS_VALID_VERIFIER, quote(HASH.toUpperCase()), HASH);
  });
});
