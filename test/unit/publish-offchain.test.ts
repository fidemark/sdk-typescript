import { describe, it, expect } from "vitest";
import { Wallet } from "ethers";
import { Fidemark, type NetworkConfig, type OffchainEnvelope } from "../../src/index.js";

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

function mkEnvelope(overrides: Partial<OffchainEnvelope> = {}): OffchainEnvelope {
  return {
    type: "human",
    fidemarkVersion: 1,
    uid: "0x" + "1".repeat(64),
    attester: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    network: { chainId: network.chainId, name: network.name, eas: network.contracts.eas },
    signed: {} as any,
    decoded: {
      contentHash: "0x" + "2".repeat(64),
      contentType: "text/plain",
      creator: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      createdAt: 1700000000,
      proofMethod: "wallet-signed",
    },
    ...overrides,
  };
}

describe("publishOffchain, pre-flight validation (no chain calls)", () => {
  it("rejects an envelope without a delegated signature", async () => {
    const fidemark = new Fidemark({ network, signer: new Wallet(KEY) });
    await expect(fidemark.publishOffchain(mkEnvelope())).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("rejects an envelope from a different chainId", async () => {
    const fidemark = new Fidemark({ network, signer: new Wallet(KEY) });
    const envelope = mkEnvelope({
      network: { chainId: 8453, name: "base", eas: network.contracts.eas },
      delegated: stubDelegated(),
    });
    await expect(fidemark.publishOffchain(envelope)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("rejects an envelope referencing a different EAS contract", async () => {
    const fidemark = new Fidemark({ network, signer: new Wallet(KEY) });
    const envelope = mkEnvelope({
      network: {
        chainId: network.chainId,
        name: network.name,
        eas: "0x0000000000000000000000000000000000000bad",
      },
      delegated: stubDelegated(),
    });
    await expect(fidemark.publishOffchain(envelope)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("requires a signer", async () => {
    // Construct without signer or privateKey, only a (network) provider can be derived.
    const fidemark = new Fidemark({ network });
    const envelope = mkEnvelope({ delegated: stubDelegated() });
    await expect(fidemark.publishOffchain(envelope)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

function stubDelegated() {
  return {
    signature: { r: "0x" + "0".repeat(64), s: "0x" + "0".repeat(64), v: 27 },
    nonce: "0",
    deadline: "0",
    request: {
      schema: network.schemas.human,
      recipient: "0x0000000000000000000000000000000000000000",
      expirationTime: "0",
      revocable: true,
      refUID: "0x" + "0".repeat(64),
      data: "0x",
      value: "0",
    },
  };
}
