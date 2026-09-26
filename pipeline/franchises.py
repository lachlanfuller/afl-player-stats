"""Club naming rules and season overrides that the raw data cannot supply.

Everything the refresh script assumes about club names and finals lives here, so a change
in the source data is a one-line edit in one place.
"""
import re

# The source file's `Team` column holds one label per franchise (for example South Melbourne
# and Sydney share the label "Sydney"), but two labels are not the name people use today.
# Only labels that need changing are listed; every other label is shown as it is.
DISPLAY_NAMES = {
    "Footscray": "Western Bulldogs",
    "GWS": "Greater Western Sydney",
}

# Round labels that are not a plain round number. Anything else that is not a number
# stops the refresh, so a new finals label in future data is noticed rather than
# quietly counted as a home-and-away game.
FINAL_ROUNDS = {"QF", "EF", "SF", "PF", "GF", "Wildcard Final"}

# Seasons with no grand final. The final series was a round robin and the premier topped it.
# 1897: Essendon won all three final-series games.
# 1924: Essendon and Richmond both won two of three; Essendon had the better percentage.
# Both match the published premiers list. Players from the premier club who played at
# least one final that season are credited with the premiership. If the source data ever
# gains a grand final row for one of these seasons, the data wins and the override is ignored.
NO_GRAND_FINAL_PREMIERS = {
    1897: "Essendon",
    1924: "Essendon",
}


def display_name(label: str) -> str:
    return DISPLAY_NAMES.get(label, label)


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
