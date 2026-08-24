"""Command-line entry points used by the local daemon and contributors."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .manifest import load_seed_manifest
from .seed import seed_nflverse


def main() -> None:
    parser = argparse.ArgumentParser(prog="ai-ff-analytics")
    subparsers = parser.add_subparsers(dest="command", required=True)
    manifest = subparsers.add_parser("seed-manifest")
    manifest.add_argument("--season", type=int, required=True)
    manifest.add_argument(
        "--path",
        type=Path,
        default=Path(__file__).parents[2] / "config" / "data_seed.json",
    )
    seed = subparsers.add_parser("seed")
    seed.add_argument("--season", type=int, required=True)
    seed.add_argument(
        "--path",
        type=Path,
        default=Path(__file__).parents[2] / "config" / "data_seed.json",
    )
    seed.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).parents[4] / "data" / "cache" / "nflverse",
    )
    seed.add_argument("--lock", type=Path)
    seed.add_argument("--workers", type=int, default=4)
    seed.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.command == "seed-manifest":
        requests = load_seed_manifest(args.path, args.season)
        print(
            json.dumps(
                [
                    {
                        "provider": request.provider,
                        "name": request.name,
                        "seasons": request.seasons,
                        "format": request.format,
                        "assetPattern": request.asset_pattern,
                        "publicationLagSeasons": request.publication_lag_seasons,
                    }
                    for request in requests
                ]
            )
        )
    elif args.command == "seed":
        if args.workers < 1 or args.workers > 16:
            parser.error("--workers must be between 1 and 16")
        requests = load_seed_manifest(args.path, args.season)
        lock_path = args.lock or args.root / "seed-lock.json"
        report = seed_nflverse(
            requests,
            args.season,
            args.root,
            lock_path,
            workers=args.workers,
            dry_run=args.dry_run,
        )
        print(json.dumps(report.document(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
