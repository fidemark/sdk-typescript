import { describe, it, expect, vi } from "vitest";
import { resolveVerifiedENS } from "../../src/ens.js";

function fakeProvider(reverse: Record<string, string | null>, forward: Record<string, string | null>) {
  return {
    lookupAddress: vi.fn(async (addr: string) => reverse[addr.toLowerCase()] ?? null),
    resolveName: vi.fn(async (name: string) => forward[name] ?? null),
  } as unknown as Parameters<typeof resolveVerifiedENS>[0];
}

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";

describe("resolveVerifiedENS", () => {
  it("returns the name when reverse + forward round-trip", async () => {
    const provider = fakeProvider(
      { [ALICE.toLowerCase()]: "alice.eth" },
      { "alice.eth": ALICE },
    );
    const out = await resolveVerifiedENS(provider, ALICE);
    expect(out).toEqual({ name: "alice.eth", address: ALICE });
  });

  it("returns null when reverse record is missing", async () => {
    const provider = fakeProvider({}, {});
    const out = await resolveVerifiedENS(provider, ALICE);
    expect(out).toBeNull();
  });

  it("returns null when forward resolution fails (spoof guard)", async () => {
    // Bob set his reverse to alice.eth, but forward resolution of alice.eth points at Alice.
    const provider = fakeProvider(
      { [BOB.toLowerCase()]: "alice.eth" },
      { "alice.eth": ALICE },
    );
    const out = await resolveVerifiedENS(provider, BOB);
    expect(out).toBeNull();
  });

  it("returns null when forward resolution returns no address", async () => {
    const provider = fakeProvider(
      { [ALICE.toLowerCase()]: "ghost.eth" },
      {}, // ghost.eth has no record
    );
    const out = await resolveVerifiedENS(provider, ALICE);
    expect(out).toBeNull();
  });

  it("is case-insensitive on the address comparison", async () => {
    const provider = fakeProvider(
      { [ALICE.toLowerCase()]: "alice.eth" },
      { "alice.eth": ALICE.toUpperCase() }, // forward returns uppercase
    );
    const out = await resolveVerifiedENS(provider, ALICE);
    expect(out).not.toBeNull();
    expect(out?.name).toBe("alice.eth");
  });
});
