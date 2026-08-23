"""Versioned definition of the free local seed dataset."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DatasetRequest:
    provider: str
    name: str
    seasons: tuple[int, ...]
    format: str


def load_seed_manifest(path: Path, current_season: int) -> list[DatasetRequest]:
    document = json.loads(path.read_text())
    if document.get("schemaVersion") != 1:
        raise ValueError("Unsupported seed manifest version")

    requests: list[DatasetRequest] = []
    for item in document["datasets"]:
        start = item.get("seasonStart")
        seasons = tuple(range(int(start), current_season + 1)) if start is not None else ()
        requests.append(
            DatasetRequest(
                provider=str(item["provider"]),
                name=str(item["name"]),
                seasons=seasons,
                format=str(item["format"]),
            )
        )
    return requests
