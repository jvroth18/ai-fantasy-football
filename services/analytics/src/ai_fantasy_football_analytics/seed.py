"""Atomic, checksum-locked nflverse dataset seeding."""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from .manifest import DatasetRequest


@dataclass(frozen=True)
class CatalogAsset:
    dataset: str
    name: str
    url: str
    size: int
    updated_at: str


@dataclass(frozen=True)
class MissingAsset:
    dataset: str
    season: int | None
    pattern: str
    optional: bool


@dataclass(frozen=True)
class SeededAsset:
    dataset: str
    name: str
    relative_path: str
    url: str
    updated_at: str
    byte_length: int
    sha256: str | None
    state: str


@dataclass(frozen=True)
class SeedPlan:
    assets: tuple[CatalogAsset, ...]
    missing: tuple[MissingAsset, ...]


@dataclass(frozen=True)
class SeedReport:
    season: int
    generated_at: str
    root: str
    files: tuple[SeededAsset, ...]
    missing: tuple[MissingAsset, ...]
    dry_run: bool

    def document(self) -> dict[str, Any]:
        return {
            "schemaVersion": 1,
            "season": self.season,
            "generatedAt": self.generated_at,
            "root": self.root,
            "dryRun": self.dry_run,
            "files": [asdict(item) for item in self.files],
            "missing": [asdict(item) for item in self.missing],
        }


CatalogFetcher = Callable[[str], list[CatalogAsset]]
AssetDownloader = Callable[[CatalogAsset, Path], SeededAsset]


def fetch_nflverse_catalog(dataset: str) -> list[CatalogAsset]:
    url = f"https://api.github.com/repos/nflverse/nflverse-data/releases/tags/{dataset}"
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "ai-fantasy-football/0.1",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    with urlopen(Request(url, headers=headers), timeout=60) as response:  # noqa: S310
        document = json.load(response)
    assets: list[CatalogAsset] = []
    for item in document.get("assets", []):
        name = str(item["name"])
        if Path(name).name != name:
            raise ValueError(f"Unsafe nflverse asset name: {name}")
        assets.append(
            CatalogAsset(
                dataset=dataset,
                name=name,
                url=str(item["browser_download_url"]),
                size=int(item["size"]),
                updated_at=str(item["updated_at"]),
            )
        )
    return assets


def build_seed_plan(
    requests: list[DatasetRequest],
    catalogs: dict[str, list[CatalogAsset]],
    current_season: int,
) -> SeedPlan:
    selected: list[CatalogAsset] = []
    missing: list[MissingAsset] = []
    for dataset_request in requests:
        if dataset_request.provider != "nflverse":
            raise ValueError(f"Unsupported seed provider: {dataset_request.provider}")
        seasons: tuple[int | None, ...] = dataset_request.seasons or (None,)
        for season in seasons:
            pattern = dataset_request.asset_pattern.replace("{season}", str(season))
            matches = [
                asset
                for asset in catalogs.get(dataset_request.name, [])
                if re.fullmatch(pattern, asset.name)
            ]
            if len(matches) > 1:
                raise ValueError(
                    f"Seed pattern {pattern!r} matched multiple {dataset_request.name} assets"
                )
            if matches:
                selected.append(matches[0])
                continue
            optional = bool(
                season is not None
                and season > current_season - dataset_request.publication_lag_seasons
            )
            missing.append(
                MissingAsset(
                    dataset=dataset_request.name,
                    season=season,
                    pattern=pattern,
                    optional=optional,
                )
            )
    required_missing = [item for item in missing if not item.optional]
    if required_missing:
        descriptions = ", ".join(
            f"{item.dataset}:{item.season or 'all'}" for item in required_missing
        )
        raise ValueError(f"Required nflverse seed assets are missing: {descriptions}")
    unique = {(asset.dataset, asset.name): asset for asset in selected}
    return SeedPlan(
        assets=tuple(unique[key] for key in sorted(unique)),
        missing=tuple(sorted(missing, key=lambda item: (item.dataset, item.season or 0))),
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_asset(asset: CatalogAsset, target: Path) -> SeededAsset:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(f"{target.suffix}.partial")
    digest = hashlib.sha256()
    byte_length = 0
    request = Request(asset.url, headers={"User-Agent": "ai-fantasy-football/0.1"})
    try:
        with urlopen(request, timeout=300) as response, partial.open("wb") as destination:  # noqa: S310
            while chunk := response.read(1024 * 1024):
                destination.write(chunk)
                digest.update(chunk)
                byte_length += len(chunk)
        if byte_length != asset.size:
            raise ValueError(
                f"Downloaded size mismatch for {asset.name}: "
                f"expected {asset.size}, got {byte_length}"
            )
        partial.replace(target)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    return SeededAsset(
        dataset=asset.dataset,
        name=asset.name,
        relative_path=str(Path(asset.dataset) / asset.name),
        url=asset.url,
        updated_at=asset.updated_at,
        byte_length=byte_length,
        sha256=digest.hexdigest(),
        state="downloaded",
    )


def load_seed_lock(path: Path) -> dict[tuple[str, str], dict[str, Any]]:
    if not path.exists():
        return {}
    document = json.loads(path.read_text())
    if document.get("schemaVersion") != 1:
        return {}
    return {(str(item["dataset"]), str(item["name"])): item for item in document.get("files", [])}


def reusable_asset(
    asset: CatalogAsset,
    target: Path,
    previous: dict[str, Any] | None,
) -> SeededAsset | None:
    if not previous or not target.is_file():
        return None
    if previous.get("updated_at") != asset.updated_at or previous.get("byte_length") != asset.size:
        return None
    digest = sha256_file(target)
    if previous.get("sha256") != digest:
        return None
    return SeededAsset(
        dataset=asset.dataset,
        name=asset.name,
        relative_path=str(Path(asset.dataset) / asset.name),
        url=asset.url,
        updated_at=asset.updated_at,
        byte_length=asset.size,
        sha256=digest,
        state="reused",
    )


def write_seed_lock(path: Path, report: SeedReport) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.partial")
    temporary.write_text(json.dumps(report.document(), indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def seed_nflverse(
    requests: list[DatasetRequest],
    current_season: int,
    root: Path,
    lock_path: Path,
    *,
    workers: int = 4,
    dry_run: bool = False,
    catalog_fetcher: CatalogFetcher = fetch_nflverse_catalog,
    asset_downloader: AssetDownloader = download_asset,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> SeedReport:
    datasets = sorted({request.name for request in requests})
    with ThreadPoolExecutor(max_workers=min(workers, len(datasets))) as executor:
        catalogs = dict(zip(datasets, executor.map(catalog_fetcher, datasets), strict=True))
    plan = build_seed_plan(requests, catalogs, current_season)
    generated_at = now().isoformat().replace("+00:00", "Z")
    if dry_run:
        files = tuple(
            SeededAsset(
                dataset=asset.dataset,
                name=asset.name,
                relative_path=str(Path(asset.dataset) / asset.name),
                url=asset.url,
                updated_at=asset.updated_at,
                byte_length=asset.size,
                sha256=None,
                state="planned",
            )
            for asset in plan.assets
        )
        return SeedReport(
            season=current_season,
            generated_at=generated_at,
            root=str(root),
            files=files,
            missing=plan.missing,
            dry_run=True,
        )

    previous = load_seed_lock(lock_path)
    completed: list[SeededAsset] = []
    downloads: list[tuple[CatalogAsset, Path]] = []
    for asset in plan.assets:
        target = root / asset.dataset / asset.name
        reused = reusable_asset(asset, target, previous.get((asset.dataset, asset.name)))
        if reused:
            completed.append(reused)
        else:
            downloads.append((asset, target))

    def run_download(item: tuple[CatalogAsset, Path]) -> SeededAsset:
        return asset_downloader(*item)

    if downloads:
        with ThreadPoolExecutor(max_workers=min(workers, len(downloads))) as executor:
            completed.extend(executor.map(run_download, downloads))
    report = SeedReport(
        season=current_season,
        generated_at=generated_at,
        root=str(root),
        files=tuple(sorted(completed, key=lambda item: (item.dataset, item.name))),
        missing=plan.missing,
        dry_run=False,
    )
    write_seed_lock(lock_path, report)
    return report
