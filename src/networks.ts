/**
 * Known Fidemark networks.
 *
 * The registry holds RPC + EAS predeploy info for every supported chain. The
 * resolver address and schema UIDs come from per-network deployment artifacts
 * written by the contracts package's post-deploy script. Until an artifact is
 * loaded for a public network, that network is reported as "not yet deployed".
 *
 * Loaders:
 *   - `loadLocalNetwork()`, reads `deployments/local.json` from the contracts package.
 *   - `loadDeploymentArtifact(name)`, reads `deployments/<name>.json` (testnet/mainnet).
 */

export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  /** Block at which the resolver was deployed. Used to bound event scans. */
  deployBlock?: number;
  contracts: {
    eas: string;
    schemaRegistry: string;
    resolver: string;
    /** Multi-party (Layer 2) resolver. Optional, present once deployed. */
    multiResolver?: string;
    /** PoP (Layer 4) resolver. Optional, present once deployed. */
    popResolver?: string;
    /** World ID (Worldcoin) verifier address. Optional. */
    worldIdVerifier?: string;
  };
  schemas: {
    human: string;
    ai: string;
    /** Multi-party (Layer 2) schema. Optional, present once registered. */
    multi?: string;
    /** PoP (Layer 4) schema. Optional, present once registered. */
    pop?: string;
  };
  /** Worldcoin app config bound to this deployment's PoP resolver. */
  worldId?: {
    appId: string;
    groupId: number;
    /** True if backed by MockWorldID (local dev). False on real chains. */
    isMock?: boolean;
  };
}

// EAS predeploy addresses on the OP Stack (Base + Base Sepolia).
const OP_STACK_EAS = "0x4200000000000000000000000000000000000021";
const OP_STACK_SCHEMA_REGISTRY = "0x4200000000000000000000000000000000000020";

export type NetworkName = "local" | "base-sepolia" | "base";

const REGISTRY: Partial<Record<NetworkName, NetworkConfig>> = {
  "base-sepolia": {
    name: "base-sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    contracts: {
      eas: OP_STACK_EAS,
      schemaRegistry: OP_STACK_SCHEMA_REGISTRY,
      resolver: "",
    },
    schemas: { human: "", ai: "" },
  },
  base: {
    name: "base",
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    contracts: {
      eas: OP_STACK_EAS,
      schemaRegistry: OP_STACK_SCHEMA_REGISTRY,
      resolver: "",
    },
    schemas: { human: "", ai: "" },
  },
};

export function getNetwork(name: NetworkName): NetworkConfig {
  const cfg = REGISTRY[name];
  if (!cfg) {
    throw new Error(`Unknown network: ${name}. Known: ${Object.keys(REGISTRY).join(", ")}`);
  }
  if (!cfg.contracts.resolver || !cfg.schemas.human || !cfg.schemas.ai) {
    throw new Error(
      `Network ${name} is not yet deployed. Contract addresses unset. ` +
        `Run \`npm run deploy:${name === "base-sepolia" ? "sepolia" : name}\` in sources/contracts ` +
        `or call \`loadDeploymentArtifact('${name}')\` if the artifact exists.`,
    );
  }
  return cfg;
}

/**
 * Register a network at runtime. Used by `loadLocalNetwork` /
 * `loadDeploymentArtifact` to inject deployed addresses, and by tests to wire
 * up an ad-hoc deployment.
 */
export function registerNetwork(name: NetworkName, config: NetworkConfig): void {
  REGISTRY[name] = config;
}
