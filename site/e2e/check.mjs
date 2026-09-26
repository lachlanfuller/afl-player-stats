// Drives the built site (dist/) in Chromium and checks search, keyboard use, the numbers on a known
// player's page, sorting, mobile layout, dark mode and accessibility (axe).
//
//   npm run build && npm run e2e
//
// Needs a browser: run `npx playwright install chromium` once, or set CHROMIUM_PATH to an existing
// Chromium. Screenshots are written to e2e-output/ for a quick look.
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const DIST = path.resolve("dist");
const SHOTS = path.resolve("e2e-output");
await mkdir(SHOTS, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

// ---- tiny static server for dist/ (directory URLs serve index.html) ----
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(DIST, p);
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((r) => server.listen(4321, r));
const BASE = "http://localhost:4321";

// Figures that change with each data refresh are read from the build, not written into the checks.
const meta = JSON.parse(await readFile(`${DIST}/data/meta.json`, "utf-8"));
const fmtN = (n) => new Intl.NumberFormat("en-AU").format(n);
const longDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });

async function newPage({ width = 1280, height = 800, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.problems = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) page.problems.push(`console ${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => page.problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => page.problems.push(`request failed: ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 400) page.problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  return page;
}

const text = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();

// ============ 1. Home + search (desktop, light) ============
{
  const page = await newPage();
  await page.goto(BASE + "/");
  check("home: title", (await page.title()) === "AFL Player Stats", await page.title());
  check("home: hero heading", (await text(page, "h1")) === "AFL player stats");
  check("home: fact shows player count", (await text(page, ".facts")).includes(fmtN(meta.players)), await text(page, ".facts"));
  await page.screenshot({ path: `${SHOTS}/home-light.png` });

  const input = page.getByRole("combobox", { name: "Search players" });
  await input.click();
  await input.pressSequentially("ablett", { delay: 20 });
  await page.locator(".search-list a").first().waitFor();
  const opts = await page.locator(".search-list a").allInnerTexts();
  check("search 'ablett': 7 Abletts listed", opts.length === 7, `${opts.length}`);
  check("search: first result is the longer career (Gary, 2002–2020)", opts[0].replace(/\s+/g, " ").startsWith("Gary Ablett 2002–2020 · 357 games · Geelong, Gold Coast"), opts[0].replace(/\s+/g, " "));
  check("search: namesake told apart by span and clubs", opts[1].replace(/\s+/g, " ").startsWith("Gary Ablett 1982–1996"), opts[1].replace(/\s+/g, " "));
  check("search: status reads matches", (await text(page, ".search-status")) === "7 matches.", await text(page, ".search-status"));
  check("search: combobox is expanded", (await input.getAttribute("aria-expanded")) === "true");
  await page.screenshot({ path: `${SHOTS}/home-results-light.png` });

  // keyboard: Down, Down, Up -> first option active; Enter opens it
  await input.press("ArrowDown"); await input.press("ArrowDown"); await input.press("ArrowUp");
  const activeId = await input.getAttribute("aria-activedescendant");
  const activeText = await page.locator(`#${activeId}`).innerText();
  check("keyboard: Down, Down, Up selects the first result", activeText.startsWith("Gary Ablett\n2002"), activeText.replace(/\n/g, " "));
  check("keyboard: selected option has aria-selected", (await page.locator(`#${activeId}`).getAttribute("aria-selected")) === "true");
  await Promise.all([page.waitForURL("**/players/1105/"), input.press("Enter")]);
  check("keyboard: Enter opens the selected player", page.url().endsWith("/players/1105/"), page.url());
  check("home: no console errors or failed requests", page.problems.length === 0, page.problems.join(" | "));

  // Up from nothing selected picks the LAST result; Enter with nothing selected picks the FIRST
  await page.goto(BASE + "/");
  const input2 = page.getByRole("combobox", { name: "Search players" });
  await input2.pressSequentially("ablett");
  await page.locator(".search-list a").first().waitFor();
  await input2.press("ArrowUp");
  const lastText = await page.locator(`#${await input2.getAttribute("aria-activedescendant")}`).innerText();
  check("keyboard: Up from nothing selects the last result", lastText.startsWith("Nathan Ablett"), lastText.replace(/\n/g, " "));
  await input2.press("Escape");
  check("keyboard: Escape closes the list", (await page.locator(".search-list").isHidden()));
  await input2.press("Escape");
  check("keyboard: second Escape clears the box", (await input2.inputValue()) === "");

  await input2.pressSequentially("zzzzqq");
  await page.waitForFunction(() => document.querySelector(".search-status")?.textContent.includes("No players found"));
  check("search: no match message", (await text(page, ".search-status")) === "No players found for “zzzzqq”.", await text(page, ".search-status"));

  await input2.fill("");
  await input2.pressSequentially("gary");
  await page.locator(".search-list a").first().waitFor();
  const st = await text(page, ".search-status");
  check("search: many matches are capped and say so", /^Showing 12 of [\d,]+ matches\./.test(st), st);
  await input2.fill("");
  await input2.pressSequentially("Ablett Gary");
  await page.locator(".search-list a").first().waitFor();
  check("search: words in any order", (await page.locator(".search-list a").first().innerText()).startsWith("Gary Ablett"));
  await page.close();
}

// ============ 2. Player page, desktop light ============
{
  const page = await newPage();
  await page.goto(BASE + "/players/1105/");
  check("player: title", (await page.title()) === "Gary Ablett (2002–2020) · AFL Player Stats", await page.title());
  check("player: heading", (await text(page, "h1")) === "Gary Ablett");
  check("player: meta line", (await text(page, ".player-meta")) === "2002–2020 · Geelong and Gold Coast", await text(page, ".player-meta"));
  const tiles = Object.fromEntries(await page.locator(".tile").evaluateAll((els) => els.map((e) => [e.querySelector("dt").innerText, [...e.querySelectorAll("dd")].map((d) => d.innerText.trim())])));
  check("player: games 357 over 19 seasons", tiles["Games"]?.[0] === "357" && tiles["Games"]?.[1] === "19 seasons", JSON.stringify(tiles["Games"]));
  check("player: goals 445", tiles["Goals"]?.[0] === "445", JSON.stringify(tiles["Goals"]));
  check("player: record 192–163–2 (53.8% wins)", tiles["Win–loss–draw"]?.[0] === "192–163–2" && tiles["Win–loss–draw"]?.[1] === "53.8% wins", JSON.stringify(tiles["Win–loss–draw"]));
  check("player: finals 25 (14 wins, 11 losses)", tiles["Finals played"]?.[0] === "25" && tiles["Finals played"]?.[1] === "14 wins, 11 losses", JSON.stringify(tiles["Finals played"]));
  check("player: premierships 2007, 2009", tiles["Premierships"]?.[0] === "2" && tiles["Premierships"]?.[1] === "2007, 2009", JSON.stringify(tiles["Premierships"]));

  const clubs = await page.locator("#clubs-heading ~ .table-wrap tbody tr").allInnerTexts();
  check("player: clubs table has Geelong and Gold Coast", clubs.length === 2 && clubs[0].startsWith("Geelong") && clubs[1].startsWith("Gold Coast"), clubs.map((c) => c.replace(/\s+/g, " ")).join(" | "));
  const seasonRows = await page.locator("#seasons-heading ~ .table-wrap tbody tr").count();
  check("player: one season row per season (19)", seasonRows === 19, `${seasonRows}`);
  const pills = await page.locator("#seasons-heading ~ .table-wrap .pill").count();
  check("player: exactly two 'Premiers' badges", pills === 2, `${pills}`);
  const namesake = page.locator(".namesakes a");
  check("player: namesake note links to the other Gary Ablett", (await namesake.count()) === 1 && (await namesake.getAttribute("href")) === "/players/567/", await page.locator(".namesakes").innerText().then((t) => t.replace(/\s+/g, " ")));

  // sorting the opponents table
  const oppRows = async () => page.locator("#opponents-heading ~ .table-wrap tbody tr").evaluateAll((rs) => rs.map((r) => [r.cells[0].innerText, Number(r.cells[1].innerText.replace(/,/g, ""))]));
  const before = await oppRows();
  check("opponents: default order is most games first", before.every((r, i) => i === 0 || before[i - 1][1] >= r[1]));
  check("opponents: games add up to 357", before.reduce((s, r) => s + r[1], 0) === 357, `${before.reduce((s, r) => s + r[1], 0)}`);
  await page.locator("#opponents-heading ~ .table-wrap th", { hasText: "Opponent" }).getByRole("button").click();
  let after = await oppRows();
  check("opponents: click 'Opponent' sorts A to Z", after.every((r, i) => i === 0 || after[i - 1][0].localeCompare(r[0]) <= 0), after.slice(0, 3).map((r) => r[0]).join(", "));
  check("opponents: aria-sort set to ascending", (await page.locator("#opponents-heading ~ .table-wrap th", { hasText: "Opponent" }).getAttribute("aria-sort")) === "ascending");
  await page.locator("#opponents-heading ~ .table-wrap th", { hasText: "Opponent" }).getByRole("button").click();
  after = await oppRows();
  check("opponents: click again reverses to Z to A", after.every((r, i) => i === 0 || after[i - 1][0].localeCompare(r[0]) >= 0));
  await page.locator("#opponents-heading ~ .table-wrap th", { hasText: "Games" }).getByRole("button").click();
  after = await oppRows();
  check("opponents: click 'Games' sorts biggest first", after.every((r, i) => i === 0 || after[i - 1][1] >= r[1]));
  await page.locator("#seasons-heading ~ .table-wrap th", { hasText: "Premiership" }).getByRole("button").click();
  const firstTwo = await page.locator("#seasons-heading ~ .table-wrap tbody tr").evaluateAll((rs) => rs.slice(0, 3).map((r) => r.cells[6].innerText.trim()));
  check("seasons: sorting by Premiership puts the two premiership seasons first", firstTwo[0] === "Premiers" && firstTwo[1] === "Premiers" && firstTwo[2] === "", JSON.stringify(firstTwo));

  // the header search on a player page
  const hsearch = page.getByRole("combobox", { name: "Search players" });
  await hsearch.pressSequentially("hawkins");
  await page.locator(".search-list a").first().waitFor();
  const overlay = await page.locator(".search-list").boundingBox();
  check("header search: results float over the page and are visible", overlay && overlay.height > 100, JSON.stringify(overlay));
  await page.screenshot({ path: `${SHOTS}/player-header-search-light.png` });
  await hsearch.press("Escape");

  await page.reload();
  await page.screenshot({ path: `${SHOTS}/player-light.png`, fullPage: true });
  check("player: no console errors or failed requests", page.problems.length === 0, page.problems.join(" | "));

  // follow the namesake link
  await page.locator(".namesakes a").click();
  await page.waitForURL("**/players/567/");
  check("namesake link opens the other Gary Ablett (1982–1996)", (await page.title()).startsWith("Gary Ablett (1982–1996)"), await page.title());
  await page.close();
}

// ============ 3. A player with no premierships / no finals, and a name with a namesake-free page ============
{
  const page = await newPage();
  const idx = JSON.parse(await readFile(`${DIST}/data/players-index.json`, "utf-8"));
  const one = idx.find((p) => p.games === 1);
  await page.goto(BASE + `/players/${one.id}/`);
  const t = await text(page, ".tiles");
  check(`one-game player (${one.name}): page renders with singular wording`, t.includes("1 season") && t.includes("Never played in a final") && t.includes("None"), t.slice(0, 160));
  check("one-game player: no console errors", page.problems.length === 0, page.problems.join(" | "));
  await page.close();
}

// ============ 4. Mobile ============
{
  const page = await newPage({ width: 390, height: 844 });
  await page.goto(BASE + "/");
  await page.screenshot({ path: `${SHOTS}/home-mobile.png` });
  const noScrollHome = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check("mobile: home has no sideways page scroll", noScrollHome);
  await page.goto(BASE + "/players/1105/");
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check("mobile: player page has no sideways page scroll", noScroll, await page.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
  await page.getByRole("combobox", { name: "Search players" }).pressSequentially("judd");
  await page.locator(".search-list a").first().waitFor();
  const box = await page.locator(".search-list").boundingBox();
  check("mobile: header results fit the screen width", box.x >= 0 && box.x + box.width <= 390 + 1, JSON.stringify(box));
  await page.screenshot({ path: `${SHOTS}/player-mobile-search.png` });
  await page.getByRole("combobox", { name: "Search players" }).fill("");
  await page.screenshot({ path: `${SHOTS}/player-mobile.png`, fullPage: true });
  const tableScrolls = await page.locator("#seasons-heading ~ .table-wrap").evaluate((el) => el.scrollWidth >= el.clientWidth);
  check("mobile: wide tables scroll inside their own box", tableScrolls);
  await page.goto(BASE + "/two-clubs/");
  await page.selectOption("#two-clubs-a", "geelong");
  await page.selectOption("#two-clubs-b", "gold-coast");
  await page.locator(".two-clubs-result tbody tr").first().waitFor();
  const noScrollTwoClubs = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check("mobile: two-clubs page has no sideways page scroll", noScrollTwoClubs);
  await page.screenshot({ path: `${SHOTS}/two-clubs-mobile.png`, fullPage: true });
  await page.close();
}

// ============ 5. Dark mode ============
{
  const page = await newPage({ dark: true });
  await page.goto(BASE + "/");
  await page.getByRole("combobox", { name: "Search players" }).pressSequentially("ablett");
  await page.locator(".search-list a").first().waitFor();
  await page.screenshot({ path: `${SHOTS}/home-results-dark.png` });
  await page.goto(BASE + "/players/1105/");
  await page.screenshot({ path: `${SHOTS}/player-dark.png`, fullPage: true });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("dark: page background is dark", bg === "rgb(12, 10, 9)", bg);
  await page.close();
}

// ============ 6. About page ============
{
  const page = await newPage();
  await page.goto(BASE + "/about/");
  const t = await text(page, ".prose");
  check("about: shows the real dropped-row counts and the latest game date", t.includes(`${fmtN(meta.rows.droppedNoPlayerId)} rows`) && (!meta.rows.droppedDuplicates || t.includes(`${fmtN(meta.rows.droppedDuplicates)} exact duplicate`)) && t.includes(longDate(meta.sourceLastGame)), t.slice(0, 120));
  check("about: no stray space before punctuation", !/ [,.]/.test(t));
  await page.screenshot({ path: `${SHOTS}/about-light.png`, fullPage: true });
  await page.goto(BASE + "/players/1105/");
  await page.getByRole("link", { name: "How the numbers are worked out" }).first().click();
  await page.waitForURL("**/about/#method");
  check("player page links to the method section of About", page.url().endsWith("/about/#method"));
  await page.close();
}

// ============ 7. Played for two clubs ============
{
  const page = await newPage();
  await page.goto(BASE + "/");
  await page.getByRole("link", { name: "Played for two clubs" }).click();
  await page.waitForURL("**/two-clubs/");
  check("two clubs: nav link opens the page", (await text(page, "h1")) === "Played for two clubs");
  check("two clubs: status prompts before any club is chosen", (await text(page, ".two-clubs-status")) === "Choose two clubs to see who has played for both.");

  await page.selectOption("#two-clubs-a", "geelong");
  check("two clubs: one club chosen is not enough", (await text(page, ".two-clubs-status")) === "Choose two clubs to see who has played for both.");
  await page.selectOption("#two-clubs-b", "gold-coast");
  await page.waitForFunction(() => document.querySelector(".two-clubs-status")?.textContent.includes("played for both"));
  const status = await text(page, ".two-clubs-status");
  check("two clubs: status names both clubs and a plausible count", /^\d+ players have played for both Geelong and Gold Coast\.$/.test(status), status);

  const rows = async () => page.locator(".two-clubs-result tbody tr").evaluateAll((rs) => rs.map((r) => r.cells[0].innerText));
  const before = await rows();
  check("two clubs: Gary Ablett heads the Geelong/Gold Coast list", before[0] === "Gary Ablett", before.slice(0, 3).join(", "));
  const firstLink = await page.locator(".two-clubs-result tbody tr").first().locator("a").getAttribute("href");
  check("two clubs: player name links to their page", firstLink === "/players/1105/", firstLink);
  await page.screenshot({ path: `${SHOTS}/two-clubs-light.png` });

  await page.locator(".two-clubs-result th", { hasText: "Player" }).getByRole("button").click();
  const after = await rows();
  check("two clubs: click 'Player' sorts A to Z", after.every((r, i) => i === 0 || after[i - 1].localeCompare(r) <= 0), after.slice(0, 3).join(", "));
  check("two clubs: sorting does not change who is listed", new Set(after).size === new Set(before).size && after.every((n) => before.includes(n)));

  await page.selectOption("#two-clubs-b", "geelong");
  check("two clubs: choosing the same club twice asks for two different clubs", (await text(page, ".two-clubs-status")) === "Choose two different clubs.");
  check("two clubs: the table is cleared once clubs match", (await page.locator(".two-clubs-result table").count()) === 0);
  check("two clubs: no console errors or failed requests", page.problems.length === 0, page.problems.join(" | "));
  await page.close();
}

// ============ 8. Accessibility scan (axe) in light and dark ============
for (const dark of [false, true]) {
  for (const url of ["/", "/players/1105/", "/about/", "/two-clubs/"]) {
    const page = await newPage({ dark });
    await page.goto(BASE + url);
    if (url === "/") {
      const i = page.getByRole("combobox", { name: "Search players" });
      await i.pressSequentially("ablett"); await page.locator(".search-list a").first().waitFor();
    }
    if (url === "/two-clubs/") {
      await page.selectOption("#two-clubs-a", "geelong");
      await page.selectOption("#two-clubs-b", "gold-coast");
      await page.locator(".two-clubs-result tbody tr").first().waitFor();
    }
    await page.addScriptTag({ path: axePath });
    const r = await page.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }));
    const v = r.violations.map((x) => `${x.id} (${x.impact}) x${x.nodes.length}: ${x.nodes[0].target.join(" ")}`);
    check(`axe ${dark ? "dark" : "light"} ${url}: no violations`, v.length === 0, v.join(" | "));
    await page.close();
  }
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
