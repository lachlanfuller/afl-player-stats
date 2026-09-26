# AFL Player Stats

A website for searching AFL players and looking up their careers: games, goals, clubs played for and against, win/loss record, finals record and premierships. It also finds every player who has played for two chosen clubs.

The site is static. A refresh script turns [fitzRoy](https://github.com/jimmyday12/fitzRoy)'s published AFL Tables data into JSON files, and the site reads those files. There is no server or database.

## Refreshing the data

```
pip install -r pipeline/requirements.txt
python pipeline/refresh.py
```

This downloads the latest file (about 12 MB, one row per player per game since 1897), cleans it and writes `data/build/`. It takes about 15 seconds. Useful variations:

```
python pipeline/refresh.py --use-cached        # rebuild from data/raw/ without downloading
python pipeline/refresh.py --source FILE.parquet
```

fitzRoy updates on Tuesday mornings (AEST) after each round. The plan for the MVP is to refresh once now, once after fitzRoy's update on Tuesday 29 Sep 2026 to pick up the finals, then leave the data as it is until March 2027. `data/build/meta.json` shows the last game in the file (`sourceLastGame`).

If the source data stops matching an assumption the script relies on (an unfamiliar round label, a club with two franchise labels, a game with no score), the refresh stops with a plain message instead of building wrong numbers.

## The site

An [Astro](https://astro.build) site in `site/` that reads the refresh output. It needs Node 22.12 or newer. Run the refresh first (above), then:

```
cd site
npm install
npm run dev        # local preview with live reload
npm run build      # builds every page into site/dist/ (about 25 seconds)
```

The build makes one page per player (13,000+), the home page with search, and an About page. Player search runs in the browser against a small index (0.2 MB compressed) that loads the first time the search box is used.

To serve from a sub-path (GitHub Pages project sites, for example), build with `SITE_BASE=/afl-player-stats/`.

## Tests

Data pipeline:

```
python -m pytest pipeline/tests
```

The tests rebuild everything and check it against the source file with separate queries: row counts reconcile, every player's record adds up, one player's full record (Gary Ablett, ID 1105) is fixed, the premier of every season from 1897 to 2025 matches a published list (`pipeline/tests/premiers_reference.txt`), and the two-team query matches a direct query on the source.

After each grand final, add the season's premier to `premiers_reference.txt`.

Site:

```
cd site
npm test                 # search ranking and formatting
npm run build && npm run e2e
```

`npm run e2e` opens the built site in Chromium and checks search (including keyboard use), the numbers on a known player's page, table sorting, the mobile layout, dark mode and accessibility (axe). Run `npx playwright install chromium` once first, or set `CHROMIUM_PATH` to an existing Chromium. Screenshots go to `site/e2e-output/`.

## What the refresh writes (`data/build/`)

| File | Contents |
| --- | --- |
| `players-index.json` | One small record per player (`id`, `name`, `first`, `last`, `games`, `clubs` as franchise to games). Used for search and for the two-team query. |
| `players/<id>.json` | One player's full record: career totals, finals record, premierships, games by club, games against each opponent, and season by season. |
| `franchises.json` | The 20 franchises, with every club name each has played under. |
| `meta.json` | Build date, source, row counts, rows dropped, and the premier of each season. |

## How the data is interpreted

- **Franchises.** The source groups renamed clubs under one label, and the site uses those groups: South Melbourne with Sydney, Footscray with the Western Bulldogs, Kangaroos with North Melbourne, Brisbane Bears with Brisbane Lions. Fitzroy and University stay separate. Display names are in `pipeline/franchises.py`. A player's record still shows the name used at the time.
- **Wins, losses and draws.** Worked out from the two scores in each match. Draws are counted separately.
- **Finals.** Any round that is not a round number: QF, EF, SF, PF, GF and Wildcard Final.
- **Premierships.** A player is credited if they played in the deciding grand final for the winning club. Three seasons had replays (1948, 1977, 2010), and the later game decides. 1897 and 1924 had a round-robin final series and no grand final, so players from that season's premier (Essendon) who played at least one final are credited.
- **Players with the same name.** Everything is keyed by the source's player ID, so the two Gary Abletts are separate players.
- **Rows dropped.** Rows with no player ID (170 at last count, all from 2025 and 2026) and exact duplicate rows (2). Both counts are in `meta.json`.
- **A season in progress** has no premier until its grand final is in the file.
