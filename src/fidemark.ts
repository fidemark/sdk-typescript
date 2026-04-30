import { EAS, SchemaEncoder } from "./_eas-runtime.js";
import type {
  Attestation as EASAttestation,
  EAS as EASInstance,
} from "@ethereum-attestation-service/eas-sdk";
import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  ZeroHash,
  isHexString,
  type Provider,
  type Signer,
} from "ethers";
import { hashContent, hashPrompt } from "./hashing.js";
import { getNetwork, type NetworkConfig, type NetworkName } from "./networks.js";
import { FidemarkError, mapChainError } from "./errors.js";
import {
  signHumanOffchain,
  signAIOffchain,
  verifyOffchain as verifyOffchainEnvelope,
  type OffchainEnvelope,
  type OffchainSignOptions,
} from "./offchain.js";
import { resolveVerifiedENS, type VerifiedENS } from "./ens.js";
import { RESOLVER_EVENTS_ABI } from "./resolver-abi.js";
import { indexerVerifyByHash, defaultClient, type GraphqlClient, type IndexerMode } from "./indexer.js";
import {
  buildMultiPartyClaim,
  type MultiPartyClaim,
  type MultiPartySlip,
} from "./multi.js";
import { normalizeWorldIdProof, type WorldIdProof } from "./pop.js";

const HUMAN_SCHEMA_DEF =
  "bytes32 contentHash,string contentType,address creator,uint64 createdAt,string proofMethod";
const AI_SCHEMA_DEF =
  "bytes32 contentHash,string modelId,bytes32 promptHash,string parameters,string provider";
const MULTI_SCHEMA_DEF =
  "bytes32 contentHash,string contentType,address[] attesters,bytes[] signatures,uint64 createdAt,string proofMethod";
const POP_SCHEMA_DEF =
  "bytes32 contentHash,string contentType,address creator,uint64 createdAt,uint256 root,uint256 nullifierHash,uint256[8] proof,string proofMethod";

export interface FidemarkConfig {
  /** Network preset name, or a fully-resolved NetworkConfig (use `loadLocalNetwork()` for dev). */
  network: NetworkName | NetworkConfig;
  /** Pre-built signer. Mutually exclusive with `privateKey`. */
  signer?: Signer;
  /** Private key, SDK will create a Wallet bound to the network's RPC. */
  privateKey?: string;
  /** Read-only provider, when neither signer nor privateKey is supplied. Used for `verify*` only. */
  provider?: Provider;
  /** Override the public verification URL base. Defaults to https://verify.fidemark.dev. */
  verifyUrlBase?: string;
  /**
   * Ethereum mainnet provider for ENS lookups. Required by `attestHumanWithENS`
   * and `resolveENS`. ENS lives on Ethereum, not Base, keep it separate.
   */
  ensProvider?: Provider;
  /**
   * How `verifyByHash` looks up attestations.
   *   - "events" (default): `eth_getLogs` against the resolver. Cheap on local
   *     and Sepolia; slow + rate-limit-prone on busy mainnet RPCs.
   *   - "graphql": query an EAS GraphQL indexer (e.g. base.easscan.org/graphql).
   *     Requires `indexerUrl` or a custom `indexerClient`. Much faster at scale.
   *   - "auto": prefer GraphQL when available; fall back to events on error.
   */
  indexer?: IndexerMode;
  /** GraphQL endpoint URL when `indexer` is "graphql" or "auto". */
  indexerUrl?: string;
  /** Pre-built GraphQL client; takes precedence over `indexerUrl`. Useful for tests. */
  indexerClient?: GraphqlClient;
}

export interface AttestHumanInput {
  content: string | Uint8Array;
  contentType: string;
  /** Defaults to the signer's address. */
  creator?: string;
  /** Defaults to `Math.floor(Date.now() / 1000)`. */
  createdAt?: number | bigint;
  /** Defaults to `"wallet-signed"` (Layer 0). */
  proofMethod?: string;
  /** Optional UID of a parent attestation this one references (any EAS attestation). */
  refUID?: string;
}

export interface AttestAIInput {
  content: string | Uint8Array;
  modelId: string;
  provider: string;
  /** Plaintext prompt, SDK hashes it to bytes32. Mutually exclusive with `promptHash`. */
  prompt?: string | Uint8Array;
  /** Pre-computed prompt hash (0x + 32 bytes hex). For confidential pipelines. */
  promptHash?: string;
  /** Free-form generation parameters, JSON-stringified by the SDK if not already a string. */
  parameters?: Record<string, unknown> | string;
  /** Optional UID of a parent attestation this one references (any EAS attestation). */
  refUID?: string;
}

export type FidemarkSchemaType = "human" | "ai" | "multi" | "pop";

export interface AttestMultiPartyInput {
  /** The exact claim every co-signer signed. Use `buildMultiPartyClaim` to derive it. */
  claim: MultiPartyClaim;
  /** Co-signer slips collected off-chain. Order is preserved on-chain. Min 2, max 16. */
  slips: MultiPartySlip[];
  /** Defaults to `"multi-party"` (Layer 2). */
  proofMethod?: string;
  /** Optional UID of a parent attestation this one references. */
  refUID?: string;
}

export interface AttestHumanWithPoPInput {
  /** Content the user attested. The SDK hashes it; the same hash must have been used to derive the World ID action. */
  content: string | Uint8Array;
  contentType: string;
  /** Defaults to the signer's address. Resolver enforces creator == attester. */
  creator?: string;
  createdAt?: number | bigint;
  /** Defaults to `"pop-verified-worldid"`. */
  proofMethod?: string;
  /** World ID proof produced by IDKit's `verify` flow against the action `actionForContent(contentHash)`. */
  worldIdProof: WorldIdProof;
  /** Optional refUID to chain this attestation off another. */
  refUID?: string;
}

export interface FidemarkAttestation {
  uid: string;
  type: FidemarkSchemaType;
  schemaUID: string;
  attester: string;
  recipient: string;
  contentHash: string;
  createdAt: number;
  revoked: boolean;
  revokedAt?: number;
  /** UID of a parent attestation this one references; ZeroHash if none. */
  refUID: string;
  /** Public URL where this attestation can be verified without a wallet. */
  verifyUrl: string;
  /** Decoded type-specific fields. */
  human?: { contentType: string; creator: string; proofMethod: string; createdAtAttested: number };
  ai?: { modelId: string; provider: string; promptHash: string; parameters: string };
  multi?: {
    contentType: string;
    attesters: string[];
    signatures: string[];
    proofMethod: string;
    createdAtAttested: number;
  };
  pop?: {
    contentType: string;
    creator: string;
    proofMethod: string;
    createdAtAttested: number;
    root: string;
    nullifierHash: string;
    proof: string[];
  };
}

interface AttestResult {
  uid: string;
  txHash: string;
  verifyUrl: string;
}

export interface BatchHumanItem extends AttestHumanInput {
  type: "human";
}

export interface BatchAIItem extends AttestAIInput {
  type: "ai";
}

export type BatchItem = BatchHumanItem | BatchAIItem;

export interface BatchResult {
  /** Per-input UID, in the same order as the input array. */
  uids: string[];
  /** Single tx hash, all items land in one transaction. */
  txHash: string;
  /** Per-input verify URL, in input order. */
  verifyUrls: string[];
}

export interface VerifyByHashOptions {
  /** Restrict the search to one schema. Default: both. */
  type?: FidemarkSchemaType;
  /** First block to scan. Defaults to the network's `deployBlock` (or 0). */
  fromBlock?: number;
  /** Last block to scan. Defaults to "latest". */
  toBlock?: number | "latest";
}

export class Fidemark {
  private readonly network: NetworkConfig;
  private readonly eas: EASInstance;
  private readonly signer?: Signer;
  private readonly verifyUrlBase: string;
  private readonly ensProvider?: Provider;
  private readonly indexerMode: IndexerMode;
  private readonly indexerClient?: GraphqlClient;

  constructor(config: FidemarkConfig) {
    this.network = typeof config.network === "string" ? getNetwork(config.network) : config.network;
    this.verifyUrlBase = config.verifyUrlBase ?? "https://verify.fidemark.dev";
    this.ensProvider = config.ensProvider;
    this.indexerMode = config.indexer ?? (config.indexerClient || config.indexerUrl ? "auto" : "events");
    this.indexerClient = config.indexerClient ?? (config.indexerUrl ? defaultClient(config.indexerUrl) : undefined);

    if (config.signer && config.privateKey) {
      throw new FidemarkError("INVALID_INPUT", "Pass either `signer` or `privateKey`, not both.");
    }

    if (config.signer) {
      this.signer = config.signer;
    } else if (config.privateKey) {
      const provider = config.provider ?? new JsonRpcProvider(this.network.rpcUrl);
      this.signer = new Wallet(config.privateKey, provider);
    }

    const runner = this.signer ?? config.provider ?? new JsonRpcProvider(this.network.rpcUrl);
    this.eas = new EAS(this.network.contracts.eas);
    this.eas.connect(runner);
  }

  async attestHuman(input: AttestHumanInput): Promise<AttestResult> {
    const signer = this.requireSigner();
    const creator = input.creator ?? (await signer.getAddress());
    const createdAt = BigInt(input.createdAt ?? Math.floor(Date.now() / 1000));
    const proofMethod = input.proofMethod ?? "wallet-signed";

    const encoder = new SchemaEncoder(HUMAN_SCHEMA_DEF);
    const data = encoder.encodeData([
      { name: "contentHash", value: hashContent(input.content), type: "bytes32" },
      { name: "contentType", value: input.contentType, type: "string" },
      { name: "creator", value: creator, type: "address" },
      { name: "createdAt", value: createdAt, type: "uint64" },
      { name: "proofMethod", value: proofMethod, type: "string" },
    ]);

    return this.attest(this.network.schemas.human, data, input.refUID);
  }

  async attestAI(input: AttestAIInput): Promise<AttestResult> {
    if (input.prompt && input.promptHash) {
      throw new FidemarkError("INVALID_INPUT", "Pass either `prompt` or `promptHash`, not both.");
    }
    const promptHash = input.promptHash
      ? normalizeBytes32(input.promptHash)
      : input.prompt
        ? hashPrompt(input.prompt)
        : ZeroHash;

    const parameters = typeof input.parameters === "string"
      ? input.parameters
      : input.parameters
        ? JSON.stringify(input.parameters)
        : "";

    const encoder = new SchemaEncoder(AI_SCHEMA_DEF);
    const data = encoder.encodeData([
      { name: "contentHash", value: hashContent(input.content), type: "bytes32" },
      { name: "modelId", value: input.modelId, type: "string" },
      { name: "promptHash", value: promptHash, type: "bytes32" },
      { name: "parameters", value: parameters, type: "string" },
      { name: "provider", value: input.provider, type: "string" },
    ]);

    return this.attest(this.network.schemas.ai, data, input.refUID);
  }

  /**
   * Issue a multi-party co-attestation (Layer 2). Each slip in `input.slips`
   * is an EIP-712 signature over `input.claim` from a distinct co-signer; the
   * resolver validates every signature on-chain atomically. Helpers in
   * `./multi.ts` build the claim and produce slips.
   *
   * Throws `INVALID_INPUT` if the network has no multi-party schema deployed.
   */
  async attestMultiParty(input: AttestMultiPartyInput): Promise<AttestResult> {
    if (!this.network.schemas.multi) {
      throw new FidemarkError(
        "INVALID_INPUT",
        `Network ${this.network.name} has no multi-party schema deployed.`,
      );
    }
    if (input.slips.length < 2) {
      throw new FidemarkError("INVALID_INPUT", "attestMultiParty requires at least 2 slips.");
    }

    const proofMethod = input.proofMethod ?? "multi-party";
    const encoder = new SchemaEncoder(MULTI_SCHEMA_DEF);
    const data = encoder.encodeData([
      { name: "contentHash", value: input.claim.contentHash, type: "bytes32" },
      { name: "contentType", value: input.claim.contentType, type: "string" },
      { name: "attesters", value: input.slips.map((s) => s.signer), type: "address[]" },
      { name: "signatures", value: input.slips.map((s) => s.signature), type: "bytes[]" },
      { name: "createdAt", value: BigInt(input.claim.createdAt), type: "uint64" },
      { name: "proofMethod", value: proofMethod, type: "string" },
    ]);

    return this.attest(this.network.schemas.multi, data, input.refUID);
  }

  /**
   * Issue a Human Proof at trust Layer 4 (proof-of-personhood). The caller
   * provides a World ID Orb-verified zk-proof generated by IDKit against the
   * action `actionForContent(contentHash)`. The on-chain resolver re-derives
   * the externalNullifier and signal from the SAME contentHash + attester, so
   * the proof can't be reused for a different attestation.
   *
   * Throws `INVALID_INPUT` if the network has no PoP schema deployed.
   */
  async attestHumanWithPoP(input: AttestHumanWithPoPInput): Promise<AttestResult> {
    if (!this.network.schemas.pop) {
      throw new FidemarkError(
        "INVALID_INPUT",
        `Network ${this.network.name} has no PoP schema deployed.`,
      );
    }
    const signer = this.requireSigner();
    const creator = input.creator ?? (await signer.getAddress());
    const createdAt = BigInt(input.createdAt ?? Math.floor(Date.now() / 1000));
    const proofMethod = input.proofMethod ?? "pop-verified-worldid";
    const contentHash = hashContent(input.content);
    const { root, nullifierHash, proof } = normalizeWorldIdProof(input.worldIdProof);

    const encoder = new SchemaEncoder(POP_SCHEMA_DEF);
    const data = encoder.encodeData([
      { name: "contentHash", value: contentHash, type: "bytes32" },
      { name: "contentType", value: input.contentType, type: "string" },
      { name: "creator", value: creator, type: "address" },
      { name: "createdAt", value: createdAt, type: "uint64" },
      { name: "root", value: root, type: "uint256" },
      { name: "nullifierHash", value: nullifierHash, type: "uint256" },
      { name: "proof", value: proof, type: "uint256[8]" },
      { name: "proofMethod", value: proofMethod, type: "string" },
    ]);

    return this.attest(this.network.schemas.pop, data, input.refUID);
  }

  async verify(uid: string): Promise<FidemarkAttestation> {
    let raw: EASAttestation;
    try {
      raw = await this.eas.getAttestation(uid);
    } catch (err) {
      throw mapChainError(err);
    }

    if (raw.uid === ZeroHash || raw.attester === ZeroAddress) {
      throw new FidemarkError("ATTESTATION_NOT_FOUND", `No attestation found for UID ${uid}.`);
    }

    return this.decodeAttestation(raw);
  }

  /**
   * Find every Fidemark attestation that references the given contentHash.
   *
   * Implementation note: scans `HumanAttestation` and `AIAttestation` events
   * on the resolver, filtered by indexed `contentHash`. Cheap on local + Base
   * because both events index the hash. For high-volume mainnet usage,
   * consider an indexer (EAS GraphQL) instead, see PRD §13.
   */
  async verifyByHash(
    contentHash: string,
    options: VerifyByHashOptions = {},
  ): Promise<FidemarkAttestation[]> {
    if (!isHexString(contentHash, 32)) {
      throw new FidemarkError("INVALID_INPUT", `contentHash must be 0x-prefixed 32 bytes hex.`);
    }

    // Indexer path: GraphQL when configured. "auto" tries GraphQL then falls
    // back to events on any error so we don't break callers when the indexer
    // is temporarily unreachable.
    if ((this.indexerMode === "graphql" || this.indexerMode === "auto") && this.indexerClient) {
      try {
        const uids = await indexerVerifyByHash({
          client: this.indexerClient,
          schemas: this.network.schemas,
          contentHash,
          type: options.type,
        });
        return Promise.all(uids.map((uid) => this.verify(uid)));
      } catch (err) {
        if (this.indexerMode === "graphql") throw err;
        // auto: fall through to event scan
      }
    }
    if (this.indexerMode === "graphql" && !this.indexerClient) {
      throw new FidemarkError(
        "INVALID_INPUT",
        "indexer mode is 'graphql' but no indexerUrl/indexerClient was provided.",
      );
    }

    const runner = (this.eas as any).contract?.runner ?? this.signer;
    const resolver = new Contract(this.network.contracts.resolver, RESOLVER_EVENTS_ABI, runner);
    const fromBlock = options.fromBlock ?? this.network.deployBlock ?? 0;
    const toBlock = options.toBlock ?? "latest";

    const uids = new Set<string>();

    const queries: Promise<unknown>[] = [];
    if (options.type !== "ai") {
      const filter = (resolver.filters.HumanAttestation as any)(null, null, contentHash);
      queries.push(
        resolver
          .queryFilter(filter, fromBlock, toBlock)
          .then((logs: any[]) => logs.forEach((l) => uids.add(l.args.uid))),
      );
    }
    if (options.type !== "human") {
      const filter = (resolver.filters.AIAttestation as any)(null, null, contentHash);
      queries.push(
        resolver
          .queryFilter(filter, fromBlock, toBlock)
          .then((logs: any[]) => logs.forEach((l) => uids.add(l.args.uid))),
      );
    }
    await Promise.all(queries);

    // Hydrate each UID via the standard verify() path so revocation status,
    // refUID and decoded fields are returned the same way as `verify(uid)`.
    const attestations = await Promise.all([...uids].map((uid) => this.verify(uid)));
    // Sort newest-first.
    attestations.sort((a, b) => b.createdAt - a.createdAt);
    return attestations;
  }

  /**
   * Walk an attestation's `refUID` chain and return the chain ordered from
   * root → leaf. Stops at the first non-Fidemark parent (returns the chain up
   * to and including the last Fidemark-known link).
   *
   * Cycle protection: traversal aborts after 32 hops.
   */
  async verifyChain(uid: string): Promise<FidemarkAttestation[]> {
    const MAX_DEPTH = 32;
    const chain: FidemarkAttestation[] = [];
    const seen = new Set<string>();
    let cursor = uid;
    for (let i = 0; i < MAX_DEPTH; i++) {
      if (seen.has(cursor)) break; // cycle guard
      seen.add(cursor);
      let att: FidemarkAttestation;
      try {
        att = await this.verify(cursor);
      } catch (err) {
        if (err instanceof FidemarkError && err.code === "VALIDATION_REJECTED") {
          // Parent isn't a Fidemark schema, stop here, return what we have.
          break;
        }
        if (err instanceof FidemarkError && err.code === "ATTESTATION_NOT_FOUND") {
          break;
        }
        throw err;
      }
      chain.unshift(att);
      if (att.refUID === ZeroHash) break;
      cursor = att.refUID;
    }
    return chain;
  }

  /**
   * Attest a batch of mixed Human + AI items in a single transaction.
   * Saves ~30–40% gas vs. issuing them sequentially.
   *
   * Items are grouped by schema and passed to EAS `multiAttest`. UIDs are
   * returned in input order so callers can correlate with their input array.
   */
  async attestBatch(items: BatchItem[]): Promise<BatchResult> {
    if (items.length === 0) {
      throw new FidemarkError("INVALID_INPUT", "attestBatch requires at least one item.");
    }
    const signer = this.requireSigner();
    const signerAddress = await signer.getAddress();

    const humanEncoder = new SchemaEncoder(HUMAN_SCHEMA_DEF);
    const aiEncoder = new SchemaEncoder(AI_SCHEMA_DEF);

    // Build one EAS request per schema, but remember each item's slot so we
    // can stitch UIDs back into input order from the multiAttest result.
    const humanData: Array<{ recipient: string; expirationTime: bigint; revocable: boolean; refUID: string; data: string; value: bigint }> = [];
    const aiData: typeof humanData = [];
    const slotForItem: { schema: "human" | "ai"; idx: number }[] = items.map((item) => {
      if (item.type === "human") {
        const creator = item.creator ?? signerAddress;
        const createdAt = BigInt(item.createdAt ?? Math.floor(Date.now() / 1000));
        const proofMethod = item.proofMethod ?? "wallet-signed";
        const data = humanEncoder.encodeData([
          { name: "contentHash", value: hashContent(item.content), type: "bytes32" },
          { name: "contentType", value: item.contentType, type: "string" },
          { name: "creator", value: creator, type: "address" },
          { name: "createdAt", value: createdAt, type: "uint64" },
          { name: "proofMethod", value: proofMethod, type: "string" },
        ]);
        humanData.push({
          recipient: ZeroAddress,
          expirationTime: 0n,
          revocable: true,
          refUID: item.refUID ?? ZeroHash,
          data,
          value: 0n,
        });
        return { schema: "human" as const, idx: humanData.length - 1 };
      }
      if (item.prompt && item.promptHash) {
        throw new FidemarkError("INVALID_INPUT", "Pass either `prompt` or `promptHash`, not both.");
      }
      const promptHash = item.promptHash
        ? normalizeBytes32(item.promptHash)
        : item.prompt
          ? hashPrompt(item.prompt)
          : ZeroHash;
      const parameters = typeof item.parameters === "string"
        ? item.parameters
        : item.parameters
          ? JSON.stringify(item.parameters)
          : "";
      const data = aiEncoder.encodeData([
        { name: "contentHash", value: hashContent(item.content), type: "bytes32" },
        { name: "modelId", value: item.modelId, type: "string" },
        { name: "promptHash", value: promptHash, type: "bytes32" },
        { name: "parameters", value: parameters, type: "string" },
        { name: "provider", value: item.provider, type: "string" },
      ]);
      aiData.push({
        recipient: ZeroAddress,
        expirationTime: 0n,
        revocable: true,
        refUID: item.refUID ?? ZeroHash,
        data,
        value: 0n,
      });
      return { schema: "ai" as const, idx: aiData.length - 1 };
    });

    const requests: Array<{ schema: string; data: typeof humanData }> = [];
    if (humanData.length > 0) requests.push({ schema: this.network.schemas.human, data: humanData });
    if (aiData.length > 0) requests.push({ schema: this.network.schemas.ai, data: aiData });

    try {
      const tx = await this.eas.multiAttest(requests);
      const uidsFlat = await tx.wait();

      // Reconstruct: human UIDs come first in the result array if humanData exists.
      const humanUIDs: string[] = [];
      const aiUIDs: string[] = [];
      let cursor = 0;
      if (humanData.length > 0) {
        humanUIDs.push(...uidsFlat.slice(cursor, cursor + humanData.length));
        cursor += humanData.length;
      }
      if (aiData.length > 0) {
        aiUIDs.push(...uidsFlat.slice(cursor, cursor + aiData.length));
      }

      const uids = slotForItem.map((s) => (s.schema === "human" ? humanUIDs[s.idx]! : aiUIDs[s.idx]!));
      return {
        uids,
        txHash: tx.receipt?.hash ?? "",
        verifyUrls: uids.map((u) => this.verifyUrlFor(u)),
      };
    } catch (err) {
      throw mapChainError(err);
    }
  }

  async revoke(uid: string): Promise<{ txHash: string }> {
    const signer = this.requireSigner();
    const att = await this.eas.getAttestation(uid);
    if (att.uid === ZeroHash) {
      throw new FidemarkError("ATTESTATION_NOT_FOUND", `No attestation found for UID ${uid}.`);
    }
    try {
      const tx = await this.eas.revoke({ schema: att.schema, data: { uid, value: 0n } });
      await tx.wait();
      return { txHash: tx.receipt?.hash ?? "" };
    } catch (err) {
      throw mapChainError(err);
    }
  }

  /** Build a verify URL for an arbitrary UID without making a chain call. */
  verifyUrlFor(uid: string): string {
    return `${this.verifyUrlBase}/${uid}`;
  }

  /**
   * Sign an off-chain Human Proof. Zero gas. The returned envelope is
   * verifiable by anyone with the attester's address, see `verifyOffchain`.
   *
   * Pass `options.signWithDelegated: true` to also embed an EAS-delegated
   * attestation signature, so a third party can later bring the envelope
   * on-chain via `publishOffchain()` without the attester's wallet.
   */
  async attestHumanOffchain(
    input: AttestHumanInput,
    options: { signWithDelegated?: boolean; deadline?: bigint } = {},
  ): Promise<OffchainEnvelope> {
    return signHumanOffchain(this.requireSigner(), this.network, input, this.offchainOptions(options));
  }

  /** Sign an off-chain AI Proof. Same shape as `attestHumanOffchain`. */
  async attestAIOffchain(
    input: AttestAIInput,
    options: { signWithDelegated?: boolean; deadline?: bigint } = {},
  ): Promise<OffchainEnvelope> {
    return signAIOffchain(this.requireSigner(), this.network, input, this.offchainOptions(options));
  }

  /**
   * Bring an off-chain envelope on-chain using EAS's delegated attestation
   * flow. The envelope must have been signed with `signWithDelegated: true`.
   * The current Fidemark instance's signer becomes the on-chain submitter
   * and pays gas; the on-chain attester is recorded as the original off-chain
   * attester (i.e. `envelope.attester`).
   *
   * Returns the new on-chain UID, note this DIFFERS from `envelope.uid`,
   * because EAS sets `time = block.timestamp` at publish, which feeds the
   * UID hash. The off-chain envelope remains valid and verifiable independently.
   */
  async publishOffchain(envelope: OffchainEnvelope): Promise<AttestResult> {
    if (!envelope.delegated) {
      throw new FidemarkError(
        "INVALID_INPUT",
        "Envelope has no delegated signature. Re-sign with `signWithDelegated: true` to enable on-chain promotion.",
      );
    }
    if (envelope.network.chainId !== this.network.chainId) {
      throw new FidemarkError(
        "INVALID_INPUT",
        `Envelope was signed for chainId ${envelope.network.chainId}; current network is ${this.network.chainId}.`,
      );
    }
    if (envelope.network.eas.toLowerCase() !== this.network.contracts.eas.toLowerCase()) {
      throw new FidemarkError(
        "INVALID_INPUT",
        "Envelope was signed against a different EAS contract address than the current network.",
      );
    }
    this.requireSigner();

    const d = envelope.delegated;
    try {
      const tx = await this.eas.attestByDelegation({
        schema: d.request.schema,
        data: {
          recipient: d.request.recipient,
          data: d.request.data,
          expirationTime: BigInt(d.request.expirationTime),
          revocable: d.request.revocable,
          refUID: d.request.refUID,
          value: BigInt(d.request.value),
        },
        signature: { r: d.signature.r, s: d.signature.s, v: d.signature.v },
        attester: envelope.attester,
        deadline: BigInt(d.deadline),
      });
      const uid = await tx.wait();
      return {
        uid,
        txHash: tx.receipt?.hash ?? "",
        verifyUrl: this.verifyUrlFor(uid),
      };
    } catch (err) {
      throw mapChainError(err);
    }
  }

  private offchainOptions(opts: { signWithDelegated?: boolean; deadline?: bigint }): OffchainSignOptions {
    if (!opts.signWithDelegated) return {};
    return {
      signWithDelegated: true,
      eas: this.eas,
      ...(opts.deadline !== undefined ? { deadline: opts.deadline } : {}),
    };
  }

  /**
   * Verify an off-chain envelope's signature + decoded fields. Pure
   * cryptography, no RPC. Returns `true` iff the envelope was signed by
   * `envelope.attester` and has not been tampered with.
   */
  verifyOffchain(envelope: OffchainEnvelope): boolean {
    return verifyOffchainEnvelope(envelope, this.network);
  }

  /**
   * Resolve an address to a verified ENS name. Returns null if the wallet has
   * no ENS or the reverse + forward records don't match.
   *
   * Requires `ensProvider` (Ethereum mainnet) in the constructor config.
   */
  async resolveENS(address: string): Promise<VerifiedENS | null> {
    if (!this.ensProvider) {
      throw new FidemarkError(
        "INVALID_INPUT",
        "Construct Fidemark with `ensProvider` (Ethereum mainnet) to use ENS lookups.",
      );
    }
    return resolveVerifiedENS(this.ensProvider, address);
  }

  /**
   * Issue a Human Proof at trust Layer 1: pre-flight checks the signer's ENS
   * reverse + forward resolution matches, then attests with
   * `proofMethod = "ens-verified"`.
   *
   * Requires:
   *   - The deployed Resolver to have `ens-verified` on its proofMethod
   *     allowlist (owner-only `addProofMethod` call).
   *   - `ensProvider` (Ethereum mainnet) in the constructor config.
   *
   * Throws `INVALID_INPUT` if the signer has no verifiable ENS record.
   */
  async attestHumanWithENS(input: Omit<AttestHumanInput, "proofMethod">): Promise<AttestResult & { ens: VerifiedENS }> {
    if (!this.ensProvider) {
      throw new FidemarkError(
        "INVALID_INPUT",
        "Construct Fidemark with `ensProvider` (Ethereum mainnet) to use attestHumanWithENS.",
      );
    }
    const signer = this.requireSigner();
    const address = await signer.getAddress();
    const ens = await resolveVerifiedENS(this.ensProvider, address);
    if (!ens) {
      throw new FidemarkError(
        "INVALID_INPUT",
        `Wallet ${address} has no verifiable ENS name. Reverse + forward resolution must round-trip to use the ens-verified trust layer.`,
      );
    }
    const result = await this.attestHuman({ ...input, proofMethod: "ens-verified" });
    return { ...result, ens };
  }

  private async attest(
    schemaUID: string,
    encodedData: string,
    refUID?: string,
  ): Promise<AttestResult> {
    this.requireSigner();
    try {
      const tx = await this.eas.attest({
        schema: schemaUID,
        data: {
          recipient: ZeroAddress,
          expirationTime: 0n,
          revocable: true,
          refUID: refUID ?? ZeroHash,
          data: encodedData,
          value: 0n,
        },
      });
      const uid = await tx.wait();
      return {
        uid,
        txHash: tx.receipt?.hash ?? "",
        verifyUrl: this.verifyUrlFor(uid),
      };
    } catch (err) {
      throw mapChainError(err);
    }
  }

  private requireSigner(): Signer {
    if (!this.signer) {
      throw new FidemarkError(
        "INVALID_INPUT",
        "This operation requires a signer. Construct Fidemark with `signer` or `privateKey`.",
      );
    }
    return this.signer;
  }

  private decodeAttestation(raw: EASAttestation): FidemarkAttestation {
    const type: FidemarkSchemaType =
      raw.schema === this.network.schemas.human
        ? "human"
        : raw.schema === this.network.schemas.ai
          ? "ai"
          : raw.schema === this.network.schemas.multi
            ? "multi"
            : raw.schema === this.network.schemas.pop
              ? "pop"
              : (() => {
                  throw new FidemarkError(
                    "VALIDATION_REJECTED",
                    `Attestation ${raw.uid} uses an unrecognized schema for this network.`,
                  );
                })();

    const coder = AbiCoder.defaultAbiCoder();
    const base: FidemarkAttestation = {
      uid: raw.uid,
      type,
      schemaUID: raw.schema,
      attester: raw.attester,
      recipient: raw.recipient,
      contentHash: ZeroHash,
      createdAt: Number(raw.time),
      revoked: raw.revocationTime > 0n,
      revokedAt: raw.revocationTime > 0n ? Number(raw.revocationTime) : undefined,
      refUID: raw.refUID,
      verifyUrl: this.verifyUrlFor(raw.uid),
    };

    if (type === "human") {
      const [contentHash, contentType, creator, createdAtAttested, proofMethod] = coder.decode(
        ["bytes32", "string", "address", "uint64", "string"],
        raw.data,
      );
      return {
        ...base,
        contentHash: contentHash as string,
        human: {
          contentType: contentType as string,
          creator: creator as string,
          proofMethod: proofMethod as string,
          createdAtAttested: Number(createdAtAttested),
        },
      };
    }

    if (type === "multi") {
      const [contentHash, contentType, attesters, signatures, createdAtAttested, proofMethod] =
        coder.decode(
          ["bytes32", "string", "address[]", "bytes[]", "uint64", "string"],
          raw.data,
        );
      return {
        ...base,
        contentHash: contentHash as string,
        multi: {
          contentType: contentType as string,
          attesters: [...(attesters as string[])],
          signatures: [...(signatures as string[])],
          proofMethod: proofMethod as string,
          createdAtAttested: Number(createdAtAttested),
        },
      };
    }

    if (type === "pop") {
      const [
        contentHash,
        contentType,
        creator,
        createdAtAttested,
        root,
        nullifierHash,
        proof,
        proofMethod,
      ] = coder.decode(
        ["bytes32", "string", "address", "uint64", "uint256", "uint256", "uint256[8]", "string"],
        raw.data,
      );
      return {
        ...base,
        contentHash: contentHash as string,
        pop: {
          contentType: contentType as string,
          creator: creator as string,
          proofMethod: proofMethod as string,
          createdAtAttested: Number(createdAtAttested),
          root: (root as bigint).toString(),
          nullifierHash: (nullifierHash as bigint).toString(),
          proof: (proof as bigint[]).map((p) => p.toString()),
        },
      };
    }

    const [contentHash, modelId, promptHash, parameters, provider] = coder.decode(
      ["bytes32", "string", "bytes32", "string", "string"],
      raw.data,
    );
    return {
      ...base,
      contentHash: contentHash as string,
      ai: {
        modelId: modelId as string,
        provider: provider as string,
        promptHash: promptHash as string,
        parameters: parameters as string,
      },
    };
  }
}

function normalizeBytes32(value: string): string {
  if (!isHexString(value, 32)) {
    throw new FidemarkError("INVALID_INPUT", `promptHash must be a 0x-prefixed 32-byte hex string, got ${value}`);
  }
  return value.toLowerCase();
}
