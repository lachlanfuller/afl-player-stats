// Copies the small files the browser needs (search index, franchise names, build info) from the
// refresh output into public/data/. Player pages read data/build/players/ directly at build time,
// so the 13,000+ player files are not shipped separately.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.AFL_DATA_DIR || "../data/build");
const publicDir = path.resolve("public/data");
const files = ["players-index.json", "franchises.json", "meta.json"];

const missing = files.filter((f) => !existsSync(path.join(dataDir, f)));
if (missing.length) {
  console.error(`Missing ${missing.join(", ")} in ${dataDir}.\nRun "python pipeline/refresh.py" from the repo root first.`);
  process.exit(1);
}

mkdirSync(publicDir, { recursive: true });
for (const f of files) copyFileSync(path.join(dataDir, f), path.join(publicDir, f));
console.log(`Copied ${files.length} data files to ${path.relative(process.cwd(), publicDir)}/`);
