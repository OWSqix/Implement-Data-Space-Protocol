"""Offline pySHACL decision lane for the MOLIT 1.0.0 release candidate.

The Node parent supplies only release snapshots in a private temporary directory.
This process accepts relative file names below that directory and never enables
SHACL imports, JavaScript, subprocesses, or network access.
"""

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
MAX_CASES = 256
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_REQUEST_BYTES = 1024 * 1024
CASE_ID = re.compile(r"^[A-Z0-9][A-Z0-9._-]{0,119}$")
PORTABLE_PATH = re.compile(r"^[A-Za-z0-9._/-]{1,240}$")


def deny_external_io(event: str, _arguments: tuple[object, ...]) -> None:
    denied = (
        "socket.",
        "subprocess.",
        "os.spawn",
        "os.system",
        "pty.spawn",
    )
    if event.startswith(denied):
        raise RuntimeError(f"external I/O denied: {event}")


from pyshacl import validate  # noqa: E402
from rdflib import Graph, URIRef  # noqa: E402

sys.addaudithook(deny_external_io)


SH_RESULT = URIRef("http://www.w3.org/ns/shacl#result")


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON member: {key}")
        value[key] = item
    return value


def strict_request() -> dict[str, Any]:
    payload = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(payload) > MAX_REQUEST_BYTES:
        raise ValueError("matrix request exceeds its byte limit")
    try:
        text = payload.decode("utf-8", errors="strict")
        request = json.loads(text, object_pairs_hook=reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError) as cause:
        raise ValueError("matrix request is not strict UTF-8 JSON") from cause
    if not isinstance(request, dict) or set(request) != {
        "cases", "releaseRoot", "schemaVersion", "support"
    }:
        raise ValueError("matrix request has an invalid top-level structure")
    if request["schemaVersion"] != "molit.rc-shacl-matrix-request/1":
        raise ValueError("invalid matrix request schema version")
    return request


def is_reparse_point(metadata: os.stat_result) -> bool:
    flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    attributes = getattr(metadata, "st_file_attributes", 0)
    return bool(flag and attributes & flag)


def checked_root(raw_root: Any) -> Path:
    if not isinstance(raw_root, str) or "\x00" in raw_root:
        raise ValueError("releaseRoot must be an absolute directory path")
    root = Path(raw_root)
    if not root.is_absolute():
        raise ValueError("releaseRoot must be absolute")
    metadata = root.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or root.is_symlink() or is_reparse_point(metadata):
        raise ValueError("releaseRoot must be a regular, non-reparse directory")
    return root.resolve(strict=True)


def checked_relative_path(raw_path: Any) -> PurePosixPath:
    if not isinstance(raw_path, str) or not PORTABLE_PATH.fullmatch(raw_path):
        raise ValueError("matrix file name is not a portable relative path")
    portable = PurePosixPath(raw_path)
    if portable.is_absolute() or any(part in {"", ".", ".."} for part in portable.parts):
        raise ValueError("matrix file name is not normalized")
    if portable.as_posix() != raw_path:
        raise ValueError("matrix file name is not canonical")
    return portable


def regular_bytes(root: Path, raw_path: Any) -> bytes:
    portable = checked_relative_path(raw_path)
    candidate = root.joinpath(*portable.parts)
    current = root
    for segment in portable.parts:
        current = current / segment
        metadata = current.lstat()
        if current.is_symlink() or is_reparse_point(metadata):
            raise ValueError("matrix file traverses a symlink or reparse point")
    resolved = candidate.resolve(strict=True)
    if not resolved.is_relative_to(root):
        raise ValueError("matrix file escapes releaseRoot")

    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(resolved, flags)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or is_reparse_point(before):
            raise ValueError("matrix input is not a regular file")
        if before.st_size > MAX_FILE_BYTES:
            raise ValueError("matrix input exceeds its byte limit")
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
        if len(payload) > MAX_FILE_BYTES:
            raise ValueError("matrix input exceeds its byte limit")
        if (before.st_dev, before.st_ino, before.st_size) != (
            after.st_dev, after.st_ino, after.st_size
        ) or len(payload) != before.st_size:
            raise ValueError("matrix input changed while it was read")
        return payload
    finally:
        os.close(descriptor)


def parse_turtle(root: Path, raw_path: Any, public_id: str) -> Graph:
    graph = Graph()
    graph.parse(
        data=regular_bytes(root, raw_path),
        format="turtle",
        publicID=public_id,
    )
    return graph


def checked_cases(raw_cases: Any) -> list[dict[str, str]]:
    if not isinstance(raw_cases, list) or not 1 <= len(raw_cases) <= MAX_CASES:
        raise ValueError("matrix cases must be a bounded non-empty array")
    checked: list[dict[str, str]] = []
    identifiers: set[str] = set()
    for item in raw_cases:
        if not isinstance(item, dict) or set(item) != {"bundle", "id", "input"}:
            raise ValueError("matrix case has an invalid structure")
        identifier = item["id"]
        if not isinstance(identifier, str) or not CASE_ID.fullmatch(identifier):
            raise ValueError("matrix case ID is invalid")
        if identifier in identifiers:
            raise ValueError("matrix case ID is duplicated")
        identifiers.add(identifier)
        checked_relative_path(item["input"])
        checked_relative_path(item["bundle"])
        checked.append(item)
    return checked


def main() -> int:
    actual = {name: version(name) for name in EXPECTED}
    if actual != EXPECTED:
        raise RuntimeError(f"unexpected independent-validator versions: {actual!r}")
    request = strict_request()
    root = checked_root(request["releaseRoot"])
    cases = checked_cases(request["cases"])
    checked_relative_path(request["support"])
    support = parse_turtle(root, request["support"], "urn:molit:offline:support:")

    results: list[dict[str, object]] = []
    for item in cases:
        data = parse_turtle(root, item["input"], f"urn:molit:offline:data:{item['id']}:")
        for triple in support:
            data.add(triple)
        shapes = parse_turtle(root, item["bundle"], f"urn:molit:offline:shapes:{item['id']}:")
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
            raise RuntimeError("pySHACL did not return an RDF validation report")
        results.append({
            "conforms": bool(conforms),
            "id": item["id"],
            "resultCount": sum(1 for _item in report.objects(None, SH_RESULT)),
        })

    json.dump({
        "engine": {"name": "pySHACL", "versions": actual},
        "networkPolicy": "python-audit-hook-deny-socket-and-process-spawn",
        "results": results,
        "schemaVersion": "molit.rc-shacl-matrix-python/1",
    }, sys.stdout, ensure_ascii=False, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
