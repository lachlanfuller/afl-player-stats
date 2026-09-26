import assert from "node:assert/strict";
import { test } from "node:test";

import { fmt, joinAnd, longDate, percent, plural, record, span } from "./format.js";

test("numbers use thousands separators", () => {
  assert.equal(fmt(13362), "13,362");
  assert.equal(fmt(357), "357");
});

test("record joins wins, losses and draws with en dashes", () => {
  assert.equal(record(192, 163, 2), "192–163–2");
});

test("percent gives one decimal place, and a dash when there is nothing to divide by", () => {
  assert.equal(percent(192, 357), "53.8%");
  assert.equal(percent(0, 12), "0.0%");
  assert.equal(percent(0, 0), "–");
});

test("span collapses a single season", () => {
  assert.equal(span(2002, 2020), "2002–2020");
  assert.equal(span(2015, 2015), "2015");
});

test("plural picks the right form", () => {
  assert.equal(plural(1, "game"), "1 game");
  assert.equal(plural(0, "game"), "0 games");
  assert.equal(plural(1234, "game"), "1,234 games");
  assert.equal(plural(2, "match", "matches"), "2 matches");
});

test("joinAnd reads as a list", () => {
  assert.equal(joinAnd([]), "");
  assert.equal(joinAnd(["Geelong"]), "Geelong");
  assert.equal(joinAnd(["Geelong", "Gold Coast"]), "Geelong and Gold Coast");
  assert.equal(joinAnd(["A", "B", "C"]), "A, B and C");
});

test("longDate is not shifted by the time zone", () => {
  assert.equal(longDate("2026-09-19"), "19 September 2026");
  assert.equal(longDate("2027-01-01"), "1 January 2027");
});
