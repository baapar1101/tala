import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { rateLimit } from "express-rate-limit";
import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 2265);
const CACHE_TTL_SECONDS = Math.max(10, Number(process.env.CACHE_TTL_SECONDS || 60));
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://price.shoogle.ir";
const API_KEYS = (process.env.API_KEYS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const SOURCE = {
  currencies: "https://alanchand.com/currencies-price",
  gold: "https://alanchand.com/gold-price",
  arzFiats: "https://lake.arzdigital.com/web/api/v1/pub/fiats",
  arzChart: "https://gw.arzdigital.com/muninn/v1/chart"
};

const CHART_RANGES = new Set(["1d", "7d", "1m", "3m", "6m", "1y", "all"]);
const ARZ_UNIT_MULTIPLIERS = {
  IQD: 100,
  AMD: 100,
  JPY: 100
};
const ARZ_COMPAT_SYMBOLS = {
  IQD: "IQD100",
  AMD: "AMD100",
  JPY: "JPY100"
};

const CURRENCY_CODES = new Map(Object.entries({
  "دلار آمریکا": "USD",
  "یورو": "EUR",
  "درهم": "AED",
  "لیر ترکیه": "TRY",
  "پوند انگلیس": "GBP",
  "یوان چین": "CNY",
  "دلار کانادا": "CAD",
  "دلار استرالیا": "AUD",
  "روبل روسیه": "RUB",
  "صد دینار عراق": "IQD100",
  "رینگیت مالزی": "MYR",
  "لاری گرجستان": "GEL",
  "منات آذربایجان": "AZN",
  "صد درام ارمنستان": "AMD100",
  "بات تایلند": "THB",
  "ریال عمان": "OMR",
  "روپیه هند": "INR",
  "روپیه پاکستان": "PKR",
  "صد ین ژاپن": "JPY100",
  "ریال عربستان": "SAR",
  "افغانی": "AFN",
  "کرون سوئد": "SEK",
  "فرانک سوئیس": "CHF",
  "ریال قطر": "QAR",
  "صد وون کره جنوبی": "KRW100",
  "کرون نروژ": "NOK",
  "دلار نیوزلند": "NZD",
  "دلار سنگاپور": "SGD",
  "دلار هنگ کنگ": "HKD",
  "دینار کویت": "KWD",
  "کرون دانمارک": "DKK",
  "دینار بحرین": "BHD",
  "سامانی تاجیکستان": "TJS",
  "منات ترکمنستان": "TMT",
  "سوم قرقیزستان": "KGS",
  "صد پوند سوریه": "SYP100",
  "رئال برزیل": "BRL",
  "پزو آرژانتین": "ARS",
  "حواله دلار آمریکا": "USD_REMIT",
  "دلار استانبول": "USD_IST",
  "دلار سلیمانیه": "USD_SUL",
  "دلار هرات": "USD_HERAT",
  "حواله یورو": "EUR_REMIT",
  "یورو استانبول": "EUR_IST"
}));

const GOLD_CODES = [
  [/آبشده|مثقال/i, "MELTED_GOLD"],
  [/18\s*عیار|۱۸\s*عیار/i, "GOLD_18K"],
  [/سکه امامی|طرح جدید/i, "EMAMI"],
  [/سکه بهار آزادی/i, "BAHAR"],
  [/نیم سکه/i, "HALF_COIN"],
  [/ربع سکه/i, "QUARTER_COIN"],
  [/سکه گرمی/i, "GRAM_COIN"],
  [/انس طلا/i, "XAU_OUNCE"],
  [/انس نقره/i, "XAG_OUNCE"],
  [/انس پلاتین/i, "XPT_OUNCE"],
  [/انس پالادیوم/i, "XPD_OUNCE"],
  [/انس رودیوم/i, "RHODIUM_OUNCE"]
];

const cache = new Map();
const inflight = new Map();

function jsonError(res, status, code, message, details = undefined) {
  return res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  });
}

function normalizeDigits(input = "") {
  return String(input)
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/\u066C/g, ",")
    .replace(/\u066B/g, ".");
}

function cleanText(input = "") {
  return String(input).replace(/\s+/g, " ").trim();
}

function numberFromText(input) {
  if (input == null) return null;
  const normalized = normalizeDigits(input)
    .replace(/,/g, "")
    .replace(/−/g, "-")
    .trim();

  const m = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function allNumbersFromText(input) {
  const normalized = normalizeDigits(input)
    .replace(/,/g, "")
    .replace(/−/g, "-");
  return [...normalized.matchAll(/-?\d+(?:\.\d+)?/g)]
    .map((m) => Number(m[0]))
    .filter(Number.isFinite);
}

function parsePercent(input) {
  const normalized = normalizeDigits(input).replace(/−/g, "-");
  const m = normalized.match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

function getGoldCode(name) {
  for (const [pattern, code] of GOLD_CODES) {
    if (pattern.test(name)) return code;
  }
  return "OTHER";
}

function getCurrencyCode(name, index) {
  return CURRENCY_CODES.get(name) || `CUR_${String(index + 1).padStart(3, "0")}`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "user-agent": "ShooglePriceAPI/1.1 (+https://price.shoogle.ir)",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Upstream returned HTTP ${response.status}`);
  }

  return await response.text();
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Upstream returned HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data || data.status !== "success") {
    throw new Error("Upstream JSON response did not report success.");
  }

  return data;
}

function extractSourceUpdated($) {
  const bodyText = cleanText($("body").text());
  const match = bodyText.match(/آخرین\s*بروز\s*رسانی\s*[:：]\s*(.{1,80}?)(?=نام ارز|قیمت|$)/);
  return match ? cleanText(match[1]) : null;
}

function extractTables($) {
  const tables = [];

  $("table").each((_, table) => {
    const rows = [];
    $(table).find("tr").each((__, tr) => {
      const cells = [];
      $(tr).find("th,td").each((___, td) => {
        cells.push(cleanText($(td).text()));
      });
      if (cells.length) rows.push(cells);
    });
    if (rows.length) tables.push(rows);
  });

  return tables;
}

function isCurrencyHeader(row) {
  const s = row.join(" ");
  return /نام ارز/.test(s) && /خرید/.test(s) && /فروش/.test(s);
}

function isGoldHeader(row) {
  const s = row.join(" ");
  return /قیمت/.test(s) && (/حباب/.test(s) || /قیمت واقعی/.test(s));
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseCurrencies(html) {
  const $ = cheerio.load(html);
  const tables = extractTables($);
  const items = [];

  for (const table of tables) {
    let headerIndex = table.findIndex(isCurrencyHeader);
    if (headerIndex < 0) continue;

    for (const row of table.slice(headerIndex + 1)) {
      if (!row || row.length < 3 || isCurrencyHeader(row)) continue;

      const name = cleanText(row[0]);
      if (!name) continue;

      const buy = numberFromText(row[1]);
      const sell = numberFromText(row[2]);
      const perDollar = row[3] ? numberFromText(row[3]) : null;

      if (buy == null && sell == null) continue;

      items.push({
        symbol: getCurrencyCode(name, items.length),
        name,
        buy,
        sell,
        per_usd: perDollar,
        unit: "toman",
        raw: {
          buy: row[1] ?? null,
          sell: row[2] ?? null,
          per_usd: row[3] ?? null
        }
      });
    }
  }

  return {
    source_updated_at: extractSourceUpdated($),
    items: uniqueBy(items, (x) => `${x.symbol}:${x.name}`)
  };
}

function parseGold(html) {
  const $ = cheerio.load(html);
  const tables = extractTables($);
  const items = [];

  for (const table of tables) {
    const headerIndex = table.findIndex(isGoldHeader);
    if (headerIndex < 0) continue;

    for (const row of table.slice(headerIndex + 1)) {
      if (!row || row.length < 2 || isGoldHeader(row)) continue;

      const name = cleanText(row[0]);
      if (!name) continue;

      const priceCell = row[1] ?? "";
      const realCell = row[2] ?? "";
      const bubbleCell = row[3] ?? "";

      const priceNumbers = allNumbersFromText(priceCell);
      const isUsd = /\$|دلار/.test(priceCell) || /انس/.test(name);

      const price = priceNumbers.length ? priceNumbers[0] : null;
      const changePercent = parsePercent(priceCell);
      const realPrice = /(^|\s)-(\s|$)/.test(realCell) ? null : numberFromText(realCell);

      const bubbleNumbers = allNumbersFromText(bubbleCell);
      const bubbleAmount = bubbleNumbers.length ? bubbleNumbers[0] : null;
      const bubblePercent = parsePercent(bubbleCell);

      if (price == null) continue;

      items.push({
        symbol: getGoldCode(name),
        name,
        price,
        change_percent: changePercent,
        real_price: realPrice,
        bubble_amount: bubbleAmount,
        bubble_percent: bubblePercent,
        unit: isUsd ? "usd" : "toman",
        raw: {
          price: priceCell || null,
          real_price: realCell || null,
          bubble: bubbleCell || null
        }
      });
    }
  }

  return {
    source_updated_at: extractSourceUpdated($),
    items: uniqueBy(items, (x) => `${x.symbol}:${x.name}`)
  };
}

async function cached(key, fn) {
  const now = Date.now();
  const current = cache.get(key);

  if (current && now - current.createdAt < CACHE_TTL_SECONDS * 1000) {
    return { ...current.value, cache: "HIT" };
  }

  if (inflight.has(key)) {
    const value = await inflight.get(key);
    return { ...value, cache: "COALESCED" };
  }

  const promise = (async () => {
    const value = await fn();
    cache.set(key, { value, createdAt: Date.now() });
    return value;
  })();

  inflight.set(key, promise);

  try {
    const value = await promise;
    return { ...value, cache: "MISS" };
  } finally {
    inflight.delete(key);
  }
}

function arzCompatSymbol(symbol) {
  return ARZ_COMPAT_SYMBOLS[symbol] || symbol;
}

function arzMultiplier(symbol) {
  return ARZ_UNIT_MULTIPLIERS[symbol] || 1;
}

function normalizeArzFiat(item) {
  const multiplier = arzMultiplier(item.symbol);
  const compatSymbol = arzCompatSymbol(item.symbol);
  const referencePrice = Number(item.toman) * multiplier;

  return {
    symbol: compatSymbol,
    source_symbol: item.symbol,
    name: multiplier === 100 ? `100 ${item.fa_name || item.name}` : (item.fa_name || item.name),
    buy: referencePrice,
    sell: referencePrice,
    reference_price: referencePrice,
    price_mode: "reference",
    unit: "toman",
    source_provider: "arzdigital",
    asset_id: item.id,
    chart_available: true,
    last_updated_at: item.last_updated_at || null,
    market: {
      usd: item.usd ?? null,
      toman: item.toman ?? null,
      price_change_percent_1h: item.price_change_percent_1h ?? null,
      price_change_percent_24h: item.price_change_percent_24h ?? null,
      price_change_percent_7d: item.price_change_percent_7d ?? null,
      price_change_percent_30d: item.price_change_percent_30d ?? null,
      price_change_percent_3m: item.price_change_percent_3m ?? null,
      price_change_percent_1y: item.price_change_percent_1y ?? null,
      price_change_percent_ytd: item.price_change_percent_ytd ?? null,
      price_change_percent_irt_1h: item.price_change_percent_irt_1h ?? null,
      price_change_percent_irt_24h: item.price_change_percent_irt_24h ?? null,
      price_change_percent_irt_7d: item.price_change_percent_irt_7d ?? null,
      price_change_percent_irt_30d: item.price_change_percent_irt_30d ?? null,
      price_change_percent_irt_3m: item.price_change_percent_irt_3m ?? null,
      price_change_percent_irt_1y: item.price_change_percent_irt_1y ?? null,
      price_change_percent_irt_ytd: item.price_change_percent_irt_ytd ?? null
    },
    raw: item
  };
}

async function getArzFiats() {
  return cached("arz-fiats", async () => {
    const payload = await fetchJson(SOURCE.arzFiats);
    const rawItems = Array.isArray(payload.data) ? payload.data : [];

    if (!rawItems.length) {
      throw new Error("ArzDigital fiat list is empty.");
    }

    return {
      provider: "arzdigital",
      source: SOURCE.arzFiats,
      fetched_at: new Date().toISOString(),
      count: rawItems.length,
      raw_items: rawItems,
      items: rawItems.map(normalizeArzFiat)
    };
  });
}

function enrichPrimaryWithArz(primaryItem, fallbackMap) {
  const fallback = fallbackMap.get(primaryItem.symbol);
  if (!fallback) {
    return {
      ...primaryItem,
      source_provider: "alanchand",
      price_mode: "bid_ask",
      chart_available: false
    };
  }

  return {
    ...primaryItem,
    source_provider: "alanchand",
    price_mode: "bid_ask",
    asset_id: fallback.asset_id,
    chart_available: true,
    last_updated_at: fallback.last_updated_at,
    market: fallback.market
  };
}

async function getCurrencies() {
  return cached("currencies", async () => {
    let primary = null;
    let fallback = null;
    let primaryError = null;
    let fallbackError = null;

    try {
      const html = await fetchHtml(SOURCE.currencies);
      const parsed = parseCurrencies(html);

      if (!parsed.items.length) {
        throw new Error("Currency table was not found or could not be parsed.");
      }

      primary = {
        source: SOURCE.currencies,
        source_updated_at: parsed.source_updated_at,
        items: parsed.items
      };
    } catch (error) {
      primaryError = error;
    }

    try {
      fallback = await getArzFiats();
    } catch (error) {
      fallbackError = error;
    }

    if (!primary && !fallback) {
      throw new Error(
        `All currency providers failed. primary=${primaryError?.message || "unknown"}; fallback=${fallbackError?.message || "unknown"}`
      );
    }

    const fallbackItems = fallback?.items || [];
    const fallbackMap = new Map(fallbackItems.map((item) => [item.symbol, item]));
    const merged = new Map();

    for (const item of fallbackItems) {
      merged.set(item.symbol, item);
    }

    if (primary) {
      for (const item of primary.items) {
        merged.set(item.symbol, enrichPrimaryWithArz(item, fallbackMap));
      }
    }

    const items = [...merged.values()];
    const primarySymbols = new Set(primary?.items.map((item) => item.symbol) || []);
    const fallbackOnlyCount = items.filter(
      (item) => item.source_provider === "arzdigital" && !primarySymbols.has(item.symbol)
    ).length;

    return {
      provider: primary ? (fallback ? "alanchand+arzdigital" : "alanchand") : "arzdigital",
      failover_used: !primary,
      coverage_augmented: Boolean(primary && fallbackOnlyCount > 0),
      fallback_only_count: fallbackOnlyCount,
      primary_error: primaryError?.message || null,
      fallback_error: fallbackError?.message || null,
      source: primary?.source || fallback?.source,
      sources: [
        ...(primary ? [{ provider: "alanchand", url: primary.source, role: "primary" }] : []),
        ...(fallback ? [{ provider: "arzdigital", url: fallback.source, role: primary ? "fallback+enrichment" : "failover" }] : [])
      ],
      source_updated_at: primary?.source_updated_at || null,
      fetched_at: new Date().toISOString(),
      items
    };
  });
}

async function getArzChartByAssetId(assetId, range) {
  if (!CHART_RANGES.has(range)) {
    throw new Error(`Unsupported chart range: ${range}`);
  }

  return cached(`arz-chart:${assetId}:${range}`, async () => {
    const url = `${SOURCE.arzChart}?id=${encodeURIComponent(assetId)}&range=${encodeURIComponent(range)}`;
    const payload = await fetchJson(url);
    const rows = Array.isArray(payload.data) ? payload.data : [];

    return {
      provider: "arzdigital",
      source: url,
      range,
      asset_id: Number(assetId),
      fetched_at: new Date().toISOString(),
      meta: payload.meta || {},
      data: rows.map((row) => ({
        timestamp_ms: Number(row[0]),
        timestamp: new Date(Number(row[0])).toISOString(),
        usd: row[1] == null ? null : Number(row[1]),
        toman: row[2] == null ? null : Number(row[2]),
        auxiliary: row[3] == null ? null : Number(row[3]),
        raw: row
      }))
    };
  });
}

async function findArzFiatBySymbol(symbol) {
  const wanted = String(symbol || "").trim().toUpperCase();
  const fiats = await getArzFiats();
  return fiats.raw_items.find((item) => {
    const raw = String(item.symbol || "").toUpperCase();
    const compat = arzCompatSymbol(raw);
    return raw === wanted || compat === wanted;
  }) || null;
}

async function getGold() {
  return cached("gold", async () => {
    const html = await fetchHtml(SOURCE.gold);
    const parsed = parseGold(html);

    if (!parsed.items.length) {
      throw new Error("Gold table was not found or could not be parsed.");
    }

    return {
      source: SOURCE.gold,
      source_updated_at: parsed.source_updated_at,
      fetched_at: new Date().toISOString(),
      items: parsed.items
    };
  });
}

function requestedSymbols(req) {
  const value = typeof req.query.symbols === "string" ? req.query.symbols : "";
  return value
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
}

function filterSymbols(items, symbols) {
  if (!symbols.length) return items;
  const wanted = new Set(symbols);
  return items.filter((x) => wanted.has(String(x.symbol).toUpperCase()));
}

function apiKeyMiddleware(req, res, next) {
  if (!API_KEYS.length) return next();

  // Keep documentation and health public.
  if (
    req.path === "/" ||
    req.path === "/health" ||
    req.path === "/openapi.json" ||
    req.path.startsWith("/docs")
  ) {
    return next();
  }

  const key = req.get("x-api-key");
  if (!key || !API_KEYS.includes(key)) {
    return jsonError(res, 401, "UNAUTHORIZED", "A valid x-api-key header is required.");
  }

  next();
}

const app = express();
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: "64kb" }));

app.use(rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

app.use(apiKeyMiddleware);

const openapiPath = path.join(__dirname, "..", "openapi.json");
const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf8"));
openapi.servers = [{ url: PUBLIC_BASE_URL }];

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Shoogle Price API",
    version: "1.1.0",
    base_url: PUBLIC_BASE_URL,
    endpoints: {
      prices: "/api/v1/prices",
      currencies: "/api/v1/currencies",
      fiats: "/api/v1/fiats",
      fiat: "/api/v1/fiats/:symbol",
      fiat_chart: "/api/v1/fiats/:symbol/chart?range=1m",
      history: "/api/v1/history/:symbol?range=7d",
      gold: "/api/v1/gold",
      crypto: "/api/v1/crypto",
      health: "/health",
      openapi: "/openapi.json",
      agent_guide: "/AGENTS.md",
      docs: "/docs"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    time: new Date().toISOString(),
    cache_ttl_seconds: CACHE_TTL_SECONDS
  });
});

app.get("/openapi.json", (req, res) => {
  res.json(openapi);
});

app.get("/AGENTS.md", (req, res) => {
  const agentsPath = path.join(__dirname, "..", "AGENTS.md");
  res.type("text/markdown; charset=utf-8").send(fs.readFileSync(agentsPath, "utf8"));
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, {
  explorer: true,
  customSiteTitle: "Shoogle Price API Docs"
}));

app.get("/api/v1/currencies", async (req, res) => {
  try {
    const data = await getCurrencies();
    const symbols = requestedSymbols(req);
    const items = filterSymbols(data.items, symbols);

    res.json({
      ok: true,
      type: "currencies",
      count: items.length,
      provider: data.provider,
      failover_used: data.failover_used,
      coverage_augmented: data.coverage_augmented,
      fallback_only_count: data.fallback_only_count,
      primary_error: data.primary_error,
      fallback_error: data.fallback_error,
      source: data.source,
      sources: data.sources,
      source_updated_at: data.source_updated_at,
      fetched_at: data.fetched_at,
      cache: data.cache,
      data: items
    });
  } catch (error) {
    console.error(error);
    jsonError(res, 502, "UPSTREAM_ERROR", "Could not fetch currency prices from any provider.");
  }
});

app.get("/api/v1/fiats", async (req, res) => {
  try {
    const fiats = await getArzFiats();
    const symbols = requestedSymbols(req);
    const wanted = new Set(symbols);
    const data = symbols.length
      ? fiats.raw_items.filter((item) => wanted.has(String(item.symbol).toUpperCase()) || wanted.has(arzCompatSymbol(String(item.symbol).toUpperCase())))
      : fiats.raw_items;

    res.json({
      ok: true,
      type: "fiats",
      provider: fiats.provider,
      source: fiats.source,
      count: data.length,
      fetched_at: fiats.fetched_at,
      cache: fiats.cache,
      supported_chart_ranges: [...CHART_RANGES],
      data
    });
  } catch (error) {
    console.error(error);
    jsonError(res, 502, "UPSTREAM_ERROR", "Could not fetch ArzDigital fiat metadata.");
  }
});

app.get("/api/v1/fiats/:symbol", async (req, res) => {
  try {
    const item = await findArzFiatBySymbol(req.params.symbol);
    if (!item) {
      return jsonError(res, 404, "FIAT_NOT_FOUND", "Fiat symbol not found.");
    }

    res.json({
      ok: true,
      provider: "arzdigital",
      source: SOURCE.arzFiats,
      supported_chart_ranges: [...CHART_RANGES],
      data: item
    });
  } catch (error) {
    console.error(error);
    jsonError(res, 502, "UPSTREAM_ERROR", "Could not fetch fiat metadata.");
  }
});

app.get("/api/v1/fiats/:symbol/chart", async (req, res) => {
  try {
    const range = String(req.query.range || "1m");
    if (!CHART_RANGES.has(range)) {
      return jsonError(
        res,
        400,
        "INVALID_RANGE",
        `range must be one of: ${[...CHART_RANGES].join(", ")}`
      );
    }

    const item = await findArzFiatBySymbol(req.params.symbol);
    if (!item) {
      return jsonError(res, 404, "FIAT_NOT_FOUND", "Fiat symbol not found.");
    }

    const chart = await getArzChartByAssetId(item.id, range);
    res.json({
      ok: true,
      symbol: item.symbol,
      name: item.fa_name || item.name,
      ...chart
    });
  } catch (error) {
    console.error(error);
    jsonError(res, 502, "UPSTREAM_ERROR", "Could not fetch fiat chart.");
  }
});

// Historical prices are available from ArzDigital for supported fiat symbols.
// Do not fabricate gold/coin history: the current gold provider only exposes spot prices.

// Historic snapshots are collected by GitHub Actions from published market quotes.
// This source contains real observations only; it does not reconstruct prior years.
async function getArchivedHistory(symbol, range) {
  const url = "https://raw.githubusercontent.com/baapar1101/tala/market-history/data/market-history.json";
  const response = await fetchWithTimeout(url, {headers: {accept:"application/json"}});
  if (!response.ok) throw new Error("Archive unavailable: HTTP " + response.status);
  const archive = await response.json();
  if (!Array.isArray(archive.points)) throw new Error("Archive is malformed");
  const days = {"1d":1,"7d":7,"1m":30,"3m":90,"6m":180,"1y":365,"all":370}[range];
  const cutoff = Date.now() - days*86400000;
  const data = archive.points.flatMap(snapshot => {
    const timestamp_ms = Date.parse(snapshot.at);
    if (!Number.isFinite(timestamp_ms) || timestamp_ms < cutoff) return [];
    const item = snapshot.prices?.find(p=>p.symbol===symbol);
    if (!item || !Number.isFinite(item.price) || item.price<=0) return [];
    return [{timestamp_ms,timestamp:snapshot.at,price:item.price}];
  }).sort((a,b)=>a.timestamp_ms-b.timestamp_ms);
  const last = archive.points.at(-1)?.prices?.find(p=>p.symbol===symbol);
  return {data,kind:last?.kind||null,name:last?.name||symbol,unit:last?.unit||"toman",
    source:url,provider:"alanchand-archived-snapshots"};
}


const CRYPTO_SLUGS = {BTC:"bitcoin",ETH:"ethereum",USDT:"tether",BNB:"binance-coin",SOL:"solana",XRP:"ripple",ADA:"cardano",DOGE:"dogecoin",TRX:"tron",DOT:"polkadot",LTC:"litecoin",LINK:"chainlink",AVAX:"avalanche",SHIB:"shiba-inu",BCH:"bitcoin-cash",UNI:"uniswap",XLM:"stellar",ATOM:"cosmos",ETC:"ethereum-classic",FIL:"filecoin",APT:"aptos",ARB:"arbitrum",OP:"optimism",SUI:"sui"};
const EN_MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
async function getArzdigitalCryptoHistory(symbol, range) {
  const slug=CRYPTO_SLUGS[symbol];
  if (!slug) return null;
  const source="https://arzdigital.com/coins/"+slug+"/historical-data/";
  const html=await fetchHtml(source);
  const $=cheerio.load(html);
  const data=[];
  $("tr").each((_,tr)=>{
    const cells=$(tr).find("td").map((_,td)=>cleanText($(td).text())).get();
    if(cells.length<2)return;
    const raw=cells.join(" ");
    const match=raw.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(20\d{2})/);
    if(!match)return;
    const timestamp_ms=Date.UTC(Number(match[3]),EN_MONTHS.indexOf(match[1]),Number(match[2]));
    if(!Number.isFinite(timestamp_ms))return;
    // The toman quote must appear in this date row, never in a navigation/header row.
    const tomanToken=cells.find(x=>/\d[\d,\.\s]*\s*ت(?:ومان)?(?:\s|$)/.test(normalizeDigits(x)));
    const quote=tomanToken?.match(/([\d,]+(?:\.\d+)?)\s*ت(?:ومان)?/);
    const price=quote?Number(quote[1].replace(/,/g,"")):null;
    if(!(price>0))return;
    data.push({timestamp_ms,timestamp:new Date(timestamp_ms).toISOString(),price});
  });
  const days={"1d":1,"7d":7,"1m":30,"3m":90,"6m":180,"1y":365,"all":36500}[range];
  const cutoff=Date.now()-days*86400000;
  const dedup=[...new Map(data.filter(p=>p.timestamp_ms>=cutoff).map(p=>[p.timestamp_ms,p])).values()].sort((a,b)=>a.timestamp_ms-b.timestamp_ms);
  if(!dedup.length)return null;
  return {data:dedup,source,provider:"arzdigital-historical-table",kind:"crypto",unit:"toman",name:symbol};
}

const GOLD_HISTORY_PROFILES = {
 GOLD_18K:"geram18", EMAMI:"sekee", BAHAR:"sekeb", HALF_COIN:"nim",
 QUARTER_COIN:"rob", GRAM_COIN:"gerami", MELTED_GOLD:"abshodeh"
};
async function getTgjuGoldHistory(symbol,range){
 const profile=GOLD_HISTORY_PROFILES[symbol];
 if(!profile)return null;
 const source="https://www.tgju.org/profile/"+profile+"/history";
 const html=await fetchHtml(source);
 const $=cheerio.load(html);const entries=[];
 $("tr").each((_,tr)=>{
  const cells=$(tr).find("td").map((_,td)=>cleanText($(td).text())).get();
  if(cells.length<8)return;
  const day=cells.find(v=>/^20\d{2}\/\d{2}\/\d{2}$/.test(normalizeDigits(v)));
  if(!day)return;
  const timestamp_ms=Date.parse(day.replaceAll("/","-")+"T00:00:00Z");
  // TGJU table: opening, low, high, closing (RIAL), change, percent, Gregorian, Jalali.
  const rial=numberFromText(cells[3]);
  if(!Number.isFinite(timestamp_ms)||!(rial>0))return;
  const price=rial/10;
  entries.push({timestamp_ms,timestamp:new Date(timestamp_ms).toISOString(),price});
 });
 const days={"1d":1,"7d":7,"1m":30,"3m":90,"6m":180,"1y":365,"all":36500}[range];
 const cutoff=Date.now()-days*86400000;
 const data=[...new Map(entries.filter(p=>p.timestamp_ms>=cutoff).map(p=>[p.timestamp_ms,p])).values()].sort((a,b)=>a.timestamp_ms-b.timestamp_ms);
 if(!data.length)return null;
 return {data,source,provider:"tgju-daily-history",name:symbol,kind:"gold",unit:"toman"};
}

app.get("/api/v1/history/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").trim().toUpperCase();
  const range = String(req.query.range || "7d");
  if (!CHART_RANGES.has(range)) {
    return jsonError(res, 400, "INVALID_RANGE", "Supported ranges: 1d, 7d, 1m, 3m, 6m, 1y, all");
  }
  try {
    const fiat = await findArzFiatBySymbol(symbol);
    let points, origin, name, unit, kind;
    if (fiat) {
      const chart = await getArzChartByAssetId(fiat.id, range);
      points = chart.data.filter(p => Number.isFinite(p.timestamp_ms) && Number.isFinite(p.toman) && p.toman > 0)
        .sort((a,b)=>a.timestamp_ms-b.timestamp_ms)
        .map(p=>({timestamp_ms:p.timestamp_ms,timestamp:p.timestamp,price:p.toman}));
      origin = chart; name = fiat.fa_name || fiat.name || symbol; unit = "toman"; kind = "currency";
    } else {
      const failures=[];
      try { origin=await getArchivedHistory(symbol,range); } catch(e){ failures.push("archive: "+e.message); }
      if(!origin?.data?.length) {
        try { origin=await getArzdigitalCryptoHistory(symbol,range); }
        catch(e){ failures.push("arzdigital: "+e.message); }
      }
      if(!origin?.data?.length) {
        try { origin=await getTgjuGoldHistory(symbol,range); }
        catch(e){ failures.push("tgju: "+e.message); }
      }
      if(!origin?.data?.length) return jsonError(res,404,"HISTORY_UNAVAILABLE",
        "No verified historical observations available from archive or ArzDigital for this asset and range.",
        {providers_checked:["github-archive","arzdigital-crypto-history","tgju-gold-history"],failures});
      points = origin.data; name = origin.name; unit = origin.unit; kind = origin.kind;
    }
    const first = points[0]?.price ?? null;
    const last = points[points.length - 1]?.price ?? null;
    const change = first && last ? ((last - first) / first) * 100 : null;
    res.json({
      ok: true, symbol, name, range, unit, kind,
      source: origin.source, provider: origin.provider, fetched_at: new Date().toISOString(),
      count: points.length,
      summary: { first, last, min: points.length ? Math.min(...points.map(p => p.price)) : null,
        max: points.length ? Math.max(...points.map(p => p.price)) : null, change_percent: change },
      data: points
    });
  } catch (error) {
    console.error(error);
    jsonError(res, 502, "UPSTREAM_ERROR", "Could not fetch historical fiat prices.");
  }
});

async function getCrypto() {
 return cached("crypto", async () => {
  const html=await fetchHtml("https://alanchand.com/crypto-price");
  const tables=extractTables(cheerio.load(html));
  const items=[];
  for(const table of tables)for(const row of table){
   const name=cleanText(row[0]||"");
   const symbol=name.match(/([A-Z]{2,12})$/)?.[1];
   const price=numberFromText(row[1]);
   if(symbol&&price>0)items.push({symbol,name,price,unit:"toman"});
  }
  if(!items.length)throw new Error("Crypto data unavailable");
  return {items:uniqueBy(items,x=>x.symbol),source:"https://alanchand.com/crypto-price"};
 });
}
app.get("/api/v1/crypto",async(req,res)=>{
 try{const d=await getCrypto();const data=filterSymbols(d.items,requestedSymbols(req));res.json({ok:true,type:"crypto",count:data.length,source:d.source,data});}
 catch(err){console.error(err);jsonError(res,502,"UPSTREAM_ERROR","Could not fetch crypto prices");}
});
app.get("/api/v1/gold", async (req, res) => {
  try {
    const data = await getGold();
    const symbols = requestedSymbols(req);
    const items = filterSymbols(data.items, symbols);

    res.json({
      ok: true,
      type: "gold",
      count: items.length,
      source: data.source,
      source_updated_at: data.source_updated_at,
      fetched_at: data.fetched_at,
      cache: data.cache,
      data: items
    });
  } catch (error) {
    console.error(error);
    jsonError(res, 502, "UPSTREAM_ERROR", "Could not fetch or parse gold prices.");
  }
});

app.get("/api/v1/prices", async (req, res) => {
  try {
    const [currencies, gold] = await Promise.all([getCurrencies(), getGold()]);

    res.json({
      ok: true,
      fetched_at: new Date().toISOString(),
      currencies: {
        count: currencies.items.length,
        provider: currencies.provider,
        failover_used: currencies.failover_used,
        coverage_augmented: currencies.coverage_augmented,
        source: currencies.source,
        sources: currencies.sources,
        source_updated_at: currencies.source_updated_at,
        cache: currencies.cache,
        data: currencies.items
      },
      gold: {
        count: gold.items.length,
        source: gold.source,
        source_updated_at: gold.source_updated_at,
        cache: gold.cache,
        data: gold.items
      }
    });
  } catch (error) {
    console.error(error);
    jsonError(res, 502, "UPSTREAM_ERROR", "Could not fetch or parse upstream prices.");
  }
});

app.use((req, res) => {
  jsonError(res, 404, "NOT_FOUND", "Endpoint not found.");
});

if (!process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`Shoogle Price API listening on http://${HOST}:${PORT}`);
  });
}

export default app;
