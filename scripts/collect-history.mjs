import fs from "node:fs/promises";
import path from "node:path";
import {appendSnapshot, collectMarketData} from "./market-collector-core.mjs";

// Writes to isolated market-history checkout, not the Vercel-deployed main branch.
const archivePath = process.argv[2] || "archive/data/market-history.json";
const now = new Date();
const {records, failures} = await collectMarketData(globalThis.fetch, now);
let archive = {version: 1, points: []};
try {
  archive = JSON.parse(await fs.readFile(archivePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const updated = appendSnapshot(archive, records, now);
await fs.mkdir(path.dirname(archivePath), {recursive: true});
await fs.writeFile(archivePath, JSON.stringify(updated) + "\n", "utf8");
console.log("Saved " + records.length + " real quotes across " +
  new Set(records.map(item => item.kind)).size + " categories at " + now.toISOString());
console.log("Total snapshots: " + updated.points.length);
for (const issue of failures) console.warn("Source unavailable: " + issue.kind + ": " + issue.message);
