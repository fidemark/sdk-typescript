import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDeploymentArtifact, getNetwork } from "../../src/index.js";

describe("loadDeploymentArtifact", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fidemark-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a base-sepolia artifact and registers the network", () => {
    const path = join(dir, "base-sepolia.json");
    writeFileSync(
      path,
      JSON.stringify({
        network: "base-sepolia",
        chainId: 84532,
        rpcUrl: "https://sepolia.base.org",
        contracts: {
          schemaRegistry: "0x4200000000000000000000000000000000000020",
          eas: "0x4200000000000000000000000000000000000021",
          resolver: "0x1111111111111111111111111111111111111111",
        },
        schemas: {
          human: { uid: "0xaa", definition: "..." },
          ai: { uid: "0xbb", definition: "..." },
        },
      }),
    );

    const cfg = loadDeploymentArtifact("base-sepolia", path);
    expect(cfg.chainId).toBe(84532);
    expect(cfg.contracts.resolver).toBe("0x1111111111111111111111111111111111111111");
    expect(cfg.schemas.human).toBe("0xaa");

    // After registration, getNetwork should also return it.
    const got = getNetwork("base-sepolia");
    expect(got.contracts.resolver).toBe("0x1111111111111111111111111111111111111111");
  });

  it("throws a useful error when the artifact is missing", () => {
    expect(() => loadDeploymentArtifact("base", join(dir, "does-not-exist.json"))).toThrow(
      /not found/,
    );
  });
});
