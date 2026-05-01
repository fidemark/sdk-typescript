# @fidemark/sdk

> *Prove it's real. Prove it's AI. Prove it on-chain.*

Official TypeScript SDK for **Fidemark**, a permissionless, tokenless content-provenance protocol built on
[Ethereum Attestation Service](https://attest.org) on **Base** (L2). Use it to attest human authorship or
AI-generated output, verify those attestations on chain, and walk provenance chains, all from a single client.

- Two complementary attestation flows on one EAS foundation: **Human Proof** and **AI Proof**.
- Permissionless, no allowlist, no consortium, no protocol token.
- Verifiable without trust: every attestation is a public on-chain record.
- Deployed network addresses + schema UIDs ship inside the package, so `getNetwork("base-sepolia")` just works.

## Install

```bash
npm install @fidemark/sdk ethers
# or:  pnpm add @fidemark/sdk ethers
# or:  yarn add @fidemark/sdk ethers
```

Requires Node.js 20 or newer. The SDK is server-side only; do not import it from a `"use client"` Next.js component.

## Quickstart

```ts
import { Fidemark, getNetwork } from "@fidemark/sdk";

const fidemark = new Fidemark({
  network: getNetwork("base-sepolia"),     // or "base"
  privateKey: process.env.PRIVATE_KEY,
});

// 1. Attest authored content
const result = await fidemark.attestHuman({
  content: "An essay I wrote myself.",
  contentType: "text/article",
});
console.log(result.verifyUrl);             // https://verify.fidemark.dev/0x...

// 2. Verify any attestation by UID, no signer required
const att = await fidemark.verify(result.uid);
console.log(att.attester, att.contentHash);

// 3. Find every attestation on a piece of content
import { hashContent } from "@fidemark/sdk";
const matches = await fidemark.verifyByHash(hashContent(myArticle));
```

A standalone read-only client (no `privateKey`) is enough for verification:

```ts
const reader = new Fidemark({ network: getNetwork("base") });
const att = await reader.verify(uid);
```

## What you can do

| Capability                                | Method                                                               |
| ----------------------------------------- | -------------------------------------------------------------------- |
| Attest authored content                   | `attestHuman({ content, contentType })`                              |
| Attest AI output (model + prompt hash)    | `attestAI({ content, modelId, provider, prompt })`                   |
| ENS-verified Human Proof                  | `attestHumanWithENS({ content, contentType })`                       |
| Multi-party (N-of-N) co-attestation       | `attestMultiParty({ claim, slips })`                                 |
| Verified-human (Worldcoin PoP)            | `attestHumanWithPoP({ content, contentType, worldIdProof })`         |
| Off-chain EIP-712 envelopes (zero gas)    | `attestHumanOffchain`, `attestAIOffchain`, `verifyOffchain`          |
| Bring an off-chain envelope on-chain      | `publishOffchain(envelope)` (anyone with funds can publish)          |
| Verify a UID                              | `verify(uid)`                                                        |
| Find every attestation on a content hash  | `verifyByHash(contentHash)`                                          |
| Walk a provenance chain                   | `verifyChain(uid)`                                                   |
| Revoke (only the original attester)       | `revoke(uid)`                                                        |
| Inspect without throwing                  | `inspect(uid)` returns `{ ok, attestation } \| { ok: false, reason }` |

Trust layers (`proofMethod`) supported today: `wallet-signed` (L0), `ens-verified` (L1), `multi-party` (L2),
`pop-verified-worldid` (L4). See [Trust layers](https://docs.fidemark.dev/concepts/trust-layers/) for the full design.

## Networks

| Network        | Argument                       | Notes                         |
| -------------- | ------------------------------ | ----------------------------- |
| Base Sepolia   | `getNetwork("base-sepolia")`   | testnet (chainId 84532)       |
| Base mainnet   | `getNetwork("base")`           | (chainId 8453)                |

The published package bundles each network's deployment artifact (resolver address + schema UIDs). If you call
`getNetwork(name)` against a network this version of the SDK predates, the call raises
`NETWORK_NOT_DEPLOYED`. Upgrade the package or wait for the next release.

## Errors

Every failure surfaces a `FidemarkError` with a stable `code` string so you can branch on it without
parsing messages:

```ts
import { FidemarkError } from "@fidemark/sdk";

try {
  await fidemark.revoke(uid);
} catch (err) {
  if (err instanceof FidemarkError && err.code === "VALIDATION_REJECTED") {
    // Only the original attester can revoke.
  }
}
```

Codes: `INVALID_INPUT`, `NETWORK_NOT_DEPLOYED`, `ATTESTATION_NOT_FOUND`, `ATTESTATION_REVOKED`,
`UNKNOWN_SCHEMA`, `INSUFFICIENT_FUNDS`, `VALIDATION_REJECTED`, `USER_REJECTED`, `RPC_ERROR`,
`NOT_YET_IMPLEMENTED`, `UNKNOWN`.

## Configuration

```ts
new Fidemark({
  network,           // required: NetworkConfig
  privateKey,        // for write ops
  signer,            // alternative to privateKey, any ethers v6 Signer
  provider,          // override the default Base RPC
  ensProvider,       // Ethereum mainnet provider for ENS-verified attestations
  verifyUrlBase,     // override the verify-URL host (default: https://verify.fidemark.dev)
  indexer,           // "events" (default), "graphql", or "auto"
  indexerUrl,        // EAS GraphQL endpoint for verifyByHash on busy mainnet RPCs
});
```

See [docs.fidemark.dev/sdk/configuration](https://docs.fidemark.dev/sdk/configuration/) for the full surface.

## Documentation

- **Concepts**: https://docs.fidemark.dev/concepts/how-it-works/
- **SDK reference**: https://docs.fidemark.dev/sdk/installation/
- **Workflow examples**: https://docs.fidemark.dev/guides/workflows/
- **Verify page**: https://verify.fidemark.dev
- **Landing**: https://fidemark.dev

## Versioning

Semantic versioning. Breaking surface changes bump the major; new features bump the minor; patch releases
fix bugs. The bundled deployment artifact is versioned alongside the package: pinning to a specific SDK
version pins to a specific snapshot of resolver addresses + schema UIDs, so you can audit exactly which
contracts an installed version routes to.

## Issues

This repository is a **published mirror** of the Fidemark monorepo. Source lives privately, but issues
and feature requests are tracked here, please open one if you hit a bug or want to propose an addition.

## License

Apache License 2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

This SDK is the open-source client library for the Fidemark Protocol.
The protocol contracts and all related apps and services live in a
private repository and are licensed separately under proprietary terms; 
the deployed contract bytecode is independently verifiable on-chain at the 
addresses bundled in this package.

© 2026 Vincent Cibelli (VinciDev). The "Fidemark" name, logo, and brand are
reserved by Vincent Cibelli (VinciDev) and are not granted by Apache 2.0.
Forks of this SDK are welcome under the License, but please rename them so
users can tell them apart from the official Fidemark project.
