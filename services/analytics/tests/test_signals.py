from ai_fantasy_football_analytics.signals import PlayerOutlook, classify_outlook


def test_flags_a_high_draft_capital_rookie_with_market_upside() -> None:
    signal = classify_outlook(
        PlayerOutlook(
            projected_points=15,
            market_points=10,
            p10=8,
            p90=18,
            usage_trend=0.4,
            age_curve=0.3,
            draft_number=12,
            rookie=True,
        )
    )

    assert signal.label == "breakout"
    assert signal.breakout_probability >= 0.67
    assert "rookie draft capital supports early opportunity" in signal.reasons


def test_flags_declining_player_below_market_as_bust() -> None:
    signal = classify_outlook(
        PlayerOutlook(
            projected_points=7,
            market_points=14,
            p10=4,
            p90=10,
            usage_trend=-0.5,
            age_curve=-0.4,
            draft_number=None,
            rookie=False,
        )
    )

    assert signal.label == "bust"
    assert signal.bust_probability >= 0.67
