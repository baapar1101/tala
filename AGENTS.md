# Shoogle Price API — Agent integration guide

Shoogle provides spot-market prices and historical charts for fiat currencies, cryptocurrencies, physical gold and Iranian coins. All endpoints are HTTP GET and return JSON, except this guide and the Swagger UI.

## Deployment targets

- Self-hosted production server: `https://price.shoogle.ir`
- Vercel production: `https://mark-price.vercel.app`
- GitHub Pages frontend: `https://baapar1101.github.io/tala/`
- Live OpenAPI: `https://mark-price.vercel.app/openapi.json`
- Interactive Swagger UI: `https://mark-price.vercel.app/docs`
- Agent guide: `https://mark-price.vercel.app/AGENTS.md`

The GitHub repository contains the default self-hosted PUBLIC_BASE_URL. Vercel overrides it with its own PUBLIC_BASE_URL environment variable; do not attach the self-hosted domain to Vercel.

## Endpoint catalog

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | API metadata, base URL and route directory |
| GET | `/health` | Health and cache TTL |
| GET | `/api/v1/prices` | Combined fiat and physical gold/coin spot prices |
| GET | `/api/v1/currencies?symbols=USD,EUR` | Fiat spot prices and reference-rate fallback |
| GET | `/api/v1/fiats?symbols=USD,EUR` | ArzDigital fiat metadata |
| GET | `/api/v1/fiats/USD` | Fiat metadata by symbol |
| GET | `/api/v1/fiats/USD/chart?range=1m` | Original ArzDigital fiat chart with USD and Toman columns |
| GET | `/api/v1/crypto?symbols=BTC,USDT` | Alanchand crypto spot prices |
| GET | `/api/v1/gold?symbols=GOLD_18K,EMAMI` | Physical gold and Iranian coin spot prices |
| GET | `/api/v1/history/BTC?range=3m` | Unified normalized historical price data |
| GET | `/openapi.json` | OpenAPI 3.1 machine-readable schema |
| GET | `/AGENTS.md` | This integration guide |
| GET | `/docs` | Swagger UI |

Supported historical ranges: `1d`, `7d`, `1m`, `3m`, `6m`, `1y`, `all`. The historical endpoint returns `symbol`, `name`, `kind`, `unit`, `range`, `source`, `provider`, `count`, `summary` (first, last, min, max, change_percent) and `data` (timestamp_ms, ISO timestamp, price). All historical values are source observations, not generated points.

## Historical provider order

- **Fiat currencies:** ArzDigital fiat metadata plus Muninn chart for the verified fiat asset ID.
- **Cryptocurrencies:** GitHub `market-history` archive → ArzDigital Muninn chart with verified coin asset ID → historical dated HTML table. Currently verified coin IDs: BTC=1 and USDT=812. Historical Muninn coin price in Toman is row[1] (asset's USD price) × row[2] (Toman per USD), not row[2] alone. Never use `networks[].id` as the coin's ID.
- **Physical gold and Iranian coins:** GitHub `market-history` archive → Alanchand gold chart → ArzDigital Muninn chart for verified gold/coin ID → TGJU daily closing prices. Do not mistake digital gold tokens for physical gold or coin quotes.

### Alanchand gold charts

Request `https://alanchand.com/gold-price/{slug}`, extract the current `csrfToken` and `PHPSESSID`, then request `https://alanchand.com/get-all-data?type=golds&slug={slug}&lang=fa` with `referer`, `x-csrf-token`, and `cookie`. Secrets remain server-side. Mappings: MELTED_GOLD=abshodeh, GOLD_18K=18ayar, EMAMI=sekkeh, BAHAR=bahar, HALF_COIN=nim, QUARTER_COIN=rob, GRAM_COIN=sek.

### ArzDigital gold/coin IDs

| Symbol | Asset ID | Symbol | Asset ID |
|---|---:|---|---:|
| GOLD_18K | 27483 | GOLD_24K | 38811 |
| MELTED_GOLD | 27484 | XAU_OUNCE | 27482 |
| GOLD_18K_PREMIUM | 27485 | EMAMI | 27478 |
| BAHAR | 27480 | HALF_COIN | 27479 |
| QUARTER_COIN | 27477 | GRAM_COIN | 27481 |
| EMAMI_PREMIUM | 27490 | BAHAR_PREMIUM | 27486 |
| HALF_COIN_PREMIUM | 27488 | QUARTER_COIN_PREMIUM | 27489 |
| GRAM_COIN_PREMIUM | 27487 | | |

Muninn chart format: `https://gw.arzdigital.com/muninn/v1/chart?id={asset_id}&range={range}`. For USD-denominated asset quotes, use row[1] × row[2] to return Toman; maintain the correct asset identity. TGJU daily closing prices are published in rial and converted to Toman by dividing by ten.

## Quality and error handling

Keep `source`, `provider`, `unit`, `timestamp`, and `fetched_at` with any quoted price. Do not invent missing history or assume a requested range has full daily coverage. Return/handle `400 INVALID_RANGE`, `404 HISTORY_UNAVAILABLE` and `502 UPSTREAM_ERROR` as appropriate. Fiat fallback items may be reference prices rather than true bid/ask and are marked `price_mode: "reference"`.

The API is public when `API_KEYS` is empty. When configured, send `x-api-key` on protected API requests; health, root metadata, OpenAPI and Swagger documentation are public. Cross-origin reads are enabled by CORS. The in-memory cache and rate limit are per Vercel function instance, not distributed.

For the authoritative operation definitions and schemas, consult `/openapi.json`.
