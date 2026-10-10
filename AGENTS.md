# Shoogle Price API — Agent Guide

Base URL:

`https://price.shoogle.ir`

Machine-readable OpenAPI schema:

`https://price.shoogle.ir/openapi.json`

## Provider policy

Currency pricing uses a provider chain:

1. **Primary:** Alanchand HTML currency table.
2. **Fallback / enrichment:** ArzDigital public fiat feed.
3. If the primary provider fails or cannot be parsed, ArzDigital automatically supplies fiat prices.
4. When the primary provider works, ArzDigital is still used to add asset IDs, market metadata, chart availability, and fiat currencies missing from the primary source.

Inspect these response fields:

- `provider`
- `failover_used`
- `coverage_augmented`
- `primary_error`
- `fallback_error`
- `sources`

When an item has `price_mode: "bid_ask"`, `buy` and `sell` came from the primary provider.

When an item has `price_mode: "reference"`, ArzDigital supplied a single reference price. For compatibility, `buy` and `sell` are both set to that reference price; do not describe it as a real market bid/ask spread.

## Recommended endpoints

### All prices

`GET /api/v1/prices`

Returns currencies plus gold/coin data.

### Currency prices with automatic failover

`GET /api/v1/currencies`

Filter examples:

`GET /api/v1/currencies?symbols=USD,EUR,AED`

`GET /api/v1/currencies?symbols=USD`

### Full fiat metadata

`GET /api/v1/fiats`

This exposes the complete ArzDigital fiat objects, including fields such as:

- `id`
- `symbol`
- `usd`
- `toman`
- price-change percentages
- `last_updated_at`
- `ath_atl`
- logo/channel/topic metadata when supplied upstream

Filter:

`GET /api/v1/fiats?symbols=USD,EUR`

Single asset:

`GET /api/v1/fiats/USD`

### Historical chart

`GET /api/v1/fiats/USD/chart?range=1m`

Supported ranges:

- `1d`
- `7d`
- `1m`
- `3m`
- `6m`
- `1y`
- `all`

The response preserves upstream `meta` low/high information and returns normalized chart rows:

```json
{
  "timestamp_ms": 1791345600000,
  "timestamp": "2026-10-07T04:00:00.000Z",
  "usd": 1,
  "toman": 269000,
  "auxiliary": 0.000011879111062612742,
  "raw": [1791345600000, 1, "269000", "0.000011879111062612742308"]
}
```

The fourth chart column is deliberately named `auxiliary` because the public upstream response does not provide a field name for that column. Use `raw` when exact upstream preservation matters.

### Gold and coins

`GET /api/v1/gold`

Optional filter:

`GET /api/v1/gold?symbols=GOLD_18K,EMAMI`

ArzDigital fiat failover applies to **fiat currencies**, not to the gold/coin endpoint.

## Authentication

By default the project is public.

If the server administrator sets `API_KEYS`, send:

`x-api-key: YOUR_KEY`

## Agent behavior

1. Prefer normalized numeric fields over `raw`.
2. Check `unit` before calculations.
3. Check `price_mode` before describing buy/sell pricing.
4. If `failover_used: true`, explicitly treat currency prices as fallback reference data.
5. Use `asset_id` or the fiat symbol to request chart history.
6. Use `last_updated_at` for ArzDigital freshness and `fetched_at` for API fetch time.
7. Do not interpret `cache: "HIT"` as stale; it only indicates reuse inside the configured short cache window.
8. If every currency provider fails, the currency endpoint returns HTTP 502; do not invent a price.

## Example: USD price

Request:

`GET https://price.shoogle.ir/api/v1/currencies?symbols=USD`

Typical primary-provider item:

```json
{
  "symbol": "USD",
  "name": "دلار آمریکا",
  "buy": 268500,
  "sell": 269000,
  "unit": "toman",
  "source_provider": "alanchand",
  "price_mode": "bid_ask",
  "asset_id": 24201,
  "chart_available": true
}
```

Typical fallback item:

```json
{
  "symbol": "USD",
  "source_symbol": "USD",
  "name": "دلار",
  "buy": 269000,
  "sell": 269000,
  "reference_price": 269000,
  "price_mode": "reference",
  "unit": "toman",
  "source_provider": "arzdigital",
  "asset_id": 24201,
  "chart_available": true
}
```

## Example: chart

`GET https://price.shoogle.ir/api/v1/fiats/USD/chart?range=1m`

For the longest available range:

`GET https://price.shoogle.ir/api/v1/fiats/USD/chart?range=all`


## Historical price API

For supported fiat currencies use `GET /api/v1/history/{symbol}?range={range}`.

Supported ranges: `1d`, `7d` (week, default), `1m` (month), `3m`, `6m`, `1y` (year), `all`.

Examples:

```bash
curl "https://mark-price.vercel.app/api/v1/history/USD?range=7d"
curl "https://mark-price.vercel.app/api/v1/history/EUR?range=1m"
curl "https://mark-price.vercel.app/api/v1/history/USD?range=1y"
```

The JSON response includes `symbol`, `name`, `range`, `unit` (`toman`), `provider`, `source`, `fetched_at`, `count`, `summary`, and `data`. Data points have `timestamp_ms`, ISO `timestamp`, and numeric `price`. Summary fields are `first`, `last`, `min`, `max`, and `change_percent`.

Error statuses: `400 INVALID_RANGE` for an unsupported range, `404 HISTORY_UNAVAILABLE` for symbols without fiat history (including gold and coins), and `502 UPSTREAM_ERROR` for provider failures. Never invent missing historical prices. The existing `/api/v1/fiats/{symbol}/chart?range=...` endpoint remains available.

Deployment domains are separate: self-hosted `https://price.shoogle.ir` and Vercel `https://mark-price.vercel.app`. Do not attach the self-hosted domain to Vercel.

## Cryptocurrency and gold/coin history

`GET /api/v1/crypto` supplies current cryptocurrency prices from Alanchand. `GET /api/v1/history/{symbol}?range=7d` also supports symbols that have real hourly snapshots in `data/market-history.json`. The GitHub Actions collector `.github/workflows/market-history.yml` fetches current cryptocurrency and gold/coin quotes hourly and commits observations to the archive. Historical observations begin when the workflow first successfully runs; requesting 1 month or 1 year does not imply earlier data exists. A missing series returns 404 HISTORY_UNAVAILABLE. For gold ounce instruments check response `unit`, which can be `usd` instead of `toman`. Preserve original observation timestamps; never synthesize missing candles or backfill from single current quotes.

## ArzDigital historical fallback

For supported crypto symbols (e.g. BTC), if the GitHub snapshot archive lacks observations, the history endpoint attempts the real historical table at `https://arzdigital.com/coins/{slug}/historical-data/`. Only verified dated prices are returned; provider metadata identifies the fallback. The `arzdigital.com/gold-coins/` category does not establish an equivalent price series for physical Iranian gold, coins, or melted gold. These continue using verified Alanchand archive observations; if missing, return HISTORY_UNAVAILABLE rather than mixing crypto gold tokens with physical-gold prices.

## TGJU physical gold daily-history fallback

For physical GOLD_18K, EMAMI, BAHAR, HALF_COIN, QUARTER_COIN, GRAM_COIN and MELTED_GOLD, if hourly observations are unavailable, the backend attempts dated daily closing prices from `tgju.org/profile/{profile}/history`, dividing the published rial quotes by ten to return toman. Dates must come from the same row as the closing price, and the response identifies `tgju-daily-history` as provider. This is historical daily closing data, not intraday candles. For cryptocurrencies, the ArzDigital dated table parser must link each quote to the row's Gregorian date.

## Alanchand gold chart source

For physical gold and coins, the backend attempts the original Alanchand chart endpoint after checking its snapshot archive. It requests `/gold-price/{slug}` to acquire a fresh `csrfToken` and `PHPSESSID` cookie, then makes a GET request to `/get-all-data?type=golds&slug={slug}&lang=fa` with `referer`, `x-csrf-token`, and the session cookie. Mapped slugs: MELTED_GOLD=abshodeh, GOLD_18K=18ayar, EMAMI=sekkeh, BAHAR=bahar, HALF_COIN=nim, QUARTER_COIN=rob, GRAM_COIN=sek. The chart response must contain explicit dated price points or it is rejected. The TGJU daily series remains a fallback; the response's `provider` and `source` report the actually selected provider. CSRF and session cookies are never sent to clients or stored in GitHub.

## ArzDigital chart IDs for cryptocurrencies

On a missing local archive series, crypto history tries the `https://gw.arzdigital.com/muninn/v1/chart?id={id}&range={range}` JSON chart before HTML table fallback. The supplied coin asset mappings are BTC=1 and USDT=812. These are top-level coin IDs, not `networks[].id` or `native_asset_id`. The source returns row arrays with Unix milliseconds and a USD coin quote in index 1 and a Toman-per-USD reference in index 2; the Toman coin price is index 1 multiplied by index 2, and only valid points are accepted. Keep provider attribution as `arzdigital-coin-chart`. Other coins require their verified top-level coin asset ID before adding a mapping.
