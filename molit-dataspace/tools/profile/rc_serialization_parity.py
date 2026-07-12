#!/usr/bin/env python3
"""Offline RDF serialization worker for the RC full parity lane."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys

from rdflib import Dataset, Graph


MAX_REQUEST_BYTES = 4 * 1024 * 1024
MAX_INPUT_BYTES = 16 * 1024 * 1024
MAX_CASES = 2_000
FORMATS = (
    ("turtle", "turtle", "ttl"),
    ("rdfxml", "xml", "rdf"),
    ("jsonld", "json-ld", "jsonld"),
    ("ntriples", "nt", "nt"),
    ("nquads", "nquads", "nq"),
)


def deny_ambient_authority(event: str, _args: tuple[object, ...]) -> None:
    denied = (
        "socket.",
        "subprocess.",
        "os.system",
        "os.spawn",
        "os.exec",
        "urllib.",
        "http.client",
    )
    if event.startswith(denied):
        raise RuntimeError(f"ambient network or process authority denied: {event}")


sys.addaudithook(deny_ambient_authority)


def confined(root: Path, candidate: str, label: str) -> Path:
    path = Path(candidate).resolve(strict=False)
    try:
        path.relative_to(root)
    except ValueError as cause:
        raise ValueError(f"{label} escapes its declared root") from cause
    return path


def encoded(value: str | bytes) -> bytes:
    return value.encode("utf-8") if isinstance(value, str) else value


def main() -> None:
    if os.environ.get("PYTHONHASHSEED") != "0":
        raise RuntimeError("serialization worker requires PYTHONHASHSEED=0")
    request_bytes = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(request_bytes) > MAX_REQUEST_BYTES:
        raise ValueError("serialization request exceeds its byte limit")
    request = json.loads(request_bytes.decode("utf-8-sig"))
    if request.get("schemaVersion") != "molit.rc-serialization-request/1":
        raise ValueError("serialization request schema differs")
    release_root = Path(request["releaseRoot"]).resolve(strict=True)
    output_root = Path(request["outputRoot"]).resolve(strict=True)
    cases = request.get("cases")
    if not isinstance(cases, list) or not 1 <= len(cases) <= MAX_CASES:
        raise ValueError("serialization request case count is invalid")

    results: list[dict[str, object]] = []
    for index, item in enumerate(cases):
        case_id = item.get("id")
        if not isinstance(case_id, str) or not case_id:
            raise ValueError("serialization case ID is invalid")
        source = confined(release_root, item.get("input", ""), "input")
        if not source.is_file() or source.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError(f"serialization input is missing or oversized: {case_id}")
        graph = Graph()
        graph.parse(source=source, format="turtle", publicID="urn:molit:serialization-input")
        conversions: list[dict[str, object]] = []
        for name, rdf_format, extension in FORMATS:
            if name == "nquads":
                dataset = Dataset(default_union=False)
                for triple in graph:
                    dataset.default_graph.add(triple)
                payload = encoded(dataset.serialize(format=rdf_format))
            else:
                payload = encoded(graph.serialize(format=rdf_format))
            relative = f"full/{index:04d}-{name}.{extension}"
            output = confined(output_root, str(output_root / relative), "output")
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open("xb") as stream:
                stream.write(payload)
            conversions.append({
                "bytes": len(payload),
                "format": name,
                "path": relative,
                "sha256": hashlib.sha256(payload).hexdigest(),
            })
        results.append({"id": case_id, "conversions": conversions})

    response = {
        "schemaVersion": "molit.rc-serialization-worker/1",
        "engine": {
            "name": "RDFLib",
            "version": __import__("rdflib").__version__,
        },
        "networkPolicy": "python-audit-hook-deny-socket-and-process-spawn",
        "results": results,
    }
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
