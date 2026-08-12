const DEFAULT_RECOVERY_TTL_MS = 10 * 60 * 1000;

export class OAuthRecoveryRegistry {
  // Process-local UX loop protection only. This is not an authorization control;
  // a restart clears it and horizontally scaled replicas each have their own map.
  private readonly claimedAtByShop = new Map<string, number>();

  constructor(
    private readonly ttlMs = DEFAULT_RECOVERY_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  claimAutomaticRetry(shop: string): boolean {
    const key = shop.toLowerCase();
    const now = this.now();

    this.claimedAtByShop.forEach((claimedAt, storedShop) => {
      if (now - claimedAt >= this.ttlMs) {
        this.claimedAtByShop.delete(storedShop);
      }
    });

    if (this.claimedAtByShop.has(key)) {
      return false;
    }

    this.claimedAtByShop.set(key, now);
    return true;
  }

  clear(shop: string): boolean {
    return this.claimedAtByShop.delete(shop.toLowerCase());
  }
}

export const oauthRecoveryRegistry = new OAuthRecoveryRegistry();
