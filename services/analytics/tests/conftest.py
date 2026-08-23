from __future__ import annotations

import polars as pl
import pytest


@pytest.fixture
def historical_player_weeks() -> pl.DataFrame:
    records: list[dict[str, object]] = []
    for season in (2023, 2024, 2025):
        for player_number in range(4):
            player_id = f"player-{player_number}"
            for week in range(1, 11):
                opportunity = 8 + player_number * 2 + week * 0.4
                records.append(
                    {
                        "player_id": player_id,
                        "season": season,
                        "week": week,
                        "position": "RB",
                        "fantasy_points": opportunity + (season - 2023) * 0.7,
                        "snap_share": 0.45 + week * 0.02,
                        "targets": 2 + player_number + week * 0.1,
                        "carries": 7 + player_number * 2 + week * 0.2,
                        "receptions": 1 + player_number * 0.3,
                        "passing_attempts": 0,
                        "red_zone_touches": week % 3,
                        "age": 22 + player_number,
                        "draft_number": 20 + player_number * 30,
                    }
                )
    return pl.DataFrame(records)
