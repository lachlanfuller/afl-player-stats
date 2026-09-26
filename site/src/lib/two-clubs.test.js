import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { playersForBothClubs } from "./two-clubs.js";

const player = (id, name, clubs) => ({ id, name, first: 2000, last: 2010, games: Object.values(clubs).reduce((a, b) => a + b, 0), clubs });
const ids = (found) => found.map((p) => p.id);

test("finds only players with games for both clubs", () => {
  const players = [
    player(1, "Both", { geelong: 10, hawthorn: 5 }),
    player(2, "Geelong only", { geelong: 20 }),
    player(3, "Hawthorn only", { hawthorn: 20 }),
    player(4, "Neither", { carlton: 20 }),
  ];
  assert.deepEqual(ids(playersForBothClubs(players, "geelong", "hawthorn")), [1]);
});

test("no club chosen, or the same club chosen twice, finds nobody", () => {
  const players = [player(1, "Both", { geelong: 10, hawthorn: 5 })];
  assert.deepEqual(playersForBothClubs(players, "", "hawthorn"), []);
  assert.deepEqual(playersForBothClubs(players, "geelong", ""), []);
  assert.deepEqual(playersForBothClubs(players, "", ""), []);
  assert.deepEqual(playersForBothClubs(players, "geelong", "geelong"), []);
});

test("adds gamesA and gamesB for the two chosen clubs", () => {
  const players = [player(1, "Both", { geelong: 10, hawthorn: 5 })];
  const [found] = playersForBothClubs(players, "geelong", "hawthorn");
  assert.equal(found.gamesA, 10);
  assert.equal(found.gamesB, 5);
});

test("orders by combined games for the two clubs, then name, then id", () => {
  const players = [
    player(1, "Bob", { geelong: 5, hawthorn: 5 }),
    player(2, "Amy", { geelong: 20, hawthorn: 20 }),
    player(3, "Zoe", { geelong: 5, hawthorn: 5 }),
    player(4, "Amy", { geelong: 5, hawthorn: 5 }),
  ];
  assert.deepEqual(ids(playersForBothClubs(players, "geelong", "hawthorn")), [2, 4, 1, 3]);
});

test("a club with zero recorded games for a player does not count as played", () => {
  const players = [player(1, "Zero", { geelong: 0, hawthorn: 5 })];
  assert.deepEqual(playersForBothClubs(players, "geelong", "hawthorn"), []);
});

// Checks against the real index, when the refresh has been run.
const indexPath = path.resolve(process.env.AFL_DATA_DIR || "../data/build", "players-index.json");
const real = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf-8")) : null;

test("real data: everyone known to have played for both Geelong and Gold Coast is found", { skip: !real }, () => {
  // Players who had played for both when this test was written (26 Sep 2026).
  const known = new Set([12687, 1105, 12053, 12499, 12236, 12099, 12010, 4140, 11909]);
  const found = new Set(ids(playersForBothClubs(real, "geelong", "gold-coast")));
  for (const id of known) assert.ok(found.has(id), `player ${id} missing from Geelong/Gold Coast results`);
});

test("real data: Gary Ablett heads the Geelong/Gold Coast list with his full games at each", { skip: !real }, () => {
  const [first] = playersForBothClubs(real, "geelong", "gold-coast");
  assert.equal(first.id, 1105);
  assert.equal(first.gamesA + first.gamesB, first.games);
});
