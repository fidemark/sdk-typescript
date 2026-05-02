/**
 * Minimal FidemarkResolver ABI fragment, only the events used by `verifyByHash`
 * and `myAttestations`. Keeping this narrow keeps the SDK bundle small.
 */
export const RESOLVER_EVENTS_ABI = [
  "event HumanAttestation(bytes32 indexed uid, address indexed creator, bytes32 indexed contentHash, string proofMethod)",
  "event AIAttestation(bytes32 indexed uid, address indexed attester, bytes32 indexed contentHash, string modelId, string provider)",
] as const;

export const MULTI_RESOLVER_EVENTS_ABI = [
  "event MultiAttestation(bytes32 indexed uid, bytes32 indexed contentHash, address submitter, uint256 attesterCount)",
] as const;

export const POP_RESOLVER_EVENTS_ABI = [
  "event PoPAttestation(bytes32 indexed uid, address indexed creator, bytes32 indexed contentHash, uint256 nullifierHash, uint256 groupId, string proofMethod)",
] as const;
