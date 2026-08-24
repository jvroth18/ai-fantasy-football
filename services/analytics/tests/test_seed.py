import hashlib
from datetime import UTC, datetime
from pathlib import Path

from ai_fantasy_football_analytics.manifest import DatasetRequest
from ai_fantasy_football_analytics.seed import (
    CatalogAsset,
    SeededAsset,
    build_seed_plan,
    seed_nflverse,
)


def request(
    name: str,
    seasons: tuple[int, ...],
    pattern: str,
    allow_missing_current: bool = False,
) -> DatasetRequest:
    return DatasetRequest(
        provider="nflverse",
        name=name,
        seasons=seasons,
        format="parquet",
        asset_pattern=pattern,
        publication_lag_seasons=1 if allow_missing_current else 0,
    )


def asset(dataset: str, name: str, size: int = 3) -> CatalogAsset:
    return CatalogAsset(
        dataset=dataset,
        name=name,
        url=f"https://example.test/{name}",
        size=size,
        updated_at="2026-08-23T12:00:00Z",
    )


def test_seed_plan_matches_exact_assets_and_allows_unpublished_current_season() -> None:
    requests = [
        request("players", (), r"players\.parquet"),
        request("player_stats", (2025, 2026), r"player_stats_{season}\.parquet", True),
    ]
    catalogs = {
        "players": [asset("players", "players.parquet")],
        "player_stats": [
            asset("player_stats", "player_stats_2025.parquet"),
            asset("player_stats", "player_stats_kicking_2025.parquet"),
        ],
    }

    plan = build_seed_plan(requests, catalogs, 2026)

    assert [item.name for item in plan.assets] == ["player_stats_2025.parquet", "players.parquet"]
    assert len(plan.missing) == 1
    assert plan.missing[0].season == 2026
    assert plan.missing[0].optional is True


def test_seed_downloads_atomically_then_reuses_checksum_locked_file(tmp_path: Path) -> None:
    requests = [request("players", (), r"players\.parquet")]
    catalog = [asset("players", "players.parquet")]
    downloads: list[str] = []

    def fetch_catalog(_dataset: str) -> list[CatalogAsset]:
        return catalog

    def download(source: CatalogAsset, target: Path) -> SeededAsset:
        downloads.append(source.name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"abc")
        return SeededAsset(
            dataset=source.dataset,
            name=source.name,
            relative_path="players/players.parquet",
            url=source.url,
            updated_at=source.updated_at,
            byte_length=3,
            sha256=hashlib.sha256(b"abc").hexdigest(),
            state="downloaded",
        )

    def fixed_now() -> datetime:
        return datetime(2026, 8, 23, 18, tzinfo=UTC)

    root = tmp_path / "cache"
    lock = root / "seed-lock.json"
    first = seed_nflverse(
        requests,
        2026,
        root,
        lock,
        catalog_fetcher=fetch_catalog,
        asset_downloader=download,
        now=fixed_now,
    )
    second = seed_nflverse(
        requests,
        2026,
        root,
        lock,
        catalog_fetcher=fetch_catalog,
        asset_downloader=download,
        now=fixed_now,
    )

    assert first.files[0].state == "downloaded"
    assert second.files[0].state == "reused"
    assert downloads == ["players.parquet"]
    assert lock.exists()


def test_seed_dry_run_never_writes_cache_or_lock(tmp_path: Path) -> None:
    requests = [request("players", (), r"players\.parquet")]
    root = tmp_path / "cache"
    report = seed_nflverse(
        requests,
        2026,
        root,
        root / "seed-lock.json",
        dry_run=True,
        catalog_fetcher=lambda _dataset: [asset("players", "players.parquet", 42)],
    )

    assert report.files[0].state == "planned"
    assert report.files[0].byte_length == 42
    assert not root.exists()
