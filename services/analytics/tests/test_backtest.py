from __future__ import annotations

from ai_fantasy_football_analytics.backtest import rolling_season_backtest


def test_rolling_backtest_uses_only_earlier_seasons(historical_player_weeks) -> None:
    results = rolling_season_backtest(historical_player_weeks)

    assert [result.season for result in results] == [2024, 2025]
    assert results[0].training_seasons == (2023,)
    assert results[1].training_seasons == (2023, 2024)
    assert all(result.samples == 40 for result in results)
    assert all(result.model_mae >= 0 for result in results)
    assert all(0 <= result.interval_coverage <= 1 for result in results)
