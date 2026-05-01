# Deployment artifacts (TypeScript SDK)

This folder holds the per-network deployment artifacts the published
`@fidemark/sdk` ships with. The post-deploy script in
`sources/contracts/scripts/post-deploy.ts` writes a JSON file here for every
public-network deploy (e.g. `base-sepolia.json`, `base.json`).

The SDK loader (`src/local.ts`) checks this folder first when a consumer
calls `getNetwork("base-sepolia")`, so applications running outside the
monorepo see the right resolver address and schema UIDs without ever
talking to a registry.

`local.json` is intentionally NOT shipped here. The local devnet is
maintainer-only and lives at `sources/contracts/deployments/local.json`.
