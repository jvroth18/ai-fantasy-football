"""Rolling-origin backtests with no future-season training data."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import polars as pl

from .features import FEATURE_COLUMNS, build_lagged_features
from .model import QuantileProjectionModel


@dataclass(frozen=True)
class SeasonBacktest:
    season: int
    training_seasons: tuple[int, ...]
    samples: int
    model_mae: float
    baseline_mae: float
    rmse: float
    interval_coverage: float

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def rolling_season_backtest(frame: pl.DataFrame) -> list[SeasonBacktest]:
    featured = build_lagged_features(frame)
    seasons = sorted(featured.get_column("season").unique().to_list())
    results: list[SeasonBacktest] = []

    for season in seasons[1:]:
        training = featured.filter(pl.col("season") < season)
        testing = featured.filter(pl.col("season") == season)
        if training.height < 20 or testing.is_empty():
            continue

        model = QuantileProjectionModel().fit(
            training.select(FEATURE_COLUMNS), training.get_column("fantasy_points")
        )
        predictions = model.predict(testing.select(FEATURE_COLUMNS))
        actual = testing.get_column("fantasy_points").to_numpy()
        median = np.array([prediction.p50 for prediction in predictions])
        low = np.array([prediction.p10 for prediction in predictions])
        high = np.array([prediction.p90 for prediction in predictions])
        baseline = testing.get_column("rolling_points_5").to_numpy()

        results.append(
            SeasonBacktest(
                season=int(season),
                training_seasons=tuple(
                    int(value) for value in training.get_column("season").unique().sort().to_list()
                ),
                samples=testing.height,
                model_mae=round(float(np.mean(np.abs(actual - median))), 4),
                baseline_mae=round(float(np.mean(np.abs(actual - baseline))), 4),
                rmse=round(float(np.sqrt(np.mean(np.square(actual - median)))), 4),
                interval_coverage=round(float(np.mean((actual >= low) & (actual <= high))), 4),
            )
        )

    return results
