import fs from "node:fs/promises";
import * as cheerio from "cheerio";

const SOURCES = { crypto:"https://alanchand.com/crypto-price", gold:"https://alanchand.com/gold-price" };
const codes = [[/آبشده|مثقال/,"MELTED_GOLD"],[/18\s*عیار|۱۸\s*عیار/,"GOLD_18K"],[/سکه امامی|طرح جدید/,"EMAMI"],[/سکه بهار آزادی/,"BAHAR"],[/نیم سکه/,"HALF_COIN"],[/ربع سکه/,"QUARTER_COIN"],[/سکه گرمی/,"GRAM_COIN"],[/انس طلا/,"XAU_OUNCE"],[/انس نقره/,"XAG_OUNCE"]];
const normalize = t=>String(t||"").replace(/[۰-۹]/g,x=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(x))).replace(/[٠-٩]/g,x=>String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace(/٬/g,",").replace(/٫/g,".").replace(/\s+/g," ").trim();
const number = v=>{const m=normalize(v).replace(/,/g,"").match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
const parse = (html,kind)=>{const $=cheerio.load(html);const results=[];
$("table tbody tr, table tr").each((_,tr)=>{const cells=$(tr).find("td").map((_,td)=>normalize($(td).text())).get();if(cells.length<2)return;const name=cells[0];const price=number(cells[1]);if(!(price>0)||!name||/قیمت|نام ارز/.test(name))return;
let symbol;
if(kind==="gold"){symbol=codes.find(([re])=>re.test(name))?.[1];if(!symbol)return}
else { const extracted=name.match(/(?:^|\s)([A-Z]{2,12})\s*$/);symbol=extracted?.[1];if(!symbol)return; }
results.push({symbol,name,price,unit:kind==="gold"&&/انس/.test(name)?"usd":"toman"});
});return [...new Map(results.map(x=>[x.symbol,x])).values()]};
const timestamp=new Date().toISOString();
let existing={version:1,points:[]};
try{existing=JSON.parse(await fs.readFile("data/market-history.json","utf8"))}catch(e){if(e.code!=="ENOENT")throw e}
if(!Array.isArray(existing.points))throw Error("Invalid archive");
let records=[];
for(const [kind,url] of Object.entries(SOURCES)){
try{const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{"user-agent":"Mozilla/5.0 ShoogleMarketArchive/1.0"}});if(!response.ok)throw Error("HTTP "+response.status);const parsed=parse(await response.text(),kind);if(parsed.length===0)throw Error("No rows parsed for "+kind);records.push(...parsed.map(x=>({...x,kind})));console.log(kind+": "+parsed.length+" assets")}catch(err){console.warn(kind+" unavailable: "+err.message)}
}
if(!records.length)throw Error("No provider data; refusing empty snapshot");
const rounded=new Date(timestamp).setUTCMilliseconds(0);
const current={at:new Date(rounded).toISOString(),prices:records};
const last=existing.points.at(-1);
if(!last||new Date(last.at).getTime()<rounded-15*60*1000) existing.points.push(current);
else existing.points[existing.points.length-1]=current;
// Retain up to 370 days; history is never backfilled with invented values.
existing.points=existing.points.filter(x=>new Date(x.at).getTime()>=Date.now()-370*86400000);
await fs.mkdir("data",{recursive:true});
await fs.writeFile("data/market-history.json",JSON.stringify(existing)+"\n");
