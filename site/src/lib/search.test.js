import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { normalise, prepare, search } from "./search.js";

const player = (id, name, games) => ({ id, name, games, first: 2000, last: 2010, clubs: {} });
const names = (found) => found.results.map((p) => p.name);
const ids = (found) => found.results.map((p) => p.id);

test("normalise ignores case, accents, punctuation and extra spaces", () => {
  assert.equal(normalise("  Gary   ABLETT "), "gary ablett");
  assert.equal(normalise("Shane O'Brien"), "shane o brien");
  assert.equal(normalise("Josh Smith-Jones"), "josh smith jones");
  assert.equal(normalise("Léo Ñandú"), "leo nandu");
});

test("an empty or symbol-only query returns nothing", () => {
  const entries = prepare([player(1, "Gary Ablett", 357)]);
  assert.deepEqual(search(entries, ""), { results: [], total: 0 });
  assert.deepEqual(search(entries, "   "), { results: [], total: 0 });
  assert.deepEqual(search(entries, "'-"), { results: [], total: 0 });
});

test("matches the start of any word, in any order", () => {
  const entries = prepare([player(1, "Gary Ablett", 357), player(2, "Geoff Ablett", 229), player(3, "Tom Hawkins", 300)]);
  assert.deepEqual(ids(search(entries, "abl")), [1, 2]);
  assert.deepEqual(ids(search(entries, "gary ab")), [1]);
  assert.deepEqual(ids(search(entries, "ablett gary")), [1]);
  assert.deepEqual(ids(search(entries, "hawk")), [3]);
});

test("every typed word must match a different word in the name", () => {
  const entries = prepare([player(1, "Gary Ablett", 357)]);
  assert.equal(search(entries, "gary gary").total, 0);
  assert.equal(search(entries, "gary zzz").total, 0);
});

test("an exact name outranks a name that only starts with the query", () => {
  const entries = prepare([player(1, "Tom Hawkins Junior", 500), player(2, "Tom Hawkins", 100), player(3, "Tom Hawkinson", 50)]);
  assert.deepEqual(ids(search(entries, "tom hawkins")), [2, 1, 3]);
});

test("among equal matches the longer career comes first, then name, then id", () => {
  const entries = prepare([player(1, "Gary Ablett", 248), player(2, "Gary Ablett", 357), player(3, "Geoff Ablett", 248), player(4, "Gary Ablett", 248)]);
  assert.deepEqual(ids(search(entries, "ablett")), [2, 1, 4, 3]);
});

test("punctuation in the name does not stop a match", () => {
  const entries = prepare([player(1, "Shane O'Brien", 10), player(2, "Josh Smith-Jones", 10)]);
  assert.deepEqual(ids(search(entries, "obrien")), [1]);
  assert.deepEqual(ids(search(entries, "o'brien")), [1]);
  assert.deepEqual(ids(search(entries, "smith jones")), [2]);
  assert.deepEqual(ids(search(entries, "smithjones")), [2]);
});

test("matching inside a word needs at least three letters and ranks last", () => {
  const entries = prepare([player(1, "Gary Ablett", 357), player(2, "Lett Someone", 5)]);
  assert.equal(search(entries, "bl").total, 0, "two letters inside a word is too loose");
  assert.deepEqual(ids(search(entries, "lett")), [2, 1], "the word that starts with it comes first");
});

test("returns the best few and reports how many matched in all", () => {
  const many = Array.from({ length: 30 }, (_, i) => player(i + 1, `Alex Player${i}`, i));
  const found = search(prepare(many), "alex", 12);
  assert.equal(found.results.length, 12);
  assert.equal(found.total, 30);
  assert.equal(found.results[0].games, 29, "longest career first");
});

test("no match gives an empty list", () => {
  const entries = prepare([player(1, "Gary Ablett", 357)]);
  assert.deepEqual(search(entries, "zzzz"), { results: [], total: 0 });
});

// Checks against the real index, when the refresh has been run. These players have retired,
// so their records do not change.
const indexPath = path.resolve(process.env.AFL_DATA_DIR || "../data/build", "players-index.json");
const real = existsSync(indexPath) ? prepare(JSON.parse(readFileSync(indexPath, "utf-8"))) : null;

test("real data: both Gary Abletts are found and told apart by career", { skip: !real }, () => {
  const found = search(real, "gary ablett");
  assert.deepEqual(found.results.slice(0, 2).map((p) => [p.id, p.first, p.last]), [
    [1105, 2002, 2020],
    [567, 1982, 1996],
  ]);
});

test("real data: a surname alone finds every Ablett, most games first", { skip: !real }, () => {
  const found = search(real, "ablett", 20);
  assert.equal(found.total, 7);
  const games = found.results.map((p) => p.games);
  assert.deepEqual(games, [...games].sort((a, b) => b - a));
  assert.ok(names(found).every((n) => n.endsWith("Ablett")));
});

test("real data: searching 13,000 names takes a few milliseconds", { skip: !real }, () => {
  const start = performance.now();
  for (const q of ["a", "s", "smith", "jo", "ablett gary"]) search(real, q);
  const perSearch = (performance.now() - start) / 5;
  assert.ok(perSearch < 50, `each search took ${perSearch.toFixed(1)} ms`);
});
