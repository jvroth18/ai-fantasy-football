from __future__ import annotations

import polars as pl

from ai_fantasy_football_analytics.features import build_lagged_features


def test_current_and_future_targets_do_not_change_current_features(
    historical_player_weeks: pl.DataFrame,
) -> None:
    original = build_lagged_features(historical_player_weeks)
    changed = historical_player_weeks.with_columns(
        pl.when((pl.col("player_id") == "player-0") & (pl.col("season") == 2025))
        .then(pl.col("fantasy_points") + 1_000)
        .otherwise(pl.col("fantasy_points"))
        .alias("fantasy_points")
    )
    rebuilt = build_lagged_features(changed)

    selector = (
        (pl.col("player_id") == "player-0") & (pl.col("season") == 2025) & (pl.col("week") == 1)
    )
    original_row = original.filter(selector).select("rolling_points_5").item()
    changed_row = rebuilt.filter(selector).select("rolling_points_5").item()
    assert original_row == changed_row


def test_first_game_has_zero_history(historical_player_weeks: pl.DataFrame) -> None:
    featured = build_lagged_features(historical_player_weeks)
    first = featured.filter(pl.col("player_id") == "player-0").row(0, named=True)

    assert first["previous_points"] == 0.0
    assert first["games_history"] == 0.0
