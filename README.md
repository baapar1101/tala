# Shoogle Price API

Node.js JSON API for currency, gold and coin prices.

Production URL target:

`https://price.shoogle.ir`

## Features

- JSON-only API endpoints
- Currency symbol filtering
- Gold/coin symbol filtering
- Persian/Arabic digit normalization
- Short in-memory cache
- Request coalescing to avoid duplicate upstream requests
- Rate limiting
- Optional API-key protection
- Swagger UI
- OpenAPI 3.1 JSON
- Health check

## Requirements

- Node.js 20+
- npm
- A Linux server for production deployment
- DNS record for `price.shoogle.ir`

## Install

```bash
npm install
cp .env.example .env
npm start
```

The server binds to `0.0.0.0:2265` by default. Override the bind address with `HOST` and the port with `PORT`.

> Node does not automatically load `.env` in this project. On a server, use your process manager/systemd environment, or start with Node's built-in env-file support:
>
> `node --env-file=.env src/server.js`

For local development:

```bash
node --env-file=.env --watch src/server.js
```

## Provider failover

Fiat currencies use an automatic provider chain:

- Primary: `https://alanchand.com/currencies-price`
- Fallback/enrichment: `https://lake.arzdigital.com/web/api/v1/pub/fiats`
- Historical charts: `https://gw.arzdigital.com/muninn/v1/chart?id=<asset_id>&range=<range>`

If the primary currency page is unavailable or parsing fails, the API switches to ArzDigital. ArzDigital supplies a single reference `toman` price, so fallback items are marked with `price_mode: "reference"`.

When both providers work, the primary bid/ask data is kept and ArzDigital enriches it with asset IDs, market change data, chart support, and currencies that are missing from the primary table.

## Endpoints

- `GET /`
- `GET /health`
- `GET /api/v1/prices`
- `GET /api/v1/currencies`
- `GET /api/v1/currencies?symbols=USD,EUR`
- `GET /api/v1/fiats`
- `GET /api/v1/fiats?symbols=USD,EUR`
- `GET /api/v1/fiats/USD`
- `GET /api/v1/fiats/USD/chart?range=1m`
- `GET /api/v1/gold`
- `GET /api/v1/gold?symbols=GOLD_18K,EMAMI`
- `GET /openapi.json`
- `GET /docs`

## Example

```bash
curl "https://price.shoogle.ir/api/v1/currencies?symbols=USD,EUR"
```

If `API_KEYS` is enabled:

```bash
curl \
  -H "x-api-key: YOUR_KEY" \
  "https://price.shoogle.ir/api/v1/gold?symbols=GOLD_18K,EMAMI"
```

## Environment variables

```env
HOST=0.0.0.0
PORT=2265
CACHE_TTL_SECONDS=60
API_KEYS=
PUBLIC_BASE_URL=https://price.shoogle.ir
```

`API_KEYS` is optional. Example:

```env
API_KEYS=my-secret-key-1,my-secret-key-2
```

## Ubuntu deployment with systemd

Assume the app is installed at:

`/opt/shoogle-price-api`

Create `/etc/systemd/system/shoogle-price-api.service`:

```ini
[Unit]
Description=Shoogle Price API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/shoogle-price-api
EnvironmentFile=/opt/shoogle-price-api/.env
ExecStart=/usr/bin/node /opt/shoogle-price-api/src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shoogle-price-api
sudo systemctl status shoogle-price-api
```

## Nginx for price.shoogle.ir

Create:

`/etc/nginx/sites-available/price.shoogle.ir`

```nginx
server {
    listen 80;
    server_name price.shoogle.ir;

    location / {
        proxy_pass http://127.0.0.1:2265;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/price.shoogle.ir /etc/nginx/sites-enabled/price.shoogle.ir
sudo nginx -t
sudo systemctl reload nginx
```

After the DNS `A`/`AAAA` record points to your server, issue HTTPS with Certbot:

```bash
sudo certbot --nginx -d price.shoogle.ir
```

## Cloudflare note

If the domain is behind Cloudflare, you can keep the DNS record proxied. Make sure SSL mode is `Full (strict)` after the origin certificate is valid.

## Important operational notes

This project parses HTML pages. HTML structure can change without notice, so a future source-site redesign can break the parser.

The source also provides an official API. For higher reliability or commercial usage, consider switching the data layer to the official upstream API instead of HTML scraping.

Respect the source website's terms, access limits and attribution requirements.

## API documentation for agents

Give agents either:

- `https://price.shoogle.ir/openapi.json`
- `https://price.shoogle.ir/AGENTS.md` if you choose to host that file separately

The live Swagger UI is:

`https://price.shoogle.ir/docs`

## Fiat chart examples

Supported chart ranges are:

`1d`, `7d`, `1m`, `3m`, `6m`, `1y`, `all`

Examples:

```bash
curl "https://price.shoogle.ir/api/v1/fiats/USD"
curl "https://price.shoogle.ir/api/v1/fiats/USD/chart?range=1m"
curl "https://price.shoogle.ir/api/v1/fiats/EUR/chart?range=1y"
curl "https://price.shoogle.ir/api/v1/fiats/AED/chart?range=all"
```

The fiat metadata endpoint returns the complete upstream fiat fields, including ATH/ATL ranges and price-change percentages. The chart endpoint preserves raw chart rows while also providing normalized timestamp, USD and toman values.
