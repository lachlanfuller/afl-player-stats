#!/usr/bin/env python3
"""Refresh the site's data.

Downloads fitzRoy's cached AFL Tables player stats (one row per player per game), cleans them,
and writes the static JSON the site reads to data/build/.

    python pipeline/refresh.py                  # download the latest file and rebuild everything
    python pipeline/refresh.py --use-cached     # rebuild from the file already in data/raw/
    python pipeline/refresh.py --source FILE    # rebuild from a local parquet file

Outputs (data/build/):
    meta.json            build date, source, counts, rows dropped, premier of each season
    franchises.json      one entry per franchise, with the club names it has played under
    players-index.json   one small record per player, used for search and the two-team query
    players/<id>.json    the full record for one player
"""
from __future__ import annotations

import argparse
import itertools
import json
import shutil
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from franchises import FINAL_ROUNDS, NO_GRAND_FINAL_PREMIERS, display_name, slugify

SOURCE_URL = "https://github.com/jimmyday12/fitzroy_data/releases/download/data/afltables_player_stats.parquet"
ROOT = Path(__file__).resolve().parent.parent
RAW_PATH = ROOT / "data" / "raw" / "afltables_player_stats.parquet"
OUT_DIR = ROOT / "data" / "build"


class DataError(Exception):
    """The source data no longer matches an assumption this script relies on."""


# --------------------------------------------------------------------------------------
# Getting the file
# --------------------------------------------------------------------------------------

def fetch_source(source: str | None, use_cached: bool) -> tuple[Path, str]:
    """Return (local path, label for meta.json). Downloads unless a local file was given."""
    if source and not source.startswith(("http://", "https://")):
        path = Path(source)
        if not path.exists():
            raise DataError(f"Source file not found: {path}")
        return path, str(path)

    url = source or SOURCE_URL
    if use_cached and RAW_PATH.exists():
        return RAW_PATH, f"{url} (cached copy)"

    RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
    partial = RAW_PATH.with_suffix(".download")
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, partial)
    partial.replace(RAW_PATH)
    return RAW_PATH, url


# --------------------------------------------------------------------------------------
# Building
# --------------------------------------------------------------------------------------

def build(source_path: Path, out_dir: Path, source_label: str = "") -> dict:
    """Clean the source file and write every output file. Returns the contents of meta.json."""
    con = duckdb.connect()

    def one(sql: str):
        return con.execute(sql).fetchone()[0]

    sql_path = str(source_path).replace("'", "''")
    con.execute(f"CREATE TABLE raw AS SELECT * FROM read_parquet('{sql_path}')")

    raw_rows = one("SELECT count(*) FROM raw")
    last_game = one("SELECT max(Date) FROM raw")
    dropped_no_id = one("SELECT count(*) FROM raw WHERE ID IS NULL")

    # ---- One clean row per player per game ------------------------------------------
    con.execute("""
        CREATE TABLE games AS
        SELECT
            ID::INTEGER                                                     AS player_id,
            Player                                                          AS player,
            Season::INTEGER                                                 AS season,
            Round                                                           AS round_label,
            Date                                                            AS game_date,
            "Playing.for"                                                   AS club,
            Team                                                            AS franchise_label,
            CASE WHEN "Playing.for" = "Home.team" THEN "Away.team" ELSE "Home.team" END AS opponent,
            CASE WHEN "Playing.for" = "Home.team" THEN "Home.score" ELSE "Away.score" END AS points_for,
            CASE WHEN "Playing.for" = "Home.team" THEN "Away.score" ELSE "Home.score" END AS points_against,
            COALESCE(Goals, 0)                                              AS goals
        FROM raw
        WHERE ID IS NOT NULL
        QUALIFY row_number() OVER (PARTITION BY ID, Date, "Playing.for" ORDER BY Goals DESC NULLS LAST) = 1
    """)
    used_rows = one("SELECT count(*) FROM games")
    dropped_duplicates = raw_rows - dropped_no_id - used_rows

    # ---- Checks on assumptions the rest of the script depends on --------------------
    side_mismatch = one("""
        SELECT count(*) FROM raw
        WHERE ID IS NOT NULL
          AND "Playing.for" IS DISTINCT FROM "Home.team"
          AND "Playing.for" IS DISTINCT FROM "Away.team"
    """)
    if side_mismatch:
        raise DataError(f"{side_mismatch} rows where Playing.for is neither the home nor the away team")
    if one("SELECT count(*) FROM games WHERE points_for IS NULL OR points_against IS NULL"):
        raise DataError("Some games have no score, so win/loss cannot be worked out")
    if one("SELECT count(*) FROM games WHERE franchise_label IS NULL"):
        raise DataError("Some rows have no Team label, so their franchise is unknown")
    unknown_rounds = {
        r[0] for r in con.execute(
            "SELECT DISTINCT round_label FROM games WHERE try_cast(round_label AS INTEGER) IS NULL"
        ).fetchall()
    } - FINAL_ROUNDS
    if unknown_rounds:
        raise DataError(f"Unrecognised round labels {sorted(unknown_rounds)}: add them to FINAL_ROUNDS if they are finals")

    # ---- Franchises: one per Team label, named for display --------------------------
    club_rows = con.execute("""
        SELECT club, franchise_label, min(season), max(season)
        FROM games GROUP BY club, franchise_label ORDER BY min(season), club
    """).fetchall()
    label_of_club: dict[str, str] = {}
    for club, label, _, _ in club_rows:
        if label_of_club.setdefault(club, label) != label:
            raise DataError(f"Club {club!r} appears under more than one franchise label")

    franchises: dict[str, dict] = {}  # keyed by Team label
    for club, label, first, last in club_rows:
        f = franchises.setdefault(label, {"id": slugify(display_name(label)), "name": display_name(label), "clubs": []})
        f["clubs"].append({"name": club, "firstSeason": first, "lastSeason": last})
    if len({f["id"] for f in franchises.values()}) != len(franchises):
        raise DataError("Two franchises ended up with the same id")
    franchise_id_of_club = {club: franchises[label]["id"] for club, label in label_of_club.items()}
    franchise_name = {f["id"]: f["name"] for f in franchises.values()}

    con.execute("CREATE TABLE club_franchise (club VARCHAR, franchise VARCHAR)")
    con.executemany("INSERT INTO club_franchise VALUES (?, ?)", list(franchise_id_of_club.items()))

    con.execute("""
        CREATE TABLE g AS
        SELECT x.*,
               cf.franchise  AS franchise,
               ocf.franchise AS opp_franchise,
               x.points_for >  x.points_against AS win,
               x.points_for <  x.points_against AS loss,
               x.points_for =  x.points_against AS draw,
               try_cast(x.round_label AS INTEGER) IS NULL AS is_final
        FROM games x
        JOIN club_franchise cf      ON cf.club  = x.club
        LEFT JOIN club_franchise ocf ON ocf.club = x.opponent
    """)
    if one("SELECT count(*) FROM g") != used_rows:
        raise DataError("Joining franchises changed the number of game rows")
    if one("SELECT count(*) FROM g WHERE opp_franchise IS NULL"):
        raise DataError("Some opponents are not a club that appears in the data")

    # ---- Premiers -------------------------------------------------------------------
    # Deciding grand final = the latest one in the season (1948, 1977 and 2010 had replays).
    con.execute("CREATE TABLE gf_date AS SELECT season, max(game_date) AS game_date FROM g WHERE round_label = 'GF' GROUP BY season")
    con.execute("""
        CREATE TABLE premiers AS
        SELECT DISTINCT g.season, g.club
        FROM g JOIN gf_date d ON d.season = g.season AND d.game_date = g.game_date
        WHERE g.round_label = 'GF' AND g.points_for > g.points_against
    """)
    seasons_with_gf = {r[0] for r in con.execute("SELECT season FROM gf_date").fetchall()}
    for season, club in NO_GRAND_FINAL_PREMIERS.items():
        if season in seasons_with_gf:
            continue  # the data now has a grand final, so it decides
        if not one(f"SELECT count(*) FROM g WHERE season = {int(season)} AND club = '{club}'"):
            raise DataError(f"Override names {club} as {season} premier, but they have no games that season")
        con.execute("INSERT INTO premiers VALUES (?, ?)", [season, club])
    drawn_gf = [r[0] for r in con.execute("""
        SELECT DISTINCT g.season FROM g JOIN gf_date d ON d.season = g.season AND d.game_date = g.game_date
        WHERE g.round_label = 'GF' AND g.points_for = g.points_against
    """).fetchall()]
    if drawn_gf:
        print(f"Note: the deciding grand final was drawn in {drawn_gf}; no premier is recorded until a replay is played")

    # A player is credited if they played in the deciding grand final for the winning club.
    # For seasons with no grand final, if they played in any final for the premier club.
    con.execute("""
        CREATE TABLE premiership_players AS
        SELECT DISTINCT g.player_id, g.season, g.club
        FROM g
        JOIN gf_date d  ON d.season = g.season AND d.game_date = g.game_date
        JOIN premiers p ON p.season = g.season AND p.club = g.club
        WHERE g.round_label = 'GF'
        UNION
        SELECT DISTINCT g.player_id, g.season, g.club
        FROM g
        JOIN premiers p ON p.season = g.season AND p.club = g.club
        WHERE g.is_final AND g.season NOT IN (SELECT season FROM gf_date)
    """)

    # ---- Aggregates -----------------------------------------------------------------
    con.execute("""
        CREATE TABLE season_rows AS
        SELECT g.player_id, g.season, g.club, g.franchise,
               count(*)                                   AS games,
               sum(g.goals)                               AS goals,
               sum(g.win::INT)                            AS wins,
               sum(g.loss::INT)                           AS losses,
               sum(g.draw::INT)                           AS draws,
               sum(g.is_final::INT)                       AS finals_games,
               sum((g.is_final AND g.win)::INT)           AS finals_wins,
               sum((g.is_final AND g.loss)::INT)          AS finals_losses,
               sum((g.is_final AND g.draw)::INT)          AS finals_draws,
               bool_or(pp.player_id IS NOT NULL)          AS premiership,
               min(g.game_date)                           AS first_date
        FROM g
        LEFT JOIN premiership_players pp
               ON pp.player_id = g.player_id AND pp.season = g.season AND pp.club = g.club
        GROUP BY g.player_id, g.season, g.club, g.franchise
    """)

    names = dict(con.execute("SELECT player_id, any_value(player) FROM g GROUP BY player_id").fetchall())

    career_rows = con.execute("""
        SELECT player_id, min(season), max(season),
               sum(games), sum(goals), sum(wins), sum(losses), sum(draws),
               sum(finals_games), sum(finals_wins), sum(finals_losses), sum(finals_draws)
        FROM season_rows GROUP BY player_id ORDER BY player_id
    """).fetchall()

    season_by_player = _group(con.execute("""
        SELECT player_id, season, club, franchise, games, goals, wins, losses, draws, finals_games, premiership
        FROM season_rows ORDER BY player_id, season, first_date
    """).fetchall())

    club_by_player = _group(con.execute("""
        SELECT player_id, franchise, min(season), max(season), sum(games), sum(goals),
               sum(wins), sum(losses), sum(draws), list(DISTINCT club ORDER BY club)
        FROM season_rows GROUP BY player_id, franchise ORDER BY player_id, min(season), franchise
    """).fetchall())

    opp_by_player = _group(con.execute("""
        SELECT player_id, opp_franchise, count(*), sum(goals),
               sum(win::INT), sum(loss::INT), sum(draw::INT)
        FROM g GROUP BY player_id, opp_franchise ORDER BY player_id, count(*) DESC, opp_franchise
    """).fetchall())

    # ---- Write ----------------------------------------------------------------------
    out_dir.mkdir(parents=True, exist_ok=True)
    players_dir = out_dir / "players"
    if players_dir.exists():
        shutil.rmtree(players_dir)
    players_dir.mkdir()

    index = []
    for (pid, first, last, games, goals, wins, losses, draws,
         f_games, f_wins, f_losses, f_draws) in career_rows:
        seasons = season_by_player.get(pid, [])
        clubs = [
            {
                "franchise": fid, "name": franchise_name[fid], "playedAs": played_as,
                "firstSeason": c_first, "lastSeason": c_last,
                "games": c_games, "goals": c_goals, "wins": c_w, "losses": c_l, "draws": c_d,
            }
            for (_, fid, c_first, c_last, c_games, c_goals, c_w, c_l, c_d, played_as) in club_by_player[pid]
        ]
        opponents = [
            {
                "franchise": fid, "name": franchise_name[fid],
                "games": o_games, "goals": o_goals, "wins": o_w, "losses": o_l, "draws": o_d,
            }
            for (_, fid, o_games, o_goals, o_w, o_l, o_d) in opp_by_player[pid]
        ]
        record = {
            "id": pid,
            "name": names[pid],
            "firstSeason": first,
            "lastSeason": last,
            "career": {"games": games, "goals": goals, "wins": wins, "losses": losses, "draws": draws},
            "finals": {"games": f_games, "wins": f_wins, "losses": f_losses, "draws": f_draws},
            "premierships": [{"season": s[1], "club": s[2]} for s in seasons if s[10]],
            "clubs": clubs,
            "opponents": opponents,
            "seasons": [
                {
                    "season": s[1], "club": s[2], "franchise": s[3],
                    "games": s[4], "goals": s[5], "wins": s[6], "losses": s[7], "draws": s[8],
                    "finalsGames": s[9], "premiership": bool(s[10]),
                }
                for s in seasons
            ],
        }
        _dump(record, players_dir / f"{pid}.json")
        index.append({
            "id": pid, "name": names[pid], "first": first, "last": last, "games": games,
            "clubs": {c["franchise"]: c["games"] for c in clubs},
        })

    franchise_list = sorted(
        (
            {
                "id": f["id"], "name": f["name"],
                "firstSeason": min(c["firstSeason"] for c in f["clubs"]),
                "lastSeason": max(c["lastSeason"] for c in f["clubs"]),
                "clubs": f["clubs"],
            }
            for f in franchises.values()
        ),
        key=lambda f: f["name"],
    )
    _dump(franchise_list, out_dir / "franchises.json")
    _dump(index, out_dir / "players-index.json")

    meta = {
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source_label or str(source_path),
        "sourceLastGame": str(last_game),
        "firstSeason": one("SELECT min(season) FROM g"),
        "lastSeason": one("SELECT max(season) FROM g"),
        "rows": {
            "source": raw_rows,
            "used": used_rows,
            "droppedNoPlayerId": dropped_no_id,
            "droppedDuplicates": dropped_duplicates,
        },
        "players": len(index),
        "matches": one("SELECT count(*) FROM (SELECT DISTINCT Date, \"Home.team\", \"Away.team\" FROM raw)"),
        "franchises": len(franchise_list),
        "premiers": {
            str(season): club
            for season, club in con.execute("SELECT season, club FROM premiers ORDER BY season").fetchall()
        },
    }
    _dump(meta, out_dir / "meta.json")
    return meta


def _group(rows: list[tuple]) -> dict[int, list[tuple]]:
    """Group rows (already ordered by player id in the first column) into {player_id: [rows]}."""
    return {pid: list(items) for pid, items in itertools.groupby(rows, key=lambda r: r[0])}


def _dump(obj, path: Path) -> None:
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


# --------------------------------------------------------------------------------------
# Command line
# --------------------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", help="local parquet file or URL (default: fitzRoy's published file)")
    parser.add_argument("--use-cached", action="store_true", help="reuse data/raw/ instead of downloading")
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="output folder (default: data/build)")
    args = parser.parse_args()

    try:
        path, label = fetch_source(args.source, args.use_cached)
        meta = build(path, args.out, label)
    except DataError as err:
        print(f"Refresh stopped: {err}", file=sys.stderr)
        return 1

    rows = meta["rows"]
    print(f"Built {meta['players']:,} players, {meta['matches']:,} matches, {meta['franchises']} franchises "
          f"({meta['firstSeason']} to {meta['lastSeason']}); last game in file: {meta['sourceLastGame']}")
    print(f"Rows: {rows['source']:,} in, {rows['used']:,} used, "
          f"{rows['droppedNoPlayerId']} dropped (no player id), {rows['droppedDuplicates']} dropped (duplicate)")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
