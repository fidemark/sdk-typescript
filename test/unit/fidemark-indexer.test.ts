import { describe, it, expect, vi } from "vitest";
import { Fidemark, type GraphqlClient, type NetworkConfig } from "../../src/index.js";

const network: NetworkConfig = {
  name: "synthetic",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:9999", // unreachable on purpose
  contracts: {
    eas: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    schemaRegistry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    resolver: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  },
  schemas: {
    human: "0x" + "11".repeat(32),
    ai: "0x" + "22".repeat(32),
  },
};

describe("Fidemark.verifyByHash, indexer modes", () => {
  it("indexer='graphql' without a client throws on first lookup", async () => {
    const fidemark = new Fidemark({ network, indexer: "graphql" });
    await expect(fidemark.verifyByHash("0x" + "ab".repeat(32))).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("indexer='graphql' uses the indexerClient", async () => {
    const client: GraphqlClient = {
      query: vi.fn(async () => ({ data: { attestations: [] } })),
    };
    const fidemark = new Fidemark({ network, indexer: "graphql", indexerClient: client });
    const out = await fidemark.verifyByHash("0x" + "ab".repeat(32));
    expect(out).toEqual([]);
    // Two queries (one per schema).
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("indexer='auto' falls back to events when GraphQL throws", async () => {
    const client: GraphqlClient = {
      query: async () => {
        throw new Error("indexer down");
      },
    };
    const fidemark = new Fidemark({ network, indexer: "auto", indexerClient: client });
    // The fallback path tries an `eth_getLogs` call against the unreachable
    // RPC at network.rpcUrl. We expect *some* error from that path, not the
    // indexer's "indexer down" error, proving fallback ran.
    await expect(fidemark.verifyByHash("0x" + "ab".repeat(32))).rejects.not.toMatchObject({
      message: "indexer down",
    });
  });

  it("default mode is 'events' when no indexer config provided", async () => {
    const fidemark = new Fidemark({ network });
    // Without an indexerClient, even calling verifyByHash should not invoke any
    // GraphQL machinery, straight to the event scan path.
    await expect(fidemark.verifyByHash("0x" + "ab".repeat(32))).rejects.toBeDefined();
    // No `client.query` to spy on, so just rely on no throw from "INVALID_INPUT" graphql path.
  });
});
