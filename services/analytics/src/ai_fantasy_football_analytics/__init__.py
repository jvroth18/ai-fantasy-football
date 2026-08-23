"""Analytics package for ai-fantasy-football."""

from .backtest import SeasonBacktest, rolling_season_backtest
from .features import FEATURE_COLUMNS, build_lagged_features, model_matrix
from .model import Projection, QuantileProjectionModel
from .signals import PlayerOutlook, PlayerSignal, classify_outlook

__version__ = "0.1.0"

__all__ = [
    "FEATURE_COLUMNS",
    "PlayerOutlook",
    "PlayerSignal",
    "Projection",
    "QuantileProjectionModel",
    "SeasonBacktest",
    "build_lagged_features",
    "classify_outlook",
    "model_matrix",
    "rolling_season_backtest",
]
