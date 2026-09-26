// Build-time access to the refresh output (data/build). Only used while the site is being built.
import { readFileSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.AFL_DATA_DIR || "../data/build");

const readJson = (...parts) => JSON.parse(readFileSync(path.join(dataDir, ...parts), "utf-8"));

let cache = {};

export function loadMeta() {
  return (cache.meta ??= readJson("meta.json"));
}

export function loadFranchises() {
  return (cache.franchises ??= readJson("franchises.json"));
}

export function loadIndex() {
  return (cache.index ??= readJson("players-index.json"));
}

export function loadPlayer(id) {
  return readJson("players", `${id}.json`);
}

/** Other players who share this player's name, with what tells them apart. */
export function namesakesOf(player) {
  cache.byName ??= Map.groupBy(loadIndex(), (p) => p.name);
  return (cache.byName.get(player.name) ?? []).filter((p) => p.id !== player.id);
}
