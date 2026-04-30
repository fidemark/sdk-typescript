/**
 * EAS GraphQL indexer adapter.
 *
 * The Fidemark resolver indexes `contentHash` on its events, so a chain-log
 * scan via `verifyByHash` is cheap on local + Sepolia. On busy mainnet,
 * `eth_getLogs` over the full deployment range can take many seconds and
 * may be rate-limited by public RPCs. The EAS indexer (e.g. base.easscan.org)
 * already has every attestation in a Postgres-backed GraphQL endpoint.
 *
 * This module queries that endpoint by schema, decodes results client-side
 * to filter by content hash, and returns UIDs ready for `Fidemark.verify()`.
 */

import { FidemarkError } from "./errors.js";
import type { FidemarkSchemaType } from "./fidemark.js";

export type IndexerMode = "graphql" | "events" | "auto";

const QUERY = `query FidemarkAttestations($schema: String!, $first: Int!) {
  attestations(
    where: { schemaId: { equals: $schema } }
    orderBy: { time: desc }
    take: $first
  ) {
    id
    schemaId
    attester
    recipient
    time
    revocationTime
    refUID
    data
  }
}`;

export interface GraphqlAttestation {
  id: string;
  schemaId: string;
  attester: string;
  recipient: string;
  time: number;
  revocationTime: number;
  refUID: string;
  data: string;
}

export interface GraphqlClient {
  /** Issue a single GraphQL query. */
  query: (body: { query: string; variables: Record<string, unknown> }) => Promise<{
    data?: { attestations?: GraphqlAttestation[] };
    errors?: Array<{ message: string }>;
  }>;
}

export function defaultClient(url: string): GraphqlClient {
  return {
    async query(body) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new FidemarkError("RPC_ERROR", `Indexer returned HTTP ${res.status}`);
      }
      return (await res.json()) as ReturnType<GraphqlClient["query"]> extends Promise<infer T> ? T : never;
    },
  };
}

/**
 * Query the indexer for attestations on a given Fidemark schema, filter
 * client-side by content hash. Returns UIDs sorted newest-first.
 *
 * `take` caps the per-query window. For exhaustive scans across millions of
 * attestations, an indexer with custom contentHash indexing (subgraph)
 * is the right escalation, see /guides/networks in the docs.
 */
export async function indexerVerifyByHash(args: {
  client: GraphqlClient;
  schemas: { human: string; ai: string };
  contentHash: string;
  type?: FidemarkSchemaType;
  take?: number;
}): Promise<string[]> {
  const wanted = args.contentHash.toLowerCase();
  const schemasToQuery: Array<{ uid: string; type: FidemarkSchemaType }> = [];
  if (args.type !== "ai") schemasToQuery.push({ uid: args.schemas.human, type: "human" });
  if (args.type !== "human") schemasToQuery.push({ uid: args.schemas.ai, type: "ai" });

  const take = args.take ?? 1000;
  const results: GraphqlAttestation[] = [];

  for (const s of schemasToQuery) {
    const out = await args.client.query({ query: QUERY, variables: { schema: s.uid, first: take } });
    if (out.errors && out.errors.length > 0) {
      throw new FidemarkError("RPC_ERROR", `Indexer error: ${out.errors[0]!.message}`);
    }
    const items = out.data?.attestations ?? [];
    // contentHash is the first 32 bytes of the encoded data (bytes32 leading
    // word in both schemas). The leading "0x" plus 64 hex = first 66 chars.
    for (const att of items) {
      if (att.data.length < 66) continue;
      const headHash = att.data.slice(0, 66).toLowerCase();
      if (headHash === wanted) results.push(att);
    }
  }

  results.sort((a, b) => b.time - a.time);
  return results.map((r) => r.id);
}
