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

const PORT = Number(process.env.PORT || 3000);
const CACHE_TTL_SECONDS = Math.max(10, Number(process.env.CACHE_TTL_SECONDS || 60));
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://price.eldery.ir";
const API_KEYS = (process.env.API_KEYS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const SOURCE = {
  currencies: "https://alanchand.com/currencies-price",
  gold: "https://alanchand.com/gold-price"
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

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "ElderyPriceAPI/1.0 (+https://price.eldery.ir)",
        "accept": "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      throw new Error(`Upstream returned HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
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

async function getCurrencies() {
  return cached("currencies", async () => {
    const html = await fetchHtml(SOURCE.currencies);
    const parsed = parseCurrencies(html);

    if (!parsed.items.length) {
      throw new Error("Currency table was not found or could not be parsed.");
    }

    return {
      source: SOURCE.currencies,
      source_updated_at: parsed.source_updated_at,
      fetched_at: new Date().toISOString(),
      items: parsed.items
    };
  });
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
    name: "Eldery Price API",
    version: "1.0.0",
    base_url: PUBLIC_BASE_URL,
    endpoints: {
      prices: "/api/v1/prices",
      currencies: "/api/v1/currencies",
      gold: "/api/v1/gold",
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
  customSiteTitle: "Eldery Price API Docs"
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
      source: data.source,
      source_updated_at: data.source_updated_at,
      fetched_at: data.fetched_at,
      cache: data.cache,
      data: items
    });
  } catch (error) {
    console.error(error);
    jsonError(res, 502, "UPSTREAM_ERROR", "Could not fetch or parse currency prices.");
  }
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
        source: currencies.source,
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Eldery Price API listening on port ${PORT}`);
});