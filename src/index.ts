export { Fidemark } from "./fidemark.js";
export type {
  FidemarkConfig,
  AttestHumanInput,
  AttestAIInput,
  AttestMultiPartyInput,
  AttestHumanWithPoPInput,
  FidemarkAttestation,
  FidemarkSchemaType,
  BatchItem,
  BatchHumanItem,
  BatchAIItem,
  BatchResult,
  InspectResult,
} from "./fidemark.js";
export { hashContent, hashPrompt } from "./hashing.js";
export { getNetwork, registerNetwork } from "./networks.js";
export type { NetworkConfig, NetworkName } from "./networks.js";
export { loadLocalNetwork, loadDeploymentArtifact } from "./local.js";
export { FidemarkError } from "./errors.js";
export {
  signHumanOffchain,
  signAIOffchain,
  verifyOffchain,
  decodeOffchain,
} from "./offchain.js";
export type {
  OffchainEnvelope,
  OffchainSignOptions,
  DelegatedSignaturePayload,
} from "./offchain.js";
export { resolveVerifiedENS } from "./ens.js";
export type { VerifiedENS } from "./ens.js";
export { defaultClient } from "./indexer.js";
export type { IndexerMode, GraphqlClient, GraphqlAttestation } from "./indexer.js";
export {
  signMultiPartyClaim,
  buildMultiPartyClaim,
  multiPartyClaimDigest,
  MULTI_PARTY_TYPES,
  MULTI_PARTY_DOMAIN_NAME,
  MULTI_PARTY_DOMAIN_VERSION,
} from "./multi.js";
export type { MultiPartyClaim, MultiPartySlip } from "./multi.js";
export {
  hashToField,
  actionForContent,
  externalNullifierFor,
  signalStringFor,
  signalHashFor,
  normalizeWorldIdProof,
} from "./pop.js";
export type { WorldIdProof } from "./pop.js";
