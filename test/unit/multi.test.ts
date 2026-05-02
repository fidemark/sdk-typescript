import { describe, it, expect } from "vitest";
import { Wallet, verifyTypedData } from "ethers";
import {
  buildMultiPartyClaim,
  multiPartyClaimDigest,
  signMultiPartyClaim,
  hashContent,
  MULTI_PARTY_TYPES,
  type NetworkConfig,
} from "../../src/index.js";

const network: NetworkConfig = {
  name: "synthetic",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  contracts: {
    eas: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    schemaRegistry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    resolver: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    multiResolver: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
  },
  schemas: {
    human: "0xaf65a9a663e21c28a6e94560ef7501cd286e13b098f05143fbf160fac4f1660c",
    ai: "0xaf4119a0d3fbf9b5c14190fc2d4c5c34167b4e5276af2f00e4eb369155478869",
    multi: "0x1111111111111111111111111111111111111111111111111111111111111111",
  },
};

const networkWithoutMulti: NetworkConfig = {
  ...network,
  contracts: { ...network.contracts, multiResolver: undefined },
};

const KEY_A = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEY_B = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const ALICE_ADDR = new Wallet(KEY_A).address;
const BOB_ADDR = new Wallet(KEY_B).address;

describe("buildMultiPartyClaim", () => {
  it("hashes content via SHA-256 and applies a default timestamp", () => {
    const claim = buildMultiPartyClaim({
      content: "shared text",
      contentType: "text/plain",
      attesters: [ALICE_ADDR, BOB_ADDR],
    });
    expect(claim.contentHash).toBe(hashContent("shared text"));
    expect(claim.contentType).toBe("text/plain");
    expect(claim.attesters).toEqual([ALICE_ADDR, BOB_ADDR]);
    expect(typeof claim.createdAt).toBe("number");
    expect(claim.createdAt).toBeGreaterThan(0);
  });

  it("respects an explicit createdAt", () => {
    const claim = buildMultiPartyClaim({
      content: "x",
      contentType: "text/plain",
      createdAt: 1700000000,
      attesters: [ALICE_ADDR, BOB_ADDR],
    });
    expect(claim.createdAt).toBe(1700000000);
  });
});

describe("multiPartyClaimDigest", () => {
  it("is deterministic for the same claim + network", () => {
    const claim = buildMultiPartyClaim({
      content: "deterministic",
      contentType: "text/plain",
      createdAt: 1700000000,
      attesters: [ALICE_ADDR, BOB_ADDR],
    });
    const a = multiPartyClaimDigest(claim, network);
    const b = multiPartyClaimDigest(claim, network);
    expect(a).toBe(b);
  });

  it("changes when content, contentType, createdAt, attesters, or network differ", () => {
    const base = buildMultiPartyClaim({
      content: "base",
      contentType: "text/plain",
      createdAt: 1700000000,
      attesters: [ALICE_ADDR, BOB_ADDR],
    });
    const baseDigest = multiPartyClaimDigest(base, network);

    expect(multiPartyClaimDigest({ ...base, contentHash: hashContent("other") }, network)).not.toBe(
      baseDigest,
    );
    expect(multiPartyClaimDigest({ ...base, contentType: "text/markdown" }, network)).not.toBe(
      baseDigest,
    );
    expect(multiPartyClaimDigest({ ...base, createdAt: 1700000001 }, network)).not.toBe(baseDigest);

    // Swapping the attesters list (different addresses) must change the digest:
    // this is the binding that prevents a slip from being reused with a
    // different co-signer set.
    expect(
      multiPartyClaimDigest({ ...base, attesters: [ALICE_ADDR] }, network),
    ).not.toBe(baseDigest);
    // Even reordering the same set must change the digest, EIP-712 array
    // hashing is order-sensitive, and the resolver iterates by index.
    expect(
      multiPartyClaimDigest({ ...base, attesters: [BOB_ADDR, ALICE_ADDR] }, network),
    ).not.toBe(baseDigest);

    const differentChain: NetworkConfig = { ...network, chainId: 8453 };
    expect(multiPartyClaimDigest(base, differentChain)).not.toBe(baseDigest);
  });

  it("throws when the network has no multiResolver address", () => {
    const claim = buildMultiPartyClaim({
      content: "x",
      contentType: "text/plain",
      createdAt: 1,
      attesters: [ALICE_ADDR, BOB_ADDR],
    });
    expect(() => multiPartyClaimDigest(claim, networkWithoutMulti)).toThrow(/multiResolver/);
  });
});

describe("signMultiPartyClaim", () => {
  it("produces a signature that recovers to the signer's address", async () => {
    const alice = new Wallet(KEY_A);
    const claim = buildMultiPartyClaim({
      content: "co-authored",
      contentType: "text/article",
      createdAt: 1700000000,
      attesters: [ALICE_ADDR, BOB_ADDR],
    });

    const slip = await signMultiPartyClaim(alice, claim, network);

    expect(slip.signer.toLowerCase()).toBe((await alice.getAddress()).toLowerCase());
    expect(slip.signature).toMatch(/^0x[0-9a-f]{130}$/);

    // Recover via ethers' standalone verifier, same domain, same types.
    const recovered = verifyTypedData(
      {
        name: "Fidemark MultiParty",
        version: "1",
        chainId: network.chainId,
        verifyingContract: network.contracts.multiResolver,
      },
      MULTI_PARTY_TYPES,
      claim,
      slip.signature,
    );
    expect(recovered.toLowerCase()).toBe(slip.signer.toLowerCase());
  });

  it("two distinct signers produce distinct slips for the same claim", async () => {
    const alice = new Wallet(KEY_A);
    const bob = new Wallet(KEY_B);
    const claim = buildMultiPartyClaim({
      content: "co-authored",
      contentType: "text/article",
      createdAt: 1700000000,
      attesters: [ALICE_ADDR, BOB_ADDR],
    });

    const slipA = await signMultiPartyClaim(alice, claim, network);
    const slipB = await signMultiPartyClaim(bob, claim, network);

    expect(slipA.signer).not.toBe(slipB.signer);
    expect(slipA.signature).not.toBe(slipB.signature);
  });

  it("throws when the network has no multiResolver address", async () => {
    const alice = new Wallet(KEY_A);
    const claim = buildMultiPartyClaim({
      content: "x",
      contentType: "text/plain",
      createdAt: 1,
      attesters: [ALICE_ADDR, BOB_ADDR],
    });
    await expect(signMultiPartyClaim(alice, claim, networkWithoutMulti)).rejects.toThrow(
      /multiResolver/,
    );
  });
});
