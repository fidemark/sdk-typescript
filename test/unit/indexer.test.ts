import { describe, it, expect, vi } from "vitest";
import { indexerVerifyByHash, type GraphqlClient, type GraphqlAttestation } from "../../src/indexer.js";

const HUMAN_SCHEMA = "0x" + "11".repeat(32);
const AI_SCHEMA = "0x" + "22".repeat(32);
const HASH = "0x" + "ab".repeat(32);
const OTHER_HASH = "0x" + "cd".repeat(32);

function fakeAtt(uid: string, schemaId: string, time: number, leadingHash: string): GraphqlAttestation {
  return {
    id: uid,
    schemaId,
    attester: "0x000",
    recipient: "0x000",
    time,
    revocationTime: 0,
    refUID: "0x" + "00".repeat(32),
    data: leadingHash + "ff".repeat(64), // 32-byte hash + tail
  };
}

function fakeClient(map: Record<string, GraphqlAttestation[]>): GraphqlClient {
  return {
    query: vi.fn(async ({ variables }) => ({
      data: { attestations: map[(variables as { schema: string }).schema] ?? [] },
    })),
  };
}

describe("indexerVerifyByHash", () => {
  it("returns UIDs whose data prefix matches the requested hash", async () => {
    const client = fakeClient({
      [HUMAN_SCHEMA]: [
        fakeAtt("0xa1", HUMAN_SCHEMA, 200, HASH),
        fakeAtt("0xa2", HUMAN_SCHEMA, 100, OTHER_HASH),
      ],
      [AI_SCHEMA]: [],
    });

    const out = await indexerVerifyByHash({
      client,
      schemas: { human: HUMAN_SCHEMA, ai: AI_SCHEMA },
      contentHash: HASH,
    });
    expect(out).toEqual(["0xa1"]);
  });

  it("returns results from both schemas, sorted newest-first", async () => {
    const client = fakeClient({
      [HUMAN_SCHEMA]: [fakeAtt("0xh1", HUMAN_SCHEMA, 50, HASH)],
      [AI_SCHEMA]: [fakeAtt("0xa1", AI_SCHEMA, 200, HASH)],
    });
    const out = await indexerVerifyByHash({
      client,
      schemas: { human: HUMAN_SCHEMA, ai: AI_SCHEMA },
      contentHash: HASH,
    });
    expect(out).toEqual(["0xa1", "0xh1"]);
  });

  it("respects the type filter and skips the other schema", async () => {
    const client = fakeClient({
      [HUMAN_SCHEMA]: [fakeAtt("0xh1", HUMAN_SCHEMA, 50, HASH)],
      [AI_SCHEMA]: [fakeAtt("0xa1", AI_SCHEMA, 200, HASH)],
    });
    const human = await indexerVerifyByHash({
      client,
      schemas: { human: HUMAN_SCHEMA, ai: AI_SCHEMA },
      contentHash: HASH,
      type: "human",
    });
    expect(human).toEqual(["0xh1"]);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("propagates GraphQL errors", async () => {
    const client: GraphqlClient = {
      query: async () => ({ errors: [{ message: "boom" }] }),
    };
    await expect(
      indexerVerifyByHash({
        client,
        schemas: { human: HUMAN_SCHEMA, ai: AI_SCHEMA },
        contentHash: HASH,
      }),
    ).rejects.toMatchObject({ code: "RPC_ERROR" });
  });

  it("is case-insensitive on the content hash compare", async () => {
    const client = fakeClient({
      [HUMAN_SCHEMA]: [fakeAtt("0xh1", HUMAN_SCHEMA, 50, HASH.toUpperCase())],
      [AI_SCHEMA]: [],
    });
    const out = await indexerVerifyByHash({
      client,
      schemas: { human: HUMAN_SCHEMA, ai: AI_SCHEMA },
      contentHash: HASH,
    });
    expect(out).toEqual(["0xh1"]);
  });
});
