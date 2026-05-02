/**
 * Known Fidemark networks.
 *
 * The registry holds RPC + EAS predeploy info for every network the SDK
 * knows about. Resolver addresses and schema UIDs come from per-network
 * deployment artifacts bundled with the package (see `local.ts`).
 *
 * Loaders:
 *   - `loadDeploymentArtifact(name)` reads the artifact for any deployed
 *     network (`base-sepolia`, `base`, ...) and registers it.
 *   - `loadLocalNetwork()` is monorepo-development-only; it loads
 *     `sources/contracts/deployments/local.json` produced by
 *     `npm run dev:chain`. Not advertised to end users.
 *
 * `getNetwork(name)` lazy-loads a public-network artifact on first call,
 * so application code only has to write `getNetwork("base-sepolia")` and
 * the resolver/schema UIDs are pulled from the bundled artifact behind
 * the scenes.
 */

// Top-level import is safe even though local.ts imports `registerNetwork`
// from here: ESM handles the cycle as long as no symbol is accessed during
// module evaluation. `loadDeploymentArtifact` is only called inside
// `getNetwork`, after both modules have finished initializing.
// eslint-disable-next-line import/no-cycle
import { loadDeploymentArtifact } from "./local.js";

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

/** The set of public Fidemark networks consumers can target. */
export type NetworkName = "base-sepolia" | "base";

const REGISTRY: Record<string, NetworkConfig> = {
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
    // Lazy-load the bundled artifact. Avoids forcing every consumer to call
    // loadDeploymentArtifact() explicitly: getNetwork("base-sepolia") just
    // works as long as the package was published with the artifact in place.
    try {
      return loadDeploymentArtifact(name);
    } catch (err) {
      throw new Error(
        `Network ${name} is not yet deployed in this build of the SDK. ` +
          `Try upgrading to a newer version of @fidemark/sdk, or call ` +
          `loadDeploymentArtifact("${name}", "/path/to/artifact.json") manually. ` +
          `Underlying cause: ${(err as Error).message ?? String(err)}`,
      );
    }
  }
  return cfg;
}

/**
 * Register a network at runtime. Used by `loadLocalNetwork` /
 * `loadDeploymentArtifact` to inject deployed addresses, and by tests to wire
 * up an ad-hoc deployment.
 */
export function registerNetwork(name: string, config: NetworkConfig): void {
  REGISTRY[name] = config;
}
