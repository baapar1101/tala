// Validation and archival logic for the Shoogle hourly history collector.
export const MARKET_ENDPOINTS = Object.freeze({
  crypto: "https://mark-price.vercel.app/api/v1/crypto",
  gold: "https://mark-price.vercel.app/api/v1/gold"
});
const MAX_GOLD_QUOTE_AGE_MS = 72 * 60 * 60 * 1000;
const RETENTION_MS = 370 * 24 * 60 * 60 * 1000;
const SYMBOL_PATTERN = /^[A-Z0-9_]{2,32}$/;

export function normalizeQuoteResponse(payload, kind, now = new Date()) {
  if (!["gold", "crypto"].includes(kind)) throw new Error("Unsupported quote category");
  if (payload?.ok !== true || !Array.isArray(payload.data) || !payload.data.length) {
    throw new Error(kind + ": invalid or empty API response");
  }
  const items = new Map();
  for (const item of payload.data) {
    const symbol = String(item?.symbol ?? "").trim().toUpperCase();
    const price = Number(item?.price);
    if (!SYMBOL_PATTERN.test(symbol) || !Number.isFinite(price) || price <= 0 ||
        !["toman", "usd"].includes(item?.unit)) continue;
    const observedAt = item.last_updated_at || payload.fetched_at || now.toISOString();
    const observedMs = Date.parse(observedAt);
    if (!Number.isFinite(observedMs) || observedMs > now.getTime() + 300000) continue;
    if (kind === "gold" && now.getTime() - observedMs > MAX_GOLD_QUOTE_AGE_MS) continue;
    items.set(symbol, {
      symbol, name: String(item.name || symbol).slice(0,160), price,
      unit: item.unit, kind,
      source_provider: String(item.source_provider || payload.provider || "unknown"),
      observed_at: new Date(observedMs).toISOString()
    });
  }
  if (!items.size) throw new Error(kind + ": no validated quotes");
  return [...items.values()];
}

export async function collectMarketData(fetcher, now = new Date(), endpoints = MARKET_ENDPOINTS) {
  const entries = Object.entries(endpoints);
  const settled = await Promise.allSettled(entries.map(async ([kind, url]) => {
    const response = await fetcher(url, {
      headers: {accept: "application/json"}, signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return normalizeQuoteResponse(await response.json(), kind, now);
  }));
  const records = [];
  const failures = [];
  for (let i = 0; i < entries.length; i++) {
    const [kind] = entries[i];
    if (settled[i].status === "fulfilled") records.push(...settled[i].value);
    else failures.push({kind, message: String(settled[i].reason?.message || settled[i].reason)});
  }
  if (!records.length) throw new Error("No verified quotes available from any provider: " +
    failures.map(x => x.kind + "=" + x.message).join("; "));
  return {records, failures};
}

export function appendSnapshot(archive, records, now = new Date()) {
  if (!Array.isArray(records) || !records.length) throw new Error("Cannot archive empty prices");
  if (archive?.points != null && !Array.isArray(archive.points)) throw new Error("Malformed archive");
  const cutoff = now.getTime() - RETENTION_MS;
  const points = (archive?.points || []).filter(point =>
    Number.isFinite(Date.parse(point.at)) && Date.parse(point.at) >= cutoff &&
    Date.parse(point.at) <= now.getTime()
  );
  const snapshot = {at: now.toISOString(), prices: records};
  if (points.length && now.getTime() - Date.parse(points.at(-1).at) < 15 * 60000) {
    points[points.length - 1] = snapshot;
  } else {
    points.push(snapshot);
  }
  return {version: 1, points};
}
