from pathlib import Path

from ai_fantasy_football_analytics.manifest import load_seed_manifest


def test_seed_manifest_expands_required_history_through_current_season() -> None:
    path = Path(__file__).parents[1] / "config" / "data_seed.json"
    requests = load_seed_manifest(path, 2026)
    stats = next(request for request in requests if request.name == "player_stats")
    players = next(request for request in requests if request.name == "players")

    assert stats.seasons[0] == 2012
    assert stats.seasons[-1] == 2026
    assert stats.asset_pattern == r"player_stats_{season}\.parquet"
    assert stats.publication_lag_seasons == 2
    assert players.seasons == ()
