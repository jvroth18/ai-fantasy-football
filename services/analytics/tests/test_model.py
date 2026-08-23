from __future__ import annotations

from pathlib import Path

import polars as pl

from ai_fantasy_football_analytics.features import FEATURE_COLUMNS, build_lagged_features
from ai_fantasy_football_analytics.model import QuantileProjectionModel


def test_quantiles_are_ordered_and_artifact_round_trips(
    historical_player_weeks: pl.DataFrame, tmp_path: Path
) -> None:
    featured = build_lagged_features(historical_player_weeks)
    model = QuantileProjectionModel().fit(
        featured.select(FEATURE_COLUMNS), featured.get_column("fantasy_points")
    )
    artifact = tmp_path / "rb-projection.joblib"
    model.save(artifact)
    loaded = QuantileProjectionModel.load(artifact)
    projections = loaded.predict(featured.tail(5).select(FEATURE_COLUMNS))

    assert len(projections) == 5
    assert all(value.p10 <= value.p50 <= value.p90 for value in projections)


def test_training_rejects_insufficient_history() -> None:
    frame = pl.DataFrame({column: [0.0] for column in FEATURE_COLUMNS})
    target = pl.Series("fantasy_points", [1.0])

    try:
        QuantileProjectionModel().fit(frame, target)
    except ValueError as error:
        assert "At least 20" in str(error)
    else:
        raise AssertionError("Expected insufficient-history failure")
