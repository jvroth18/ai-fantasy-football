"""Position-aware, calibrated fantasy projection models."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import polars as pl
from sklearn.ensemble import HistGradientBoostingRegressor

from .features import FEATURE_COLUMNS


@dataclass(frozen=True)
class Projection:
    p10: float
    p50: float
    p90: float


class QuantileProjectionModel:
    """Three quantile regressors with crossing corrected at prediction time."""

    def __init__(self, random_state: int = 42) -> None:
        self.random_state = random_state
        self.models = {
            quantile: HistGradientBoostingRegressor(
                loss="quantile",
                quantile=quantile,
                max_iter=120,
                learning_rate=0.06,
                max_leaf_nodes=15,
                l2_regularization=0.2,
                random_state=random_state,
            )
            for quantile in (0.1, 0.5, 0.9)
        }

    def fit(self, features: pl.DataFrame, target: pl.Series) -> QuantileProjectionModel:
        if features.height < 20:
            raise ValueError("At least 20 historical player-weeks are required to train")
        matrix = features.select(FEATURE_COLUMNS).to_numpy()
        values = target.to_numpy()
        for model in self.models.values():
            model.fit(matrix, values)
        return self

    def predict(self, features: pl.DataFrame) -> list[Projection]:
        matrix = features.select(FEATURE_COLUMNS).to_numpy()
        raw = np.column_stack([self.models[q].predict(matrix) for q in (0.1, 0.5, 0.9)])
        ordered = np.sort(raw, axis=1)
        return [
            Projection(
                p10=round(float(row[0]), 4),
                p50=round(float(row[1]), 4),
                p90=round(float(row[2]), 4),
            )
            for row in ordered
        ]

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f"{path.suffix}.partial")
        joblib.dump(self, temporary)
        temporary.replace(path)

    @classmethod
    def load(cls, path: Path) -> QuantileProjectionModel:
        model = joblib.load(path)
        if not isinstance(model, cls):
            raise TypeError("Artifact is not a QuantileProjectionModel")
        return model
