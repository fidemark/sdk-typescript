/**
 * ENS-verified trust layer (Layer 1 in the PRD trust model).
 *
 * The ENS network lives on Ethereum mainnet, not Base. So this module needs
 * its own provider pointed at an Ethereum mainnet RPC, separate from the
 * Fidemark SDK's main provider (which points at Base).
 *
 * Verification rule: a wallet's ENS name is "verified" iff
 *   1. The wallet has a reverse record (`address → name`).
 *   2. Forward resolution of that name (`name → address`) matches the wallet.
 *
 * This guards against spoofed reverse records, anyone can set their reverse
 * to "vitalik.eth" but only the actual ENS owner controls forward resolution.
 */

import type { Provider } from "ethers";
import { FidemarkError } from "./errors.js";

export interface VerifiedENS {
  name: string;
  address: string;
}

/**
 * Attempt to resolve a wallet address to a verified ENS name.
 * Returns `null` when the wallet has no ENS, the reverse record is missing,
 * or forward resolution doesn't round-trip.
 */
export async function resolveVerifiedENS(
  provider: Provider,
  address: string,
): Promise<VerifiedENS | null> {
  let name: string | null;
  try {
    name = await provider.lookupAddress(address);
  } catch (err) {
    throw new FidemarkError(
      "RPC_ERROR",
      `ENS lookup failed for ${address}. Is the ensProvider pointed at Ethereum mainnet?`,
      err,
    );
  }
  if (!name) return null;

  let resolved: string | null;
  try {
    resolved = await provider.resolveName(name);
  } catch (err) {
    throw new FidemarkError("RPC_ERROR", `ENS forward resolution failed for ${name}.`, err);
  }
  if (!resolved) return null;
  if (resolved.toLowerCase() !== address.toLowerCase()) {
    // Reverse record points at us but forward resolution disagrees, spoofed.
    return null;
  }

  return { name, address };
}
