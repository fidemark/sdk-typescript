import { describe, it, expect, beforeAll } from "vitest";
import { Wallet } from "ethers";
import {
  signHumanOffchain,
  signAIOffchain,
  verifyOffchain,
  decodeOffchain,
  hashContent,
  type NetworkConfig,
  type OffchainEnvelope,
} from "../../src/index.js";

// Synthetic network, no chain calls in offchain flow.
const network: NetworkConfig = {
  name: "synthetic",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  contracts: {
    eas: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    schemaRegistry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    resolver: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  },
  schemas: {
    human: "0xaf65a9a663e21c28a6e94560ef7501cd286e13b098f05143fbf160fac4f1660c",
    ai: "0xaf4119a0d3fbf9b5c14190fc2d4c5c34167b4e5276af2f00e4eb369155478869",
  },
};

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("offchain attestations", () => {
  let alice: Wallet;
  let aliceAddress: string;

  beforeAll(async () => {
    alice = new Wallet(KEY);
    aliceAddress = await alice.getAddress();
  });

  it("signs and verifies a Human Proof envelope", async () => {
    const envelope = await signHumanOffchain(alice, network, {
      content: "An essay I wrote.",
      contentType: "text/article",
    });

    expect(envelope.type).toBe("human");
    expect(envelope.attester.toLowerCase()).toBe(aliceAddress.toLowerCase());
    expect(envelope.uid).toMatch(/^0x[0-9a-f]{64}$/);
    expect(envelope.decoded).toMatchObject({
      contentHash: hashContent("An essay I wrote."),
      contentType: "text/article",
      proofMethod: "wallet-signed",
    });

    expect(verifyOffchain(envelope, network)).toBe(true);
  });

  it("signs and verifies an AI Proof envelope", async () => {
    const envelope = await signAIOffchain(alice, network, {
      content: "AI output text.",
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
      prompt: "say something",
    });

    expect(envelope.type).toBe("ai");
    if (envelope.type !== "ai") throw new Error("type narrow");
    expect(envelope.decoded).toMatchObject({
      modelId: "claude-sonnet-4-6",
      provider: "anthropic",
    });
    expect(verifyOffchain(envelope, network)).toBe(true);
  });

  it("rejects an envelope with a tampered signed payload", async () => {
    const envelope = await signHumanOffchain(alice, network, {
      content: "original",
      contentType: "text/article",
    });

    // Mutate the signed data, the signature no longer covers it.
    const tampered: OffchainEnvelope = {
      ...envelope,
      signed: {
        ...envelope.signed,
        message: { ...envelope.signed.message, data: "0x" + "ff".repeat(envelope.signed.message.data.length / 2 - 1) },
      },
    };

    expect(verifyOffchain(tampered, network)).toBe(false);
  });

  it("rejects an envelope claimed to come from a different attester", async () => {
    const bob = new Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

    const envelope = await signHumanOffchain(alice, network, {
      content: "x",
      contentType: "text/article",
    });

    const wrongAttester: OffchainEnvelope = { ...envelope, attester: await bob.getAddress() };
    expect(verifyOffchain(wrongAttester, network)).toBe(false);
  });

  it("rejects an envelope signed for a different network", async () => {
    const envelope = await signHumanOffchain(alice, network, {
      content: "x",
      contentType: "text/article",
    });

    const otherNetwork: NetworkConfig = { ...network, chainId: 1 };
    expect(verifyOffchain(envelope, otherNetwork)).toBe(false);
  });

  it("rejects an envelope with mismatched schema for declared type", async () => {
    const envelope = await signHumanOffchain(alice, network, {
      content: "x",
      contentType: "text/article",
    });

    // Network whose `human` schema UID is different from what the envelope was signed for.
    const moved: NetworkConfig = {
      ...network,
      schemas: { ...network.schemas, human: "0x" + "00".repeat(32) },
    };
    expect(verifyOffchain(envelope, moved)).toBe(false);
  });

  it("decodes a Human envelope's signed payload back to fields", async () => {
    const envelope = await signHumanOffchain(alice, network, {
      content: "decode-me",
      contentType: "text/article",
    });

    const decoded = decodeOffchain(envelope);
    expect(decoded).toMatchObject({
      contentHash: hashContent("decode-me"),
      contentType: "text/article",
    });
  });

  it("envelope serializes through JSON cleanly", async () => {
    const envelope = await signHumanOffchain(alice, network, {
      content: "json-roundtrip",
      contentType: "text/article",
    });

    // BigInts in the EAS payload need string coercion for JSON.stringify.
    const json = JSON.stringify(envelope, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(json).toContain(envelope.uid);
    expect(json).toContain(envelope.attester);
    // Round-trip is a verifier concern (BigInts must be revived), out of scope here.
  });
});
