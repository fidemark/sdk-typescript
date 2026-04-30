import { describe, it, expect, beforeAll } from "vitest";
import { JsonRpcProvider, NonceManager, Wallet, parseEther, type Signer } from "ethers";
import { Fidemark } from "../../src/fidemark.js";
import { loadLocalNetwork } from "../../src/local.js";
import { hashContent } from "../../src/hashing.js";
import { buildMultiPartyClaim, signMultiPartyClaim } from "../../src/multi.js";
import {
  externalNullifierFor as popExternalNullifier,
  signalHashFor as popSignalHash,
} from "../../src/pop.js";
import { Contract } from "ethers";

// Hardhat default account #0, funded with 10000 ETH on startup.
const HARDHAT_FUNDER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const RUN = process.env.FIDEMARK_RUN_INTEGRATION === "1";
const describeIntegration = RUN ? describe : describe.skip;

describeIntegration("Fidemark SDK ↔ local devnet", () => {
  let provider: JsonRpcProvider;
  let funder: Signer;

  /**
   * Issue a freshly-generated wallet funded from account 0, wrapped in a
   * NonceManager so consecutive txs from the same test don't race the
   * provider's getTransactionCount caching. Random keypair per test means
   * tests never collide on nonce, even across runs against the same
   * persistent devnet.
   */
  async function freshWallet(): Promise<Signer & { address: string }> {
    const base = Wallet.createRandom().connect(provider);
    const tx = await funder.sendTransaction({ to: base.address, value: parseEther("1") });
    await tx.wait();
    const managed = new NonceManager(base) as Signer & { address: string };
    managed.address = base.address;
    return managed;
  }

  beforeAll(async () => {
    const network = loadLocalNetwork();
    provider = new JsonRpcProvider(network.rpcUrl, undefined, { batchMaxCount: 1 });
    funder = new NonceManager(new Wallet(HARDHAT_FUNDER_KEY, provider));
  });

  it("attests human content and verifies it", async () => {
    const wallet = await freshWallet();
    const fidemark = new Fidemark({ network: "local", signer: wallet });

    const content = "An essay about provenance, written by hand.";
    const result = await fidemark.attestHuman({ content, contentType: "text/article" });

    expect(result.uid).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const att = await fidemark.verify(result.uid);
    expect(att.type).toBe("human");
    expect(att.contentHash).toBe(hashContent(content));
    expect(att.attester.toLowerCase()).toBe(wallet.address.toLowerCase());

    expect(att.human?.contentType).toBe("text/article");
    expect(att.human?.proofMethod).toBe("wallet-signed");
    expect(att.revoked).toBe(false);
  });

  it("attests AI content with a prompt and verifies model metadata", async () => {
    const fidemark = new Fidemark({ network: "local", signer: await freshWallet() });

    const result = await fidemark.attestAI({
      content: "The AI wrote: hello world.",
      modelId: "claude-sonnet-4-20250514",
      provider: "anthropic",
      prompt: "say hello",
      parameters: { temperature: 0.7, maxTokens: 100 },
    });

    const att = await fidemark.verify(result.uid);
    expect(att.type).toBe("ai");
    expect(att.ai?.modelId).toBe("claude-sonnet-4-20250514");
    expect(att.ai?.provider).toBe("anthropic");
    expect(att.ai?.parameters).toBe('{"temperature":0.7,"maxTokens":100}');
    expect(att.ai?.promptHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects Human attestation with mismatched creator", async () => {
    const fidemark = new Fidemark({ network: "local", signer: await freshWallet() });
    await expect(
      fidemark.attestHuman({
        content: "x",
        contentType: "text/article",
        creator: "0x000000000000000000000000000000000000dEaD",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_REJECTED" });
  });

  it("rejects Human attestation with disallowed proofMethod", async () => {
    const fidemark = new Fidemark({ network: "local", signer: await freshWallet() });
    await expect(
      fidemark.attestHuman({
        content: "x",
        contentType: "text/article",
        proofMethod: "tee-attested",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_REJECTED" });
  });

  it("attester can revoke; non-attester cannot", async () => {
    const aliceWallet = await freshWallet();
    const bobWallet = await freshWallet();
    const alice = new Fidemark({ network: "local", signer: aliceWallet });
    const bob = new Fidemark({ network: "local", signer: bobWallet });

    const { uid } = await alice.attestHuman({ content: "to-revoke", contentType: "text/article" });

    await expect(bob.revoke(uid)).rejects.toBeDefined();

    const r = await alice.revoke(uid);
    expect(r.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const att = await alice.verify(uid);
    expect(att.revoked).toBe(true);
    expect(att.revokedAt).toBeGreaterThan(0);
  });

  it("verify of unknown UID throws ATTESTATION_NOT_FOUND", async () => {
    const fidemark = new Fidemark({ network: "local", signer: await freshWallet() });
    const fakeUID = "0x" + "ff".repeat(32);
    await expect(fidemark.verify(fakeUID)).rejects.toMatchObject({ code: "ATTESTATION_NOT_FOUND" });
  });

  it("composes a referenced attestation chain (human → AI → human)", async () => {
    const aliceWallet = await freshWallet();
    const aliceSecond = await freshWallet(); // separate wallet for the second human attestation
    const alice = new Fidemark({ network: "local", signer: aliceWallet });
    const aliceReviewer = new Fidemark({ network: "local", signer: aliceSecond });

    // Step 1: human authors the original article.
    const original = await alice.attestHuman({
      content: "The original article.",
      contentType: "text/article",
    });

    // Step 2: AI translates it, referencing the original.
    const translated = await alice.attestAI({
      content: "L'article original (traduit).",
      modelId: "claude-sonnet-4-20250514",
      provider: "anthropic",
      prompt: "translate to french",
      refUID: original.uid,
    });

    // Step 3: another human reviews the translation, referencing it.
    const reviewed = await aliceReviewer.attestHuman({
      content: "Reviewed translation: looks good.",
      contentType: "text/review",
      refUID: translated.uid,
    });

    // verifyChain on the leaf returns root → ... → leaf.
    const chain = await aliceReviewer.verifyChain(reviewed.uid);
    expect(chain.length).toBe(3);
    expect(chain[0]?.uid).toBe(original.uid);
    expect(chain[1]?.uid).toBe(translated.uid);
    expect(chain[2]?.uid).toBe(reviewed.uid);

    // The root has no parent.
    expect(chain[0]?.refUID).toBe("0x" + "0".repeat(64));
    // Each non-root link points to the previous.
    expect(chain[1]?.refUID).toBe(chain[0]?.uid);
    expect(chain[2]?.refUID).toBe(chain[1]?.uid);
  });

  it("verifyByHash returns all attestations sharing a content hash", async () => {
    const aliceWallet = await freshWallet();
    const bobWallet = await freshWallet();
    const alice = new Fidemark({ network: "local", signer: aliceWallet });
    const bob = new Fidemark({ network: "local", signer: bobWallet });

    const sharedContent = "Two people independently certify this same thing.";

    const aliceAtt = await alice.attestHuman({ content: sharedContent, contentType: "text/article" });
    const bobAtt = await bob.attestHuman({ content: sharedContent, contentType: "text/article" });

    const matches = await alice.verifyByHash(hashContent(sharedContent));
    const uids = matches.map((m) => m.uid);
    expect(uids).toContain(aliceAtt.uid);
    expect(uids).toContain(bobAtt.uid);
    expect(matches.every((m) => m.type === "human")).toBe(true);
  });

  it("verifyByHash respects the type filter", async () => {
    const wallet = await freshWallet();
    const fidemark = new Fidemark({ network: "local", signer: wallet });

    const content = "single-attester two-types";
    const human = await fidemark.attestHuman({ content, contentType: "text/article" });
    const ai = await fidemark.attestAI({
      content,
      modelId: "claude-sonnet-4-20250514",
      provider: "anthropic",
    });

    const onlyHuman = await fidemark.verifyByHash(hashContent(content), { type: "human" });
    expect(onlyHuman.map((m) => m.uid)).toEqual([human.uid]);

    const onlyAI = await fidemark.verifyByHash(hashContent(content), { type: "ai" });
    expect(onlyAI.map((m) => m.uid)).toEqual([ai.uid]);
  });

  it("attestBatch lands mixed Human + AI items in one tx", async () => {
    const fidemark = new Fidemark({ network: "local", signer: await freshWallet() });
    const result = await fidemark.attestBatch([
      { type: "human", content: "batch human 1", contentType: "text/article" },
      { type: "ai", content: "batch ai 1", modelId: "claude-sonnet-4-20250514", provider: "anthropic" },
      { type: "human", content: "batch human 2", contentType: "text/article" },
    ]);
    expect(result.uids).toHaveLength(3);
    expect(result.uids.every((u) => /^0x[0-9a-f]{64}$/.test(u))).toBe(true);
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    // All in the same tx hash means it was indeed a multicall.
    expect(result.verifyUrls).toHaveLength(3);

    // Spot-check: input order preserved across schema-grouped multicall.
    const att0 = await fidemark.verify(result.uids[0]!);
    const att1 = await fidemark.verify(result.uids[1]!);
    const att2 = await fidemark.verify(result.uids[2]!);
    expect(att0.type).toBe("human");
    expect(att1.type).toBe("ai");
    expect(att2.type).toBe("human");
  });

  it("attestBatch rejects when any item violates resolver rules", async () => {
    const fidemark = new Fidemark({ network: "local", signer: await freshWallet() });
    await expect(
      fidemark.attestBatch([
        { type: "human", content: "valid", contentType: "text/article" },
        { type: "human", content: "bad", contentType: "text/article", proofMethod: "tee-attested" },
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_REJECTED" });
  });

  it("verifyChain on a root attestation returns just the root", async () => {
    const fidemark = new Fidemark({ network: "local", signer: await freshWallet() });
    const root = await fidemark.attestHuman({
      content: "stand-alone",
      contentType: "text/article",
    });
    const chain = await fidemark.verifyChain(root.uid);
    expect(chain.length).toBe(1);
    expect(chain[0]?.uid).toBe(root.uid);
  });

  it("multi-party: 3 co-signers + coordinator submit produces a verifiable attestation", async () => {
    const network = loadLocalNetwork();
    const aliceSigner = await freshWallet();
    const bobSigner = await freshWallet();
    const carolSigner = await freshWallet();
    const coordinatorSigner = await freshWallet();

    const claim = buildMultiPartyClaim({
      content: "Co-signed claim by alice, bob, carol.",
      contentType: "text/article",
    });

    const slips = await Promise.all([
      signMultiPartyClaim(aliceSigner, claim, network),
      signMultiPartyClaim(bobSigner, claim, network),
      signMultiPartyClaim(carolSigner, claim, network),
    ]);

    const coordinator = new Fidemark({ network: "local", signer: coordinatorSigner });
    const result = await coordinator.attestMultiParty({ claim, slips });

    expect(result.uid).toMatch(/^0x[0-9a-f]{64}$/);

    const att = await coordinator.verify(result.uid);
    expect(att.type).toBe("multi");
    expect(att.contentHash).toBe(claim.contentHash);
    expect(att.attester.toLowerCase()).toBe(coordinatorSigner.address.toLowerCase());
    expect(att.multi?.attesters.map((a) => a.toLowerCase())).toEqual([
      aliceSigner.address.toLowerCase(),
      bobSigner.address.toLowerCase(),
      carolSigner.address.toLowerCase(),
    ]);
    expect(att.multi?.signatures).toHaveLength(3);
    expect(att.multi?.proofMethod).toBe("multi-party");
    expect(att.multi?.contentType).toBe("text/article");
  });

  it("multi-party: rejects forged signature when slip's signer doesn't match the recovered address", async () => {
    const network = loadLocalNetwork();
    const aliceSigner = await freshWallet();
    const bobSigner = await freshWallet();

    const claim = buildMultiPartyClaim({ content: "forge attempt", contentType: "text/plain" });
    const aliceSlip = await signMultiPartyClaim(aliceSigner, claim, network);

    // Lie: claim bob is the second co-signer but use alice's signature.
    const forgedSlip = { signer: bobSigner.address, signature: aliceSlip.signature };

    const coordinator = new Fidemark({ network: "local", signer: await freshWallet() });
    await expect(
      coordinator.attestMultiParty({ claim, slips: [aliceSlip, forgedSlip] }),
    ).rejects.toMatchObject({ code: "VALIDATION_REJECTED" });
  });

  it("multi-party: SDK rejects fewer than 2 slips before any chain call", async () => {
    const network = loadLocalNetwork();
    const aliceSigner = await freshWallet();
    const claim = buildMultiPartyClaim({ content: "solo attempt", contentType: "text/plain" });
    const aliceSlip = await signMultiPartyClaim(aliceSigner, claim, network);

    const coordinator = new Fidemark({ network: "local", signer: await freshWallet() });
    await expect(
      coordinator.attestMultiParty({ claim, slips: [aliceSlip] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("multi-party: anyone can be the coordinator, the truth is in the signatures", async () => {
    const network = loadLocalNetwork();
    const aliceSigner = await freshWallet();
    const bobSigner = await freshWallet();

    const claim = buildMultiPartyClaim({ content: "stranger submits", contentType: "text/plain" });
    const slips = await Promise.all([
      signMultiPartyClaim(aliceSigner, claim, network),
      signMultiPartyClaim(bobSigner, claim, network),
    ]);

    // A wallet that has no relationship to alice or bob submits the attestation.
    const stranger = new Fidemark({ network: "local", signer: await freshWallet() });
    const result = await stranger.attestMultiParty({ claim, slips });

    const att = await stranger.verify(result.uid);
    expect(att.multi?.attesters.map((a) => a.toLowerCase())).toEqual([
      aliceSigner.address.toLowerCase(),
      bobSigner.address.toLowerCase(),
    ]);
  });

  it("publishOffchain: alice signs offline, bob publishes on-chain, attester remains alice", async () => {
    const aliceWallet = await freshWallet();
    const bobWallet = await freshWallet();

    const alice = new Fidemark({ network: "local", signer: aliceWallet });
    const envelope = await alice.attestHumanOffchain(
      { content: "Promote me later", contentType: "text/article" },
      { signWithDelegated: true },
    );
    expect(envelope.delegated).toBeDefined();

    const bob = new Fidemark({ network: "local", signer: bobWallet });
    const result = await bob.publishOffchain(envelope);
    expect(result.uid).toMatch(/^0x[0-9a-f]{64}$/);
    // On-chain UID differs from off-chain UID (chain assigns its own time).
    expect(result.uid).not.toBe(envelope.uid);

    const att = await bob.verify(result.uid);
    expect(att.type).toBe("human");
    expect(att.attester.toLowerCase()).toBe(aliceWallet.address.toLowerCase());
    expect(att.contentHash).toBe(hashContent("Promote me later"));
    expect(att.human?.creator.toLowerCase()).toBe(aliceWallet.address.toLowerCase());
    expect(att.human?.proofMethod).toBe("wallet-signed");
  });

  it("publishOffchain: AI envelope round-trip", async () => {
    const aliceWallet = await freshWallet();
    const bobWallet = await freshWallet();

    const alice = new Fidemark({ network: "local", signer: aliceWallet });
    const envelope = await alice.attestAIOffchain(
      {
        content: "AI output to bring on-chain",
        modelId: "claude-sonnet-4-20250514",
        provider: "anthropic",
        prompt: "produce something",
      },
      { signWithDelegated: true },
    );

    const bob = new Fidemark({ network: "local", signer: bobWallet });
    const result = await bob.publishOffchain(envelope);

    const att = await bob.verify(result.uid);
    expect(att.type).toBe("ai");
    expect(att.attester.toLowerCase()).toBe(aliceWallet.address.toLowerCase());
    expect(att.ai?.modelId).toBe("claude-sonnet-4-20250514");
    expect(att.ai?.provider).toBe("anthropic");
  });

  it("publishOffchain: rejects an envelope without delegated signature", async () => {
    const wallet = await freshWallet();
    const fidemark = new Fidemark({ network: "local", signer: wallet });
    // Default sign, no delegated payload.
    const envelope = await fidemark.attestHumanOffchain({
      content: "no delegation here",
      contentType: "text/plain",
    });
    expect(envelope.delegated).toBeUndefined();

    await expect(fidemark.publishOffchain(envelope)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("publishOffchain: each delegated signature is single-use (nonce bumps)", async () => {
    const aliceWallet = await freshWallet();
    const bob = new Fidemark({ network: "local", signer: await freshWallet() });

    const alice = new Fidemark({ network: "local", signer: aliceWallet });
    const envelope = await alice.attestHumanOffchain(
      { content: "single-use", contentType: "text/plain" },
      { signWithDelegated: true },
    );

    // First publish succeeds.
    const first = await bob.publishOffchain(envelope);
    expect(first.uid).toMatch(/^0x[0-9a-f]{64}$/);

    // Second publish of the same envelope should fail (nonce already consumed).
    await expect(bob.publishOffchain(envelope)).rejects.toBeDefined();
  });

  it("attestHumanWithPoP: registers a proof in the mock and attests successfully", async () => {
    const network = loadLocalNetwork();
    if (!network.contracts.worldIdVerifier || !network.worldId) {
      throw new Error("local network missing World ID config");
    }

    const aliceWallet = await freshWallet();
    const alice = new Fidemark({ network: "local", signer: aliceWallet });

    // Unique content per run so externalNullifier is fresh; otherwise rerunning
    // the test against a persistent devnet trips on NullifierAlreadyUsed.
    const content = `Verified-human article body ${Date.now()}-${Math.random()}`;
    const contentHash = hashContent(content);
    const root = BigInt(Math.floor(Math.random() * 1e15)) + 1n;
    const nullifierHash = BigInt(Math.floor(Math.random() * 1e15)) + 1n;
    const proof: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
      11n, 12n, 13n, 14n, 15n, 16n, 17n, 18n,
    ];
    const extNul = popExternalNullifier(network.worldId.appId, contentHash);
    const signalHash = popSignalHash(contentHash, aliceWallet.address);

    // Register the proof in the MockWorldID so the resolver's verifyProof call passes.
    const mockAbi = [
      "function registerProof(uint256 root,uint256 groupId,uint256 signalHash,uint256 nullifierHash,uint256 externalNullifier,uint256[8] proof,bool willSucceed) external",
    ];
    const mock = new Contract(network.contracts.worldIdVerifier, mockAbi, aliceWallet);
    await (
      await mock.registerProof(
        root,
        BigInt(network.worldId.groupId),
        signalHash,
        nullifierHash,
        extNul,
        proof,
        true,
      )
    ).wait();

    const result = await alice.attestHumanWithPoP({
      content,
      contentType: "text/article",
      worldIdProof: { root, nullifierHash, proof },
    });

    expect(result.uid).toMatch(/^0x[0-9a-f]{64}$/);

    const att = await alice.verify(result.uid);
    expect(att.type).toBe("pop");
    expect(att.contentHash).toBe(contentHash);
    expect(att.attester.toLowerCase()).toBe(aliceWallet.address.toLowerCase());
    expect(att.pop?.proofMethod).toBe("pop-verified-worldid");
    expect(att.pop?.contentType).toBe("text/article");
    expect(att.pop?.creator.toLowerCase()).toBe(aliceWallet.address.toLowerCase());
    expect(att.pop?.root).toBe(root.toString());
    expect(att.pop?.nullifierHash).toBe(nullifierHash.toString());
    expect(att.pop?.proof).toHaveLength(8);
  });

  it("attestHumanWithPoP: rejects when the same nullifier is replayed", async () => {
    const network = loadLocalNetwork();
    if (!network.contracts.worldIdVerifier || !network.worldId) {
      throw new Error("local network missing World ID config");
    }

    const aliceWallet = await freshWallet();
    const alice = new Fidemark({ network: "local", signer: aliceWallet });

    const content = `replay-target ${Date.now()}-${Math.random()}`;
    const contentHash = hashContent(content);
    const root = BigInt(Math.floor(Math.random() * 1e15)) + 1n;
    const nullifierHash = BigInt(Math.floor(Math.random() * 1e15)) + 1n;
    const proof: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
      21n, 22n, 23n, 24n, 25n, 26n, 27n, 28n,
    ];
    const extNul = popExternalNullifier(network.worldId.appId, contentHash);
    const signalHash = popSignalHash(contentHash, aliceWallet.address);

    const mockAbi = [
      "function registerProof(uint256 root,uint256 groupId,uint256 signalHash,uint256 nullifierHash,uint256 externalNullifier,uint256[8] proof,bool willSucceed) external",
    ];
    const mock = new Contract(network.contracts.worldIdVerifier, mockAbi, aliceWallet);
    await (
      await mock.registerProof(root, BigInt(network.worldId.groupId), signalHash, nullifierHash, extNul, proof, true)
    ).wait();

    const first = await alice.attestHumanWithPoP({
      content,
      contentType: "text/plain",
      worldIdProof: { root, nullifierHash, proof },
    });
    expect(first.uid).toMatch(/^0x[0-9a-f]{64}$/);

    await expect(
      alice.attestHumanWithPoP({
        content,
        contentType: "text/plain",
        worldIdProof: { root, nullifierHash, proof },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_REJECTED" });
  });

  it("attestHumanWithPoP: rejects an unregistered (forged) proof", async () => {
    const aliceWallet = await freshWallet();
    const alice = new Fidemark({ network: "local", signer: aliceWallet });

    await expect(
      alice.attestHumanWithPoP({
        content: "forged-pop",
        contentType: "text/plain",
        worldIdProof: {
          root: 1n,
          nullifierHash: 2n,
          proof: [3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n],
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_REJECTED" });
  });
});
