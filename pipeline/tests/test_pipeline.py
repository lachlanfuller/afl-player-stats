"""Checks on the refresh output.

Where possible the expected value is worked out straight from the source file with separate
SQL, not with the code under test, so a bug in refresh.py cannot cancel itself out.
"""
import collections
import json
from pathlib import Path

import duckdb
import pytest

import refresh

HERE = Path(__file__).parent

# Gary Ablett (Geelong, Gold Coast), player ID 1105. He retired in 2020, so his record is fixed.
ABLETT_JR = 1105
# Players who had played for both Geelong and Gold Coast when the plan was written (26 Sep 2026).
GEELONG_AND_GOLD_COAST = {12687, 1105, 12053, 12499, 12236, 12099, 12010, 4140, 11909}


@pytest.fixture(scope="module")
def raw(source_path):
    con = duckdb.connect()
    sql_path = str(source_path).replace("'", "''")
    con.execute(f"CREATE VIEW raw AS SELECT * FROM read_parquet('{sql_path}')")
    return con


@pytest.fixture(scope="module")
def all_players(built):
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted((built.dir / "players").glob("*.json"))]


# ---- Totals reconcile with the source ---------------------------------------------------

def test_source_rows_are_all_accounted_for(built):
    rows = built.meta_["rows"]
    assert rows["source"] == rows["used"] + rows["droppedNoPlayerId"] + rows["droppedDuplicates"]


def test_games_and_goals_match_source(built, raw, all_players):
    games, goals = raw.execute("""
        SELECT count(*), sum(g) FROM (
            SELECT any_value(Goals) AS g FROM raw WHERE ID IS NOT NULL GROUP BY ID, Date, "Playing.for"
        )
    """).fetchone()
    assert sum(p["career"]["games"] for p in all_players) == games
    assert sum(p["career"]["goals"] for p in all_players) == goals
    assert len(all_players) == raw.execute("SELECT count(DISTINCT ID) FROM raw").fetchone()[0]


def test_every_player_record_adds_up(all_players):
    for p in all_players:
        c, f = p["career"], p["finals"]
        label = f"{p['name']} ({p['id']})"
        assert c["wins"] + c["losses"] + c["draws"] == c["games"], label
        assert f["wins"] + f["losses"] + f["draws"] == f["games"], label
        assert f["games"] <= c["games"], label
        for part in ("clubs", "opponents", "seasons"):
            assert sum(x["games"] for x in p[part]) == c["games"], f"{label} {part} games"
            assert sum(x["goals"] for x in p[part]) == c["goals"], f"{label} {part} goals"
        for pr in p["premierships"]:
            season = next(s for s in p["seasons"] if s["season"] == pr["season"] and s["club"] == pr["club"])
            assert season["finalsGames"] >= 1, f"{label} premiership without a final"
        assert len({pr["season"] for pr in p["premierships"]}) == len(p["premierships"]), label


def test_search_index_matches_player_records(built, all_players):
    index = {row["id"]: row for row in built.load("players-index.json")}
    assert len(index) == len(all_players)
    for p in all_players:
        row = index[p["id"]]
        assert row["name"] == p["name"]
        assert (row["first"], row["last"], row["games"]) == (p["firstSeason"], p["lastSeason"], p["career"]["games"])
        assert sum(row["clubs"].values()) == row["games"]


# ---- A known player, end to end ---------------------------------------------------------

def test_gary_ablett_jr(built):
    p = built.player(ABLETT_JR)
    assert p["name"] == "Gary Ablett"
    assert (p["firstSeason"], p["lastSeason"]) == (2002, 2020)
    assert p["career"] == {"games": 357, "goals": 445, "wins": 192, "losses": 163, "draws": 2}
    assert (p["finals"]["games"], p["finals"]["wins"]) == (25, 14)
    assert p["premierships"] == [{"season": 2007, "club": "Geelong"}, {"season": 2009, "club": "Geelong"}]
    assert [c["name"] for c in p["clubs"]] == ["Geelong", "Gold Coast"]
    assert sum(c["games"] for c in p["clubs"]) == 357


def test_namesakes_are_separate_players(built):
    index = built.load("players-index.json")
    ableth_entries = [r for r in index if r["name"] == "Gary Ablett"]
    assert {r["id"] for r in ableth_entries} == {567, 1105}
    assert {(r["first"], r["last"]) for r in ableth_entries} == {(1982, 1996), (2002, 2020)}


# ---- Premiers ---------------------------------------------------------------------------

def load_reference():
    ref = {}
    for line in (HERE / "premiers_reference.txt").read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#"):
            season, club = line.split(" ", 1)
            ref[season] = club
    return ref


def test_premiers_match_published_list(built):
    ref = load_reference()
    ours = built.meta_["premiers"]
    assert {s: ours.get(s) for s in ref} == ref


def test_premiership_squads_are_a_plausible_size(all_players):
    per_season = collections.Counter(pr["season"] for p in all_players for pr in p["premierships"])
    assert per_season, "no premiership players found"
    for season, n in per_season.items():
        assert 18 <= n <= 25, f"{season}: {n} players credited"


def test_no_premier_until_grand_final_is_played(built, raw):
    """A season with finals in the data but no grand final yet must not have a premier."""
    last = built.meta_["lastSeason"]
    has_gf = raw.execute(f"SELECT count(*) FROM raw WHERE Season = {last} AND Round = 'GF'").fetchone()[0]
    if not has_gf:
        assert str(last) not in built.meta_["premiers"]


# ---- Franchises and the two-team query --------------------------------------------------

def test_franchise_names_and_grouping(built):
    by_name = {f["name"]: f for f in built.load("franchises.json")}
    for expected in ("Western Bulldogs", "Greater Western Sydney", "Sydney", "North Melbourne",
                     "Brisbane Lions", "Fitzroy", "University"):
        assert expected in by_name, expected
    assert "Footscray" not in by_name and "GWS" not in by_name
    assert {c["name"] for c in by_name["Sydney"]["clubs"]} == {"South Melbourne", "Sydney"}
    assert {c["name"] for c in by_name["Western Bulldogs"]["clubs"]} == {"Footscray", "Western Bulldogs"}
    assert {c["name"] for c in by_name["North Melbourne"]["clubs"]} == {"North Melbourne", "Kangaroos"}
    assert {c["name"] for c in by_name["Brisbane Lions"]["clubs"]} == {"Brisbane Bears", "Brisbane Lions"}
    assert {c["name"] for c in by_name["Fitzroy"]["clubs"]} == {"Fitzroy"}  # not merged into Brisbane


def test_two_team_query_matches_source(built, raw):
    index = built.load("players-index.json")
    ours = {r["id"] for r in index if "geelong" in r["clubs"] and "gold-coast" in r["clubs"]}
    expected = {r[0] for r in raw.execute("""
        SELECT ID FROM raw WHERE ID IS NOT NULL AND Team IN ('Geelong', 'Gold Coast')
        GROUP BY ID HAVING count(DISTINCT Team) = 2
    """).fetchall()}
    assert ours == expected
    assert GEELONG_AND_GOLD_COAST <= ours


def test_two_team_query_uses_franchise_not_club_name(built):
    """Bulldogs players from the Footscray years must count for the Western Bulldogs."""
    index = built.load("players-index.json")
    both = [r for r in index if "western-bulldogs" in r["clubs"] and "sydney" in r["clubs"]]
    assert both, "expected at least one player with games for both Western Bulldogs and Sydney"


# ---- Guards -----------------------------------------------------------------------------

def test_unknown_round_label_stops_the_refresh(source_path, tmp_path):
    changed = tmp_path / "changed.parquet"
    sql_path = str(source_path).replace("'", "''")
    con = duckdb.connect()
    con.execute(f"""
        COPY (SELECT * REPLACE (CASE WHEN Round = 'GF' AND Season = 2019 THEN 'Grand Final 2' ELSE Round END AS Round)
              FROM read_parquet('{sql_path}')) TO '{changed}' (FORMAT PARQUET)
    """)
    with pytest.raises(refresh.DataError, match="Unrecognised round labels"):
        refresh.build(changed, tmp_path / "out")
