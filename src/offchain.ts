/**
 * Off-chain (EIP-712) attestations.
 *
 * Same schemas, same fields, but the attestation is signed and stored locally
 * (or wherever the publisher wants) instead of being broadcast to chain. Zero
 * gas. Verifiable by anyone who has the envelope and the attester's address.
 *
 * Use cases:
 *   - Free-tier flows where users don't have crypto.
 *   - High-volume pipelines where on-chain cost is prohibitive.
 *   - Pre-publication staging, sign now, bring on-chain later.
 */

import { Offchain, OffchainAttestationVersion, SchemaEncoder, Delegated } from "./_eas-runtime.js";
import type {
  SignedOffchainAttestation,
  Offchain as OffchainInstance,
  Delegated as DelegatedInstance,
  EAS as EASInstance,
} from "@ethereum-attestation-service/eas-sdk";
import {
  AbiCoder,
  ZeroAddress,
  ZeroHash,
  isHexString,
  type Signer,
  type TypedDataDomain,
  type TypedDataField,
} from "ethers";
import { hashContent, hashPrompt } from "./hashing.js";
import type { NetworkConfig } from "./networks.js";
import { FidemarkError, mapChainError } from "./errors.js";
import type { AttestHumanInput, AttestAIInput, FidemarkSchemaType } from "./fidemark.js";

// Must match the EAS contract's Semver. Base + Base Sepolia ship 1.3.0.
const EAS_DOMAIN_VERSION = "1.3.0";

const HUMAN_SCHEMA_DEF =
  "bytes32 contentHash,string contentType,address creator,uint64 createdAt,string proofMethod";
const AI_SCHEMA_DEF =
  "bytes32 contentHash,string modelId,bytes32 promptHash,string parameters,string provider";

/**
 * The wire format for an off-chain attestation. Serializable to JSON, shareable
 * over any transport. Consumers verify it by passing it to `verifyOffchain()`.
 */
export interface OffchainEnvelope {
  /** Schema discriminator. */
  type: FidemarkSchemaType;
  /** SDK envelope version, bump on breaking shape changes. */
  fidemarkVersion: 1;
  /** EAS-derived UID (deterministic from the signed payload). */
  uid: string;
  /** Address that signed the attestation. */
  attester: string;
  /** Network the attestation was signed for. */
  network: { chainId: number; name: string; eas: string };
  /** The full signed EAS payload, verifiable independently with the EAS SDK. */
  signed: SignedOffchainAttestation;
  /** Decoded schema fields, for convenience. */
  decoded: DecodedHumanFields | DecodedAIFields;
  /**
   * Optional EAS-delegated-attestation signature, generated alongside the
   * off-chain envelope when `signWithDelegated: true` is passed to the
   * signer. Lets a third party (the "payer") publish this envelope on-chain
   * via `Fidemark.publishOffchain()` without the original attester's wallet.
   *
   * Caveats:
   *  - The on-chain UID after promotion will differ from `envelope.uid`,
   *    EAS sets `time = block.timestamp` at promotion, so the UID is recomputed.
   *  - The delegated signature is bound to the attester's `nonce` at sign
   *    time. Any subsequent on-chain delegated attestation by the same
   *    attester (NOT a regular `attest`, only delegated) bumps the nonce
   *    and invalidates this signature.
   *  - `deadline` is a Unix-second timestamp after which the chain will
   *    refuse to publish. Defaults to never (0) when omitted at sign time.
   */
  delegated?: DelegatedSignaturePayload;
}

export interface DelegatedSignaturePayload {
  /** Compact 65-byte signature, as `{ r, s, v }`. */
  signature: { r: string; s: string; v: number };
  /** Attester's nonce at sign time, must still be current at publish time. */
  nonce: string;
  /** Unix seconds after which the chain rejects the publish. `"0"` = no deadline. */
  deadline: string;
  /** Snapshot of the EAS message that was signed, used to rebuild the on-chain request. */
  request: {
    schema: string;
    recipient: string;
    expirationTime: string;
    revocable: boolean;
    refUID: string;
    data: string;
    value: string;
  };
}

interface DecodedHumanFields {
  contentHash: string;
  contentType: string;
  creator: string;
  createdAt: number;
  proofMethod: string;
}

interface DecodedAIFields {
  contentHash: string;
  modelId: string;
  promptHash: string;
  parameters: string;
  provider: string;
}

/** Internal, the EIP-712 typed-data signer interface the EAS SDK expects. */
interface TypeDataSigner {
  getAddress(): Promise<string>;
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string>;
}

/**
 * Optional knobs for off-chain signing.
 */
export interface OffchainSignOptions {
  /**
   * Also produce a delegated-attestation signature, embedded in
   * `envelope.delegated`. Lets `Fidemark.publishOffchain()` bring the
   * envelope on-chain later without the original attester's wallet.
   *
   * Requires `eas`, the SDK reads the attester's nonce from chain unless
   * `nonce` is provided explicitly.
   */
  signWithDelegated?: boolean;
  /** EAS instance bound to a provider. Required when `signWithDelegated` is true. */
  eas?: EASInstance;
  /** Override the auto-fetched attester nonce. Advanced, for batch flows. */
  nonce?: bigint;
  /** Unix-second deadline for the delegated signature. 0n = never expires (default). */
  deadline?: bigint;
}

/**
 * Build an off-chain Human Proof envelope. Mirror of `Fidemark.attestHuman`
 * with no chain interaction, just signing.
 */
export async function signHumanOffchain(
  signer: Signer,
  network: NetworkConfig,
  input: AttestHumanInput,
  options: OffchainSignOptions = {},
): Promise<OffchainEnvelope> {
  const attester = await signer.getAddress();
  const creator = input.creator ?? attester;
  const createdAt = BigInt(input.createdAt ?? Math.floor(Date.now() / 1000));
  const proofMethod = input.proofMethod ?? "wallet-signed";
  const contentHash = hashContent(input.content);

  const encoder = new SchemaEncoder(HUMAN_SCHEMA_DEF);
  const data = encoder.encodeData([
    { name: "contentHash", value: contentHash, type: "bytes32" },
    { name: "contentType", value: input.contentType, type: "string" },
    { name: "creator", value: creator, type: "address" },
    { name: "createdAt", value: createdAt, type: "uint64" },
    { name: "proofMethod", value: proofMethod, type: "string" },
  ]);

  const signed = await sign(signer, network, network.schemas.human, data, createdAt);

  const delegated = options.signWithDelegated
    ? await signDelegated(signer, network, network.schemas.human, data, options)
    : undefined;

  return {
    type: "human",
    fidemarkVersion: 1,
    uid: signed.uid,
    attester,
    network: { chainId: network.chainId, name: network.name, eas: network.contracts.eas },
    signed,
    decoded: {
      contentHash,
      contentType: input.contentType,
      creator,
      createdAt: Number(createdAt),
      proofMethod,
    },
    ...(delegated ? { delegated } : {}),
  };
}

/** Build an off-chain AI Proof envelope. */
export async function signAIOffchain(
  signer: Signer,
  network: NetworkConfig,
  input: AttestAIInput,
  options: OffchainSignOptions = {},
): Promise<OffchainEnvelope> {
  if (input.prompt && input.promptHash) {
    throw new FidemarkError("INVALID_INPUT", "Pass either `prompt` or `promptHash`, not both.");
  }
  const promptHash = input.promptHash
    ? normalizeBytes32(input.promptHash)
    : input.prompt
      ? hashPrompt(input.prompt)
      : ZeroHash;

  const parameters =
    typeof input.parameters === "string"
      ? input.parameters
      : input.parameters
        ? JSON.stringify(input.parameters)
        : "";

  const contentHash = hashContent(input.content);
  const attester = await signer.getAddress();

  const encoder = new SchemaEncoder(AI_SCHEMA_DEF);
  const data = encoder.encodeData([
    { name: "contentHash", value: contentHash, type: "bytes32" },
    { name: "modelId", value: input.modelId, type: "string" },
    { name: "promptHash", value: promptHash, type: "bytes32" },
    { name: "parameters", value: parameters, type: "string" },
    { name: "provider", value: input.provider, type: "string" },
  ]);

  const time = BigInt(Math.floor(Date.now() / 1000));
  const signed = await sign(signer, network, network.schemas.ai, data, time);

  const delegated = options.signWithDelegated
    ? await signDelegated(signer, network, network.schemas.ai, data, options)
    : undefined;

  return {
    type: "ai",
    fidemarkVersion: 1,
    uid: signed.uid,
    attester,
    network: { chainId: network.chainId, name: network.name, eas: network.contracts.eas },
    signed,
    decoded: {
      contentHash,
      modelId: input.modelId,
      promptHash,
      parameters,
      provider: input.provider,
    },
    ...(delegated ? { delegated } : {}),
  };
}

/**
 * Verify an off-chain envelope. Returns true iff:
 *   - The signature recovers to `envelope.attester`.
 *   - The signed payload matches the decoded fields (signature covers the data).
 *   - The envelope's schema UID matches the network's expected schema for its `type`.
 *
 * Tampered envelopes fail. The check is purely cryptographic, no RPC.
 */
export function verifyOffchain(envelope: OffchainEnvelope, network: NetworkConfig): boolean {
  // 1. Schema must match the network's expected schema for the declared type.
  const expectedSchema = envelope.type === "human" ? network.schemas.human : network.schemas.ai;
  if (envelope.signed.message.schema !== expectedSchema) return false;

  // 2. Network metadata must match the network we're verifying against.
  if (envelope.network.eas.toLowerCase() !== network.contracts.eas.toLowerCase()) return false;
  if (envelope.network.chainId !== network.chainId) return false;

  // 3. Signature must recover to the declared attester.
  try {
    const offchain = buildOffchain(network);
    return offchain.verifyOffchainAttestationSignature(envelope.attester, envelope.signed);
  } catch (err) {
    throw mapChainError(err);
  }
}

/** Decode an envelope's signed payload back into the high-level fields. Useful when only `signed` is on hand. */
export function decodeOffchain(envelope: OffchainEnvelope): DecodedHumanFields | DecodedAIFields {
  const coder = AbiCoder.defaultAbiCoder();
  const data = envelope.signed.message.data;

  if (envelope.type === "human") {
    const [contentHash, contentType, creator, createdAt, proofMethod] = coder.decode(
      ["bytes32", "string", "address", "uint64", "string"],
      data,
    );
    return {
      contentHash: contentHash as string,
      contentType: contentType as string,
      creator: creator as string,
      createdAt: Number(createdAt),
      proofMethod: proofMethod as string,
    };
  }

  const [contentHash, modelId, promptHash, parameters, provider] = coder.decode(
    ["bytes32", "string", "bytes32", "string", "string"],
    data,
  );
  return {
    contentHash: contentHash as string,
    modelId: modelId as string,
    promptHash: promptHash as string,
    parameters: parameters as string,
    provider: provider as string,
  };
}

async function sign(
  signer: Signer,
  network: NetworkConfig,
  schemaUID: string,
  encodedData: string,
  time: bigint,
): Promise<SignedOffchainAttestation> {
  const offchain = buildOffchain(network);
  // The EAS Offchain class needs a TypeDataSigner (ethers Signer satisfies it).
  return offchain.signOffchainAttestation(
    {
      schema: schemaUID,
      recipient: ZeroAddress,
      time,
      expirationTime: 0n,
      revocable: true,
      refUID: ZeroHash,
      data: encodedData,
    },
    signer as unknown as TypeDataSigner,
    { verifyOnchain: false },
  );
}

async function signDelegated(
  signer: Signer,
  network: NetworkConfig,
  schemaUID: string,
  encodedData: string,
  options: OffchainSignOptions,
): Promise<DelegatedSignaturePayload> {
  if (!options.eas) {
    throw new FidemarkError(
      "INVALID_INPUT",
      "signWithDelegated requires `eas` (an EAS instance bound to a provider).",
    );
  }
  const delegated = buildDelegated(network, options.eas);
  const deadline = options.deadline ?? 0n;

  const params = {
    schema: schemaUID,
    recipient: ZeroAddress,
    expirationTime: 0n,
    revocable: true,
    refUID: ZeroHash,
    data: encodedData,
    value: 0n,
    deadline,
    ...(options.nonce !== undefined ? { nonce: options.nonce } : {}),
  };

  let response;
  try {
    response = await delegated.signDelegatedAttestation(
      params as unknown as Parameters<DelegatedInstance["signDelegatedAttestation"]>[0],
      signer as unknown as Parameters<DelegatedInstance["signDelegatedAttestation"]>[1],
    );
  } catch (err) {
    throw mapChainError(err);
  }

  return {
    signature: {
      r: response.signature.r,
      s: response.signature.s,
      v: response.signature.v,
    },
    nonce: (response.message.nonce ?? 0n).toString(),
    deadline: deadline.toString(),
    request: {
      schema: schemaUID,
      recipient: ZeroAddress,
      expirationTime: "0",
      revocable: true,
      refUID: ZeroHash,
      data: encodedData,
      value: "0",
    },
  };
}

function buildDelegated(network: NetworkConfig, eas: EASInstance): DelegatedInstance {
  return new Delegated(
    {
      address: network.contracts.eas,
      version: EAS_DOMAIN_VERSION,
      chainId: BigInt(network.chainId),
    },
    eas as unknown as ConstructorParameters<typeof Delegated>[1],
  );
}

function buildOffchain(network: NetworkConfig): OffchainInstance {
  // The EAS SDK requires an EAS instance for `getOffchainUID` legacy paths,
  // but the Offchain class only uses the chain config, we never call back to
  // the contract. Pass a stub `as any` to avoid a real RPC dependency.
  return new Offchain(
    {
      address: network.contracts.eas,
      version: EAS_DOMAIN_VERSION,
      chainId: BigInt(network.chainId),
    },
    OffchainAttestationVersion.Version2,
    {} as any,
  );
}

function normalizeBytes32(value: string): string {
  if (!isHexString(value, 32)) {
    throw new FidemarkError(
      "INVALID_INPUT",
      `promptHash must be a 0x-prefixed 32-byte hex string, got ${value}`,
    );
  }
  return value.toLowerCase();
}
