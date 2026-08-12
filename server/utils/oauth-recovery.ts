const DEFAULT_RECOVERY_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_RECOVERY_ENTRIES = 1_000;

export type OAuthRecoveryClaimResult =
  | "claimed"
  | "already_claimed"
  | "capacity_exhausted";

export class OAuthRecoveryRegistry {
  // Process-local UX loop protection only. This is not an authorization control;
  // a restart clears it and horizontally scaled replicas each have their own map.
  private readonly claimedAtByShop = new Map<string, number>();

  constructor(
    private readonly ttlMs = DEFAULT_RECOVERY_TTL_MS,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = DEFAULT_MAX_RECOVERY_ENTRIES
  ) {}

  claimAutomaticRetry(shop: string): OAuthRecoveryClaimResult {
    const key = shop.toLowerCase();
    const now = this.now();

    this.claimedAtByShop.forEach((claimedAt, storedShop) => {
      if (now - claimedAt >= this.ttlMs) {
        this.claimedAtByShop.delete(storedShop);
      }
    });

    if (this.claimedAtByShop.has(key)) {
      return "already_claimed";
    }

    if (this.claimedAtByShop.size >= this.maxEntries) {
      return "capacity_exhausted";
    }

    this.claimedAtByShop.set(key, now);
    return "claimed";
  }

  clear(shop: string): boolean {
    return this.claimedAtByShop.delete(shop.toLowerCase());
  }
}

export const oauthRecoveryRegistry = new OAuthRecoveryRegistry();
