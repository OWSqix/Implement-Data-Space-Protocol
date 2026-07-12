"""Offline pySHACL runner for the aggregate upstream isolation shards."""

from __future__ import annotations

import json
import os
import re
import stat
import sys
from importlib.metadata import version
from pathlib import Path, PurePosixPath
from typing import Any


EXPECTED = {"pyshacl": "0.40.0", "rdflib": "7.6.0"}
MAX_REQUEST_BYTES = 64 * 1024
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_SHARDS = 8
PORTABLE = re.compile(
    r"^requirements/upstream-isolated-evidence/"
    r"upstream-isolated-[0-9]{3}-(?:shapes|positive|negative)[.]ttl$"
)
SHARD_ID = re.compile(r"^upstream-isolated-[0-9]{3}$")


def deny_external_io(event: str, _arguments: tuple[object, ...]) -> None:
    if event.startswith(("socket.", "subprocess.", "os.spawn", "os.system", "pty.spawn")):
        raise RuntimeError(f"external I/O denied: {event}")


from pyshacl import validate  # noqa: E402
from rdflib import Graph, URIRef  # noqa: E402
from rdflib.namespace import RDF  # noqa: E402


sys.addaudithook(deny_external_io)
SH = "http://www.w3.org/ns/shacl#"
SH_REPORT = URIRef(f"{SH}ValidationReport")
SH_RESULT = URIRef(f"{SH}result")


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON member: {key}")
        value[key] = item
    return value


def request() -> dict[str, Any]:
    payload = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(payload) > MAX_REQUEST_BYTES:
        raise ValueError("upstream batch request exceeds its byte limit")
    value = json.loads(payload.decode("utf-8", errors="strict"), object_pairs_hook=reject_duplicate_keys)
    if not isinstance(value, dict) or set(value) != {"releaseRoot", "schemaVersion", "shards"}:
        raise ValueError("upstream batch request has invalid members")
    if value["schemaVersion"] != "molit.upstream-isolated-batch-request/1":
        raise ValueError("upstream batch request has an invalid schema version")
    if not isinstance(value["shards"], list) or not 1 <= len(value["shards"]) <= MAX_SHARDS:
        raise ValueError("upstream batch request has an invalid shard count")
    return value


def is_reparse_point(metadata: os.stat_result) -> bool:
    flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return bool(flag and getattr(metadata, "st_file_attributes", 0) & flag)


def checked_root(raw: Any) -> Path:
    if not isinstance(raw, str) or "\x00" in raw:
        raise ValueError("releaseRoot must be an absolute path")
    root = Path(raw)
    metadata = root.lstat()
    if not root.is_absolute() or not stat.S_ISDIR(metadata.st_mode) or root.is_symlink() or is_reparse_point(metadata):
        raise ValueError("releaseRoot must be a regular absolute directory")
    return root.resolve(strict=True)


def checked_relative(raw: Any) -> PurePosixPath:
    if not isinstance(raw, str) or not PORTABLE.fullmatch(raw):
        raise ValueError(f"invalid upstream artifact path: {raw!r}")
    relative = PurePosixPath(raw)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise ValueError("upstream artifact path is not normalized")
    return relative


def regular_bytes(root: Path, raw: Any) -> bytes:
    relative = checked_relative(raw)
    current = root
    for part in relative.parts:
        current /= part
        metadata = current.lstat()
        if current.is_symlink() or is_reparse_point(metadata):
            raise ValueError("upstream artifact traverses a link or reparse point")
    resolved = current.resolve(strict=True)
    if not resolved.is_relative_to(root):
        raise ValueError("upstream artifact escapes releaseRoot")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(resolved, flags)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_FILE_BYTES:
            raise ValueError("upstream artifact is not a bounded regular file")
        chunks: list[bytes] = []
        remaining = MAX_FILE_BYTES + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(64 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        after = os.fstat(descriptor)
        if len(payload) != before.st_size or (before.st_dev, before.st_ino, before.st_size) != (
            after.st_dev, after.st_ino, after.st_size
        ):
            raise ValueError("upstream artifact changed while read")
        return payload
    finally:
        os.close(descriptor)


def graph(root: Path, relative: Any, public_id: str) -> Graph:
    value = Graph()
    value.parse(data=regular_bytes(root, relative), format="turtle", publicID=public_id)
    return value


def decision(data: Graph, shapes: Graph) -> dict[str, object]:
    conforms, report, _text = validate(
        data_graph=data,
        shacl_graph=shapes,
        inference="none",
        advanced=False,
        allow_infos=False,
        allow_warnings=False,
        meta_shacl=False,
        do_owl_imports=False,
    )
    if not isinstance(report, Graph):
        raise RuntimeError("pySHACL did not return an RDF report")
    reports = list(report.subjects(RDF.type, SH_REPORT))
    if len(reports) != 1:
        raise RuntimeError("pySHACL returned an invalid report count")
    return {
        "conforms": bool(conforms),
        "resultCount": sum(1 for _ in report.objects(reports[0], SH_RESULT)),
    }


def main() -> int:
    actual_versions = {name: version(name) for name in EXPECTED}
    if actual_versions != EXPECTED:
        raise RuntimeError(f"unexpected pySHACL toolchain: {actual_versions!r}")
    value = request()
    root = checked_root(value["releaseRoot"])
    identifiers: set[str] = set()
    results: list[dict[str, object]] = []
    for item in value["shards"]:
        if not isinstance(item, dict) or set(item) != {"negative", "positive", "shapes", "shardId"}:
            raise ValueError("upstream batch shard has invalid members")
        shard_id = item["shardId"]
        if not isinstance(shard_id, str) or not SHARD_ID.fullmatch(shard_id) or shard_id in identifiers:
            raise ValueError("upstream batch shard ID is invalid or duplicated")
        identifiers.add(shard_id)
        shapes = graph(root, item["shapes"], f"urn:molit:upstream:shapes:{shard_id}:")
        positive = graph(root, item["positive"], f"urn:molit:upstream:positive:{shard_id}:")
        negative = graph(root, item["negative"], f"urn:molit:upstream:negative:{shard_id}:")
        results.append({
            "shardId": shard_id,
            "positive": decision(positive, shapes),
            "negative": decision(negative, shapes),
        })
    json.dump({
        "schemaVersion": "molit.upstream-isolated-batch-python/1",
        "engine": {"name": "pySHACL", "versions": actual_versions},
        "networkPolicy": "python-audit-hook-deny-socket-and-process-spawn",
        "results": results,
    }, sys.stdout, ensure_ascii=False, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
