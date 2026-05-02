import { describe, it, expect } from "vitest";
import { getNetwork, registerNetwork } from "../../src/networks.js";

describe("network registry", () => {
  it("rejects an unknown network name", () => {
    expect(() => getNetwork("nonsense" as never)).toThrow(/Unknown network/);
  });

  it("loads the bundled artifact for the live testnet (base-sepolia)", () => {
    const cfg = getNetwork("base-sepolia");
    expect(cfg.chainId).toBe(84532);
    expect(cfg.contracts.resolver).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(cfg.schemas.human).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(cfg.schemas.ai).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("rejects mainnet (base) until the artifact is bundled", () => {
    expect(() => getNetwork("base")).toThrow(/not yet deployed/);
  });

  it("returns a registered network", () => {
    registerNetwork("local", {
      name: "local",
      chainId: 31337,
      rpcUrl: "http://127.0.0.1:8545",
      contracts: {
        eas: "0x0000000000000000000000000000000000000001",
        schemaRegistry: "0x0000000000000000000000000000000000000002",
        resolver: "0x0000000000000000000000000000000000000003",
      },
      schemas: { human: "0xaa", ai: "0xbb" },
    });
    const out = getNetwork("local");
    expect(out.chainId).toBe(31337);
    expect(out.contracts.resolver).toMatch(/^0x/);
  });
});
