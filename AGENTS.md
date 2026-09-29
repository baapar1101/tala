# Eldery Price API — Agent Guide

Base URL:

`https://price.eldery.ir`

Machine-readable OpenAPI schema:

`https://price.eldery.ir/openapi.json`

## Recommended endpoints

### All prices

`GET /api/v1/prices`

Use when the agent needs both currency and gold/coin data in one request.

### Currencies

`GET /api/v1/currencies`

Optional filter:

`GET /api/v1/currencies?symbols=USD,EUR,AED`

Common symbols:

- `USD` — دلار آمریکا
- `EUR` — یورو
- `AED` — درهم
- `TRY` — لیر ترکیه
- `GBP` — پوند انگلیس
- `CAD` — دلار کانادا
- `AUD` — دلار استرالیا
- `CHF` — فرانک سوئیس
- `CNY` — یوان چین

Currency `buy` and `sell` values are normalized numbers in **toman**.

### Gold and coins

`GET /api/v1/gold`

Optional filter:

`GET /api/v1/gold?symbols=GOLD_18K,EMAMI`

Common symbols:

- `GOLD_18K` — گرم طلای ۱۸ عیار
- `MELTED_GOLD` — آبشده / مثقال
- `EMAMI` — سکه امامی
- `BAHAR` — سکه بهار آزادی
- `HALF_COIN` — نیم سکه
- `QUARTER_COIN` — ربع سکه
- `GRAM_COIN` — سکه گرمی
- `XAU_OUNCE` — انس طلا
- `XAG_OUNCE` — انس نقره

Iranian gold/coin items use `unit: "toman"`.
International ounce items use `unit: "usd"`.

## Authentication

By default the project is public.

If the server administrator sets `API_KEYS`, send:

`x-api-key: YOUR_KEY`

## Agent behavior

1. Prefer normalized numeric fields (`buy`, `sell`, `price`, `change_percent`, `bubble_percent`) over `raw`.
2. Check `unit` before doing calculations.
3. Use `source_updated_at` to report the upstream update label.
4. Use `fetched_at` as the API fetch timestamp.
5. Do not interpret `cache: "HIT"` as stale data; it only means the upstream fetch was reused within the configured short cache window.
6. If the API returns HTTP 502, treat upstream price data as temporarily unavailable and do not invent a price.

## Example

Request:

`GET https://price.eldery.ir/api/v1/currencies?symbols=USD,EUR`

Typical response shape:

```json
{
  "ok": true,
  "type": "currencies",
  "count": 2,
  "source": "https://alanchand.com/currencies-price",
  "source_updated_at": "۱۳:۲۵ سه‌شنبه ۷ مهر ۱۴۰۵",
  "fetched_at": "2026-09-29T10:00:00.000Z",
  "cache": "HIT",
  "data": [
    {
      "symbol": "USD",
      "name": "دلار آمریکا",
      "buy": 250650,
      "sell": 253200,
      "per_usd": null,
      "unit": "toman",
      "raw": {
        "buy": "۲۵۰,۶۵۰",
        "sell": "۲۵۳,۲۰۰",
        "per_usd": "-"
      }
    }
  ]
}
```