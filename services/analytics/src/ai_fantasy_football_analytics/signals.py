"""Explainable breakout, bust, and rookie-upside signals."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class PlayerOutlook:
    projected_points: float
    market_points: float
    p10: float
    p90: float
    usage_trend: float
    age_curve: float
    draft_number: int | None
    rookie: bool


@dataclass(frozen=True)
class PlayerSignal:
    label: str
    breakout_probability: float
    bust_probability: float
    confidence: float
    reasons: tuple[str, ...]


def _logistic(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-value))


def classify_outlook(outlook: PlayerOutlook) -> PlayerSignal:
    uncertainty = max(outlook.p90 - outlook.p10, 2.0)
    market_delta = (outlook.projected_points - outlook.market_points) / uncertainty
    rookie_capital = (
        max(0.0, min(1.0, (260 - outlook.draft_number) / 260))
        if outlook.rookie and outlook.draft_number is not None
        else 0.0
    )
    breakout_score = market_delta * 2.2 + outlook.usage_trend * 1.4 + outlook.age_curve
    if outlook.rookie:
        breakout_score += rookie_capital * 0.8
    bust_score = -market_delta * 2.1 - outlook.usage_trend * 1.2 - outlook.age_curve
    breakout = _logistic(breakout_score)
    bust = _logistic(bust_score)
    confidence = max(0.0, min(1.0, 1.0 - uncertainty / max(abs(outlook.projected_points), 10.0)))

    reasons: list[str] = []
    if market_delta >= 0.15:
        reasons.append("model projection is above the market baseline")
    elif market_delta <= -0.15:
        reasons.append("model projection is below the market baseline")
    if outlook.usage_trend > 0.1:
        reasons.append("recent opportunity is increasing")
    elif outlook.usage_trend < -0.1:
        reasons.append("recent opportunity is declining")
    if outlook.rookie and rookie_capital > 0.6:
        reasons.append("rookie draft capital supports early opportunity")
    if not reasons:
        reasons.append("projection and market expectation are closely aligned")

    label = "breakout" if breakout >= 0.67 else "bust" if bust >= 0.67 else "neutral"
    return PlayerSignal(
        label=label,
        breakout_probability=round(breakout, 4),
        bust_probability=round(bust, 4),
        confidence=round(confidence, 4),
        reasons=tuple(reasons),
    )
