"""Command-line entry points used by the local daemon and contributors."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .manifest import load_seed_manifest


def main() -> None:
    parser = argparse.ArgumentParser(prog="ai-ff-analytics")
    subparsers = parser.add_subparsers(dest="command", required=True)
    manifest = subparsers.add_parser("seed-manifest")
    manifest.add_argument("--season", type=int, required=True)
    manifest.add_argument(
        "--path",
        type=Path,
        default=Path(__file__).parents[3] / "config" / "data_seed.json",
    )
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
                    }
                    for request in requests
                ]
            )
        )


if __name__ == "__main__":
    main()
