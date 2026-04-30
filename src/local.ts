/**
 * Helpers for connecting the SDK to a deployment artifact.
 *
 * Local devnet artifacts are written by `npm run dev:chain`. Public-network
 * artifacts are written by `npm run deploy:sepolia` / `deploy:base` (or the
 * post-deploy script). All share the same shape, so one loader handles both.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { registerNetwork, type NetworkConfig, type NetworkName } from "./networks.js";

interface DeploymentArtifact {
  network: string;
  chainId: number;
  rpcUrl: string;
  deployBlock?: number;
  contracts: {
    schemaRegistry: string;
    eas: string;
    resolver: string;
    multiResolver?: string;
    popResolver?: string;
    worldIdVerifier?: string;
  };
  worldId?: {
    appId: string;
    groupId: number;
    isMock?: boolean;
  };
  schemas: {
    human: { uid: string; definition: string };
    ai: { uid: string; definition: string };
    multi?: { uid: string; definition: string };
    pop?: { uid: string; definition: string };
  };
}

/** Load the local devnet artifact and register it as the "local" network. */
export function loadLocalNetwork(explicitPath?: string): NetworkConfig {
  return loadDeploymentArtifact("local", explicitPath);
}

/**
 * Load any deployment artifact by network name. Looks at:
 *   - `explicitPath` if passed
 *   - `$FIDEMARK_DEPLOYMENT` env var (one path, applies to whichever network it points at)
 *   - `<repo-root>/sources/contracts/deployments/<name>.json` (resolved by walking up from cwd)
 */
export function loadDeploymentArtifact(name: NetworkName, explicitPath?: string): NetworkConfig {
  const filePath = explicitPath ?? process.env.FIDEMARK_DEPLOYMENT ?? findArtifact(name);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Deployment artifact for "${name}" not found at ${filePath}. ` +
        (name === "local"
          ? "Run `npm run dev:chain` in sources/contracts first."
          : `Run \`npm run deploy:${name === "base-sepolia" ? "sepolia" : name}\` in sources/contracts first.`),
    );
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as DeploymentArtifact;

  const config: NetworkConfig = {
    name,
    chainId: raw.chainId,
    rpcUrl: raw.rpcUrl,
    deployBlock: raw.deployBlock,
    contracts: {
      eas: raw.contracts.eas,
      schemaRegistry: raw.contracts.schemaRegistry,
      resolver: raw.contracts.resolver,
      ...(raw.contracts.multiResolver ? { multiResolver: raw.contracts.multiResolver } : {}),
      ...(raw.contracts.popResolver ? { popResolver: raw.contracts.popResolver } : {}),
      ...(raw.contracts.worldIdVerifier
        ? { worldIdVerifier: raw.contracts.worldIdVerifier }
        : {}),
    },
    schemas: {
      human: raw.schemas.human.uid,
      ai: raw.schemas.ai.uid,
      ...(raw.schemas.multi ? { multi: raw.schemas.multi.uid } : {}),
      ...(raw.schemas.pop ? { pop: raw.schemas.pop.uid } : {}),
    },
    ...(raw.worldId ? { worldId: raw.worldId } : {}),
  };

  registerNetwork(name, config);
  return config;
}

function findArtifact(name: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "sources", "contracts", "deployments", `${name}.json`);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), "sources", "contracts", "deployments", `${name}.json`);
}
