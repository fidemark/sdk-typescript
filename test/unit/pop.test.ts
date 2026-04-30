import { describe, it, expect } from "vitest";
import { keccak256, solidityPacked } from "ethers";
import {
  actionForContent,
  externalNullifierFor,
  hashToField,
  normalizeWorldIdProof,
  signalHashFor,
} from "../../src/index.js";

describe("hashToField", () => {
  it("equals keccak256(input) >> 8", () => {
    const input = "0xdeadbeef";
    const h = BigInt(keccak256(input)) >> 8n;
    expect(hashToField(input)).toBe(h);
  });

  it("is deterministic and 254-bit (fits in BN254 scalar field)", () => {
    const a = hashToField("0x01");
    const b = hashToField("0x01");
    expect(a).toBe(b);
    expect(a < 1n << 254n).toBe(true);
  });
});

describe("actionForContent", () => {
  it("emits the 30-char alphanumeric `f1<28 hex>` format World ID's portal accepts", () => {
    const ch = "0x" + "ab".repeat(32);
    const action = actionForContent(ch);
    expect(action).toBe("f1" + "ab".repeat(14));
    expect(action.length).toBe(30);
    expect(/^[a-zA-Z0-9]+$/.test(action)).toBe(true);
  });

  it("lowercases the hex regardless of input case", () => {
    const upper = "0x" + "AB".repeat(32);
    expect(actionForContent(upper)).toBe("f1" + "ab".repeat(14));
  });

  it("varies for different content hashes", () => {
    const a = actionForContent("0x" + "11".repeat(32));
    const b = actionForContent("0x" + "22".repeat(32));
    expect(a).not.toBe(b);
  });
});

describe("externalNullifierFor", () => {
  it("matches manual hashToField(packed(appId, action))", () => {
    const appId = "app_test";
    const ch = "0x" + "11".repeat(32);
    const expected = BigInt(
      keccak256(solidityPacked(["string", "string"], [appId, actionForContent(ch)])),
    ) >> 8n;
    expect(externalNullifierFor(appId, ch)).toBe(expected);
  });

  it("varies with appId", () => {
    const ch = "0x" + "22".repeat(32);
    expect(externalNullifierFor("app_a", ch)).not.toBe(externalNullifierFor("app_b", ch));
  });

  it("varies with contentHash", () => {
    const a = externalNullifierFor("app", "0x" + "11".repeat(32));
    const b = externalNullifierFor("app", "0x" + "22".repeat(32));
    expect(a).not.toBe(b);
  });
});

describe("signalHashFor", () => {
  it("matches manual hashToField(packed(contentHash, attester))", () => {
    const ch = "0x" + "33".repeat(32);
    const attester = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const expected =
      BigInt(keccak256(solidityPacked(["bytes32", "address"], [ch, attester]))) >> 8n;
    expect(signalHashFor(ch, attester)).toBe(expected);
  });

  it("varies with attester", () => {
    const ch = "0x" + "44".repeat(32);
    const a = signalHashFor(ch, "0x" + "11".repeat(20));
    const b = signalHashFor(ch, "0x" + "22".repeat(20));
    expect(a).not.toBe(b);
  });
});

describe("normalizeWorldIdProof", () => {
  it("converts hex strings to bigints", () => {
    const norm = normalizeWorldIdProof({
      root: "0x10",
      nullifierHash: "0x20",
      proof: ["0x1", "0x2", "0x3", "0x4", "0x5", "0x6", "0x7", "0x8"],
    });
    expect(norm.root).toBe(0x10n);
    expect(norm.nullifierHash).toBe(0x20n);
    expect(norm.proof).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]);
  });

  it("passes through bigints unchanged", () => {
    const norm = normalizeWorldIdProof({
      root: 99n,
      nullifierHash: 100n,
      proof: [10n, 20n, 30n, 40n, 50n, 60n, 70n, 80n],
    });
    expect(norm.root).toBe(99n);
    expect(norm.proof[0]).toBe(10n);
  });
});
