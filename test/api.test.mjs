import {test, after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.VERCEL="1";
process.env.API_KEYS="";
const {default: app}=await import("../src/server.js");
const server=await new Promise(resolve=>{
  const instance=app.listen(0,"127.0.0.1",()=>resolve(instance));
});
after(()=>new Promise(resolve=>server.close(resolve)));
const nativeFetch=globalThis.fetch;
const url=path=> "http://127.0.0.1:"+server.address().port+path;
const read=async path=>{
  const response=await nativeFetch(url(path));
  return {status:response.status, body:await response.json()};
};
const fiatResponse={data:[{id:3,symbol:"USD",name:"US Dollar",fa_name:"دلار آمریکا",
  toman:200000,usd:1,last_updated_at:new Date().toISOString()}]};
const mocked=({goldChart=false}={})=>async uri=>{
  const target=String(uri);
  if(target.includes("lake.arzdigital.com"))return new Response(JSON.stringify(fiatResponse),
    {status:200,headers:{"content-type":"application/json"}});
  if(goldChart && target.includes("gw.arzdigital.com/muninn/v1/chart")) {
    return new Response(JSON.stringify({data:[[Date.now()-60000,100,200000,0]]}),
      {status:200,headers:{"content-type":"application/json"}});
  }
  return new Response("unavailable",{status:503});
};

test("Swagger, health and OpenAPI resolve for the same host",async()=>{
  const {body}=await read("/openapi.json");
  assert.equal(body.servers[0].url,"/");
  assert.equal(body.info.version,"1.2.2");
  const health=await read("/health");
  assert.equal(health.status,200);
  const doc=await nativeFetch(url("/docs/"));
  assert.equal(doc.status,200);
  assert.match(await doc.text(),/swagger-ui-bundle/);
});
test("combined API keeps currencies when all gold sources fail",async()=>{
  globalThis.fetch=mocked();
  try{
    const result=await read("/api/v1/prices");
    assert.equal(result.status,200);
    assert.equal(result.body.partial,true);
    assert.deepEqual(result.body.failed_sections,["gold"]);
    assert.equal(result.body.currencies.ok,true);
    assert.ok(result.body.currencies.data.length>0);
    assert.equal(result.body.gold.ok,false);
  }finally{globalThis.fetch=nativeFetch;}
});
test("gold fallback exposes verified source, timestamp and price mode",async()=>{
  globalThis.fetch=mocked({goldChart:true});
  try{
    const result=await read("/api/v1/gold");
    assert.equal(result.status,200);
    assert.equal(result.body.failover_used,true);
    assert.ok(result.body.data.length>0);
    assert.equal(result.body.data[0].price_mode,"last_observed");
    assert.ok(result.body.data[0].last_updated_at);
  }finally{globalThis.fetch=nativeFetch;}
});
test("GitHub Pages root and docs copies stay identical",()=>{
  assert.equal(fs.readFileSync("index.html","utf8"),fs.readFileSync("docs/index.html","utf8"));
});
