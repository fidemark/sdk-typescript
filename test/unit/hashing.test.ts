import { describe, it, expect } from "vitest";
import { hashContent, hashPrompt } from "../../src/hashing.js";

describe("hashContent", () => {
  it("produces a deterministic 32-byte hex digest for strings", () => {
    const out = hashContent("hello");
    expect(out).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashContent("hello")).toEqual(out);
  });

  it("produces a different digest for different content", () => {
    expect(hashContent("hello")).not.toEqual(hashContent("world"));
  });

  it("matches the expected SHA-256 of a known string", () => {
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(hashContent("hello")).toEqual(
      "0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("handles binary input", () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const out = hashContent(bytes);
    expect(out).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("hashPrompt", () => {
  it("passes through a pre-computed bytes32 hex digest", () => {
    const digest = "0x" + "ab".repeat(32);
    expect(hashPrompt(digest)).toEqual(digest);
  });

  it("normalizes uppercase hex passthrough to lowercase", () => {
    const digest = "0x" + "AB".repeat(32);
    expect(hashPrompt(digest)).toEqual("0x" + "ab".repeat(32));
  });

  it("hashes plaintext when not a digest", () => {
    expect(hashPrompt("write a poem")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
