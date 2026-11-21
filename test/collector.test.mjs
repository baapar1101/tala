import {test} from "node:test";
import assert from "node:assert/strict";
import {appendSnapshot, collectMarketData, normalizeQuoteResponse} from "../scripts/market-collector-core.mjs";

const NOW = new Date("2026-11-21T10:00:00.000Z");
const quote = (symbol, price, extra = {}) => ({symbol, name: symbol, price, unit: "toman", ...extra});
const jsonReply = data => ({ok: true, json: async () => data});

test("validates numbers, units, symbols and gold observation freshness", () => {
  const data = normalizeQuoteResponse({ok:true,data:[
    quote("GOLD_18K",21000000,{last_updated_at:"2026-11-21T09:00:00Z"}),
    quote("BAD",0), quote("MISSING",null), quote("X",20), quote("UNITLESS",40,{unit:"rial"}),
    quote("STALE",10,{last_updated_at:"2026-11-01T09:00:00Z"})
  ]}, "gold", NOW);
  assert.equal(data.length,1);
  assert.equal(data[0].symbol,"GOLD_18K");
  assert.equal(data[0].observed_at,"2026-11-21T09:00:00.000Z");
});
test("collects independent gold and crypto sources", async () => {
  const result=await collectMarketData(async url => jsonReply({
    ok:true,data:[quote(url.includes("/gold")?"EMAMI":"BTC",123)]
  }),NOW);
  assert.equal(result.records.length,2);
  assert.deepEqual(result.failures,[]);
});
test("archives healthy crypto even if the gold provider fails", async () => {
  const result=await collectMarketData(async url =>
    url.includes("/gold") ? {ok:false,status:502} : jsonReply({ok:true,data:[quote("BTC",1)]}),NOW);
  assert.equal(result.records.length,1);
  assert.equal(result.records[0].kind,"crypto");
  assert.equal(result.failures[0].kind,"gold");
});
test("does not archive an empty snapshot if every provider fails", async () => {
  await assert.rejects(collectMarketData(async()=>({ok:false,status:502}),NOW),/No verified quotes/);
});
test("preserves history, rotates old records, and replaces near-duplicates", () => {
  const old={version:1,points:[{at:"2025-01-01T00:00:00Z",prices:[quote("BTC",1)]}]};
  const a=appendSnapshot(old,[quote("BTC",20)],NOW);
  assert.equal(a.points.length,1);
  const b=appendSnapshot(a,[quote("BTC",21)],new Date(NOW.getTime()+60000));
  assert.equal(b.points.length,1);
  assert.equal(b.points[0].prices[0].price,21);
  const c=appendSnapshot(b,[quote("BTC",22)],new Date(NOW.getTime()+3600000));
  assert.equal(c.points.length,2);
});
