import { Injectable, Logger } from "@nestjs/common";
import { getCoingeckoIds } from "@polypay/shared";

/**
 * Polypay-Zama price service.
 *
 * Simplified port of Polypay's original PriceService: hits the public
 * CoinGecko free endpoint for the token IDs declared in @polypay/shared
 * (ETH + USDC + ZEN today) and caches the result in-memory for one minute
 * to stay well under the public rate limit. Drops Polypay's weekly-ZEN
 * persistence, scheduler, and axios-retry — none of those are needed for
 * the Zama dashboard's single use case (showing fiat balance hints).
 */

export type TokenPrices = Record<string, number>;

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";
const CACHE_TTL_MS = 60_000;

@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);
  private cache: { fetchedAt: number; prices: TokenPrices } | null = null;

  async getPrices(): Promise<TokenPrices> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.prices;
    }
    return this.fetchPrices();
  }

  private async fetchPrices(): Promise<TokenPrices> {
    const ids = getCoingeckoIds().join(",");
    const url = `${COINGECKO_URL}?ids=${ids}&vs_currencies=usd`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      const data = (await res.json()) as Record<string, { usd?: number }>;
      const prices: TokenPrices = {};
      for (const [id, priceData] of Object.entries(data)) {
        if (typeof priceData?.usd === "number") prices[id] = priceData.usd;
      }
      this.cache = { fetchedAt: Date.now(), prices };
      this.logger.log(`prices: ${JSON.stringify(prices)}`);
      return prices;
    } catch (err: any) {
      this.logger.warn(`CoinGecko fetch failed: ${err?.message ?? err}`);
      // Stale-while-error: return whatever we last cached.
      if (this.cache) return this.cache.prices;
      return {};
    }
  }
}
