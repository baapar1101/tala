# Eldery Price API

Node.js JSON API for currency, gold and coin prices.

Production URL target:

`https://price.eldery.ir`

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
- DNS record for `price.eldery.ir`

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

## Endpoints

- `GET /`
- `GET /health`
- `GET /api/v1/prices`
- `GET /api/v1/currencies`
- `GET /api/v1/currencies?symbols=USD,EUR`
- `GET /api/v1/gold`
- `GET /api/v1/gold?symbols=GOLD_18K,EMAMI`
- `GET /openapi.json`
- `GET /docs`

## Example

```bash
curl "https://price.eldery.ir/api/v1/currencies?symbols=USD,EUR"
```

If `API_KEYS` is enabled:

```bash
curl \
  -H "x-api-key: YOUR_KEY" \
  "https://price.eldery.ir/api/v1/gold?symbols=GOLD_18K,EMAMI"
```

## Environment variables

```env
HOST=0.0.0.0
PORT=2265
CACHE_TTL_SECONDS=60
API_KEYS=
PUBLIC_BASE_URL=https://price.eldery.ir
```

`API_KEYS` is optional. Example:

```env
API_KEYS=my-secret-key-1,my-secret-key-2
```

## Ubuntu deployment with systemd

Assume the app is installed at:

`/opt/eldery-price-api`

Create `/etc/systemd/system/eldery-price-api.service`:

```ini
[Unit]
Description=Eldery Price API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/eldery-price-api
EnvironmentFile=/opt/eldery-price-api/.env
ExecStart=/usr/bin/node /opt/eldery-price-api/src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eldery-price-api
sudo systemctl status eldery-price-api
```

## Nginx for price.eldery.ir

Create:

`/etc/nginx/sites-available/price.eldery.ir`

```nginx
server {
    listen 80;
    server_name price.eldery.ir;

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
sudo ln -s /etc/nginx/sites-available/price.eldery.ir /etc/nginx/sites-enabled/price.eldery.ir
sudo nginx -t
sudo systemctl reload nginx
```

After the DNS `A`/`AAAA` record points to your server, issue HTTPS with Certbot:

```bash
sudo certbot --nginx -d price.eldery.ir
```

## Cloudflare note

If the domain is behind Cloudflare, you can keep the DNS record proxied. Make sure SSL mode is `Full (strict)` after the origin certificate is valid.

## Important operational notes

This project parses HTML pages. HTML structure can change without notice, so a future source-site redesign can break the parser.

The source also provides an official API. For higher reliability or commercial usage, consider switching the data layer to the official upstream API instead of HTML scraping.

Respect the source website's terms, access limits and attribution requirements.

## API documentation for agents

Give agents either:

- `https://price.eldery.ir/openapi.json`
- `https://price.eldery.ir/AGENTS.md` if you choose to host that file separately

The live Swagger UI is:

`https://price.eldery.ir/docs`
