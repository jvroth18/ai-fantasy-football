"""Leakage-safe feature construction for weekly player projections."""

from __future__ import annotations

import polars as pl

IDENTIFIER_COLUMNS = ["player_id", "season", "week", "position"]
RAW_REQUIRED_COLUMNS = [*IDENTIFIER_COLUMNS, "fantasy_points"]
OPTIONAL_USAGE_COLUMNS = [
    "snap_share",
    "targets",
    "carries",
    "receptions",
    "passing_attempts",
    "red_zone_touches",
    "age",
    "draft_number",
]
FEATURE_COLUMNS = [
    "previous_points",
    "rolling_points_3",
    "rolling_points_5",
    "rolling_points_std_5",
    "previous_snap_share",
    "rolling_targets_3",
    "rolling_carries_3",
    "rolling_receptions_3",
    "rolling_passing_attempts_3",
    "rolling_red_zone_touches_3",
    "age",
    "draft_number",
    "games_history",
]


def _ensure_columns(frame: pl.DataFrame) -> pl.DataFrame:
    missing = [column for column in RAW_REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    additions = [
        pl.lit(None, dtype=pl.Float64).alias(column)
        for column in OPTIONAL_USAGE_COLUMNS
        if column not in frame.columns
    ]
    return frame.with_columns(additions) if additions else frame


def build_lagged_features(frame: pl.DataFrame) -> pl.DataFrame:
    """Build features using only games that occurred before the target row."""

    ordered = _ensure_columns(frame).sort(["player_id", "season", "week"])
    return ordered.with_columns(
        pl.col("fantasy_points").shift(1).over("player_id").alias("previous_points"),
        pl.col("fantasy_points")
        .shift(1)
        .rolling_mean(window_size=3, min_samples=1)
        .over("player_id")
        .alias("rolling_points_3"),
        pl.col("fantasy_points")
        .shift(1)
        .rolling_mean(window_size=5, min_samples=1)
        .over("player_id")
        .alias("rolling_points_5"),
        pl.col("fantasy_points")
        .shift(1)
        .rolling_std(window_size=5, min_samples=2)
        .over("player_id")
        .alias("rolling_points_std_5"),
        pl.col("snap_share").shift(1).over("player_id").alias("previous_snap_share"),
        *[
            pl.col(column)
            .shift(1)
            .rolling_mean(window_size=3, min_samples=1)
            .over("player_id")
            .alias(f"rolling_{column}_3")
            for column in [
                "targets",
                "carries",
                "receptions",
                "passing_attempts",
                "red_zone_touches",
            ]
        ],
        (pl.col("player_id").cum_count().over("player_id") - 1).alias("games_history"),
    ).with_columns(
        [
            pl.col(column).cast(pl.Float64, strict=False).fill_null(0.0).fill_nan(0.0)
            for column in FEATURE_COLUMNS
        ]
    )


def model_matrix(frame: pl.DataFrame) -> tuple[pl.DataFrame, pl.Series]:
    featured = build_lagged_features(frame)
    return featured.select(FEATURE_COLUMNS), featured.get_column("fantasy_points").cast(pl.Float64)
