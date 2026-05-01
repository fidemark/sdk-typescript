/**
 * Helpers for connecting the SDK to a deployment artifact.
 *
 * Public-network artifacts (`base-sepolia.json`, `base.json`) are bundled into
 * the published package under `<package-root>/deployments/`. The loader checks
 * that location first, then falls back to a monorepo walk-up so contributors
 * working from `sources/sdk/typescript/` against a fresh devnet still see the
 * latest `sources/contracts/deployments/<name>.json` without rebuilding.
 *
 * Local devnet artifacts (`local.json`) are only written by `npm run dev:chain`
 * inside the monorepo and are intentionally not bundled into the package, since
 * end users never run a Fidemark devnet themselves.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { registerNetwork, type NetworkConfig } from "./networks.js";

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

/** Load the local devnet artifact (monorepo development only). */
export function loadLocalNetwork(explicitPath?: string): NetworkConfig {
  return loadDeploymentArtifact("local", explicitPath);
}

/**
 * Load any deployment artifact by network name.
 *
 * Resolution order:
 *   1. `explicitPath` if passed.
 *   2. `$FIDEMARK_DEPLOYMENT` env var (single path, applies to whichever network it names).
 *   3. Package-local `<package-root>/deployments/<name>.json` (bundled with the published SDK).
 *   4. Monorepo `sources/contracts/deployments/<name>.json`, by walking up from `process.cwd()`
 *      (kept for in-monorepo development; absent from the published package).
 */
export function loadDeploymentArtifact(name: string, explicitPath?: string): NetworkConfig {
  // Explicit caller intent wins. If you passed a path or set the env var,
  // we respect it; we don't silently fall back to a different file. Auto
  // fallbacks (package-local / monorepo) only run when neither was given.
  let filePath: string | undefined;
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(
        `Deployment artifact for "${name}" not found at ${explicitPath}. Check the path you passed.`,
      );
    }
    filePath = explicitPath;
  } else if (process.env.FIDEMARK_DEPLOYMENT) {
    const envPath = process.env.FIDEMARK_DEPLOYMENT;
    if (!fs.existsSync(envPath)) {
      throw new Error(
        `Deployment artifact for "${name}" not found at ${envPath} (from $FIDEMARK_DEPLOYMENT).`,
      );
    }
    filePath = envPath;
  } else {
    for (const candidate of [packageLocalPath(name), monorepoPath(name)]) {
      if (candidate && fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }
  }

  if (!filePath) {
    const hint =
      name === "local"
        ? "Run `npm run dev:chain` in sources/contracts first."
        : `Network "${name}" has not been deployed yet, or the SDK was published before this network went live.`;
    throw new Error(
      `Deployment artifact for "${name}" not found in any known location. ${hint}`,
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

/** Resolve `<package-root>/deployments/<name>.json`. Returns undefined if the
 * loader can't determine its own package root (e.g. unusual bundlers). */
function packageLocalPath(name: string): string | undefined {
  try {
    // After tsup, this module ends up at <package-root>/dist/index.{js,cjs}.
    // The `deployments/` folder ships as a sibling of `dist/`, listed in the
    // package.json `files` array.
    const here =
      typeof __filename === "string"
        ? __filename
        : fileURLToPath(import.meta.url);
    const dist = path.dirname(here);
    return path.join(dist, "..", "deployments", `${name}.json`);
  } catch {
    return undefined;
  }
}

/** Walk up from cwd looking for `sources/contracts/deployments/<name>.json`.
 * Only meaningful inside the monorepo. Always returns a string so callers can
 * fall through to a final existence check. */
function monorepoPath(name: string): string {
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
