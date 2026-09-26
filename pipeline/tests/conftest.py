import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import refresh  # noqa: E402


@pytest.fixture(scope="session")
def source_path():
    """The parquet file to test against. Downloads it once if data/raw/ does not have it."""
    path, _ = refresh.fetch_source(None, use_cached=True)
    return path


@pytest.fixture(scope="session")
def built(source_path, tmp_path_factory):
    """Run the full refresh into a temporary folder and return helpers to read the output."""
    out = tmp_path_factory.mktemp("build")
    meta = refresh.build(source_path, out)

    class Built:
        dir = out
        meta_ = meta

        @staticmethod
        def load(name):
            return json.loads((out / name).read_text(encoding="utf-8"))

        @staticmethod
        def player(pid):
            return json.loads((out / "players" / f"{pid}.json").read_text(encoding="utf-8"))

    return Built
