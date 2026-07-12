"""Offline pySHACL checks for the pinned MOLIT application-profile release.

The independent lane reads a closed set of regular local files, parses the
already-read bytes, and rejects XML features that can dereference or expand
external content.  It does not replace the Node.js preflight scanner.
"""

from __future__ import annotations

import hashlib
import html
import json
import logging
import os
import platform
import pyexpat
import re
import stat
import sys
from collections import Counter
from importlib.metadata import distribution, version
from pathlib import Path, PurePosixPath
from typing import Any


EXPECTED_DISTRIBUTIONS = {
    "html5rdf": "1.2.1",
    "owlrl": "7.6.2",
    "packaging": "26.2",
    "prettytable": "3.18.0",
    "pyparsing": "3.3.2",
    "pyshacl": "0.40.0",
    "rdflib": "7.6.0",
    "wcwidth": "0.8.2",
}
EXPECTED_DISTRIBUTION_CONTENT_SHA256 = {
    "html5rdf": "783d36d38e4f2ab5aefc90a6d59c085823b0ae8cbb43685b9e83a2e60a418714",
    "owlrl": "0e6d659499f40228e4b764e5b001a4c0ae151bad05c09a1d9b67b9f9f7dd9199",
    "packaging": "9224921236bb7a0fbab90c9250459f8a8847403c372f2fa6f3faf43b4d76ff88",
    "prettytable": "b0fce075f3c4607e4f78eb6f985dde02c96fd57d8ccc40ffe92fc97ed5eed361",
    "pyparsing": "195816b561a929869343b8ad57bf1a089e43d94cb48463174130701b67c9fc0b",
    "pyshacl": "87d1af8ff3267b0db39b37527de73a94b88e1450d8cbc9b8a564de19098b1d47",
    "rdflib": "6ef192d37c3dc48b991743d67ee46c1510bc129649819231705f2c2e719e465b",
    "wcwidth": "1893bae19a8dbe8fbf7743c03ca0a1af8c0395440620bfb5742e79082a4c9274",
}
SUPPORTED_PYTHON_MINORS = frozenset({(3, 12)})
MAX_DISTRIBUTION_FILE_BYTES = 16 * 1024 * 1024


def _installed_dependency_versions() -> dict[str, str]:
    if sys.version_info[:2] not in SUPPORTED_PYTHON_MINORS:
        supported = ", ".join(
            f"{major}.{minor}" for major, minor in sorted(SUPPORTED_PYTHON_MINORS)
        )
        raise RuntimeError(
            f"unsupported Python {sys.version_info.major}.{sys.version_info.minor}; "
            f"independent validator supports exactly: {supported}"
        )
    actual = {name: version(name) for name in EXPECTED_DISTRIBUTIONS}
    if actual != EXPECTED_DISTRIBUTIONS:
        raise RuntimeError(f"independent validator dependency drift: {actual!r}")
    return actual


def _installed_distribution_content_digests() -> dict[str, str]:
    """Bind imported pure-Python files to the approved universal wheels."""

    actual: dict[str, str] = {}
    for name in EXPECTED_DISTRIBUTIONS:
        installed = distribution(name)
        if installed.files is None:
            raise RuntimeError(f"distribution file manifest is unavailable: {name}")
        manifest: list[tuple[str, bytes]] = []
        for package_path in installed.files:
            relative = str(package_path).replace("\\", "/")
            parts = PurePosixPath(relative).parts
            if ".." in parts or relative.startswith("/"):
                continue
            filename = PurePosixPath(relative).name
            if relative.endswith(".dist-info/RECORD") or "/__pycache__/" in relative:
                continue
            if relative.endswith(".pyc"):
                continue
            if ".dist-info/" in relative and filename in {
                "INSTALLER",
                "REQUESTED",
                "direct_url.json",
            }:
                continue
            located = Path(installed.locate_file(package_path))
            if not located.is_file() or located.is_symlink():
                raise RuntimeError(f"distribution file is not a regular installed file: {name}/{relative}")
            payload = located.read_bytes()
            if len(payload) > MAX_DISTRIBUTION_FILE_BYTES:
                raise RuntimeError(f"distribution file exceeds the validation limit: {name}/{relative}")
            manifest.append((relative, hashlib.sha256(payload).digest()))
        digest = hashlib.sha256()
        for relative, payload_digest in sorted(manifest):
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            digest.update(payload_digest)
            digest.update(b"\0")
        actual[name] = digest.hexdigest()
    if actual != EXPECTED_DISTRIBUTION_CONTENT_SHA256:
        raise RuntimeError(f"independent validator installed-code drift: {actual!r}")
    return actual


_NETWORK_AUDIT_EVENTS = frozenset(
    {
        "os.exec",
        "os.startfile",
        "os.startfile/2",
        "os.system",
        "socket.__new__",
        "socket.bind",
        "socket.connect",
        "socket.getaddrinfo",
        "socket.gethostbyaddr",
        "socket.gethostbyname",
        "socket.gethostbyname_ex",
        "subprocess.Popen",
    }
)
_NETWORK_AUDIT_INSTALLED = False


def install_no_network_audit_hook() -> None:
    """Install the process-wide network deny policy before third-party imports."""

    global _NETWORK_AUDIT_INSTALLED
    if _NETWORK_AUDIT_INSTALLED:
        return

    def reject_network(event: str, _arguments: tuple[object, ...]) -> None:
        if (
            event.startswith("socket.")
            or event.startswith("os.spawn")
            or event.startswith("os.posix_spawn")
            or event in _NETWORK_AUDIT_EVENTS
        ):
            raise RuntimeError(f"network operation denied by independent validator: {event}")

    sys.addaudithook(reject_network)
    _NETWORK_AUDIT_INSTALLED = True


# On Windows, platform.system() may use socket.gethostname() as a local uname
# fallback.  Cache that standard-library value before the socket-wide deny hook.
platform.system()
install_no_network_audit_hook()
_PREIMPORT_DEPENDENCIES = _installed_dependency_versions()
_PREIMPORT_CONTENT_DIGESTS = _installed_distribution_content_digests()

# These imports are deliberately below the process-wide network audit hook.
from pyshacl import validate  # noqa: E402
from rdflib import BNode, Graph, Literal, Namespace, RDF, URIRef  # noqa: E402
from rdflib.compare import to_canonical_graph  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
RELEASE = ROOT / "profiles" / "molit-dcat-ap" / "releases" / "0.1.0"
RELEASE_RELATIVE_ROOT = "profiles/molit-dcat-ap/releases/0.1.0"
ARTIFACT_LOCK_RELATIVE_PATH = f"{RELEASE_RELATIVE_ROOT}/artifact-lock.json"
REGISTER_RELATIVE_PATH = "standards/korean-interoperability-register.json"
REQUIREMENTS_RELATIVE_PATH = "requirements-profile-validation.txt"

MAX_REGISTER_BYTES = 1 * 1024 * 1024
MAX_RELEASE_ARTIFACT_BYTES = 16 * 1024 * 1024
MAX_PORTAL_SNAPSHOT_BYTES = 1 * 1024 * 1024
MACHINE_ARTIFACT_EXTENSIONS = frozenset(
    {".csv", ".json", ".jsonld", ".nq", ".nt", ".rdf", ".sch", ".ttl", ".xml", ".xsd"}
)

SH = Namespace("http://www.w3.org/ns/shacl#")
DCAT = Namespace("http://www.w3.org/ns/dcat#")
DCT = Namespace("http://purl.org/dc/terms/")
XSD_DATE = URIRef("http://www.w3.org/2001/XMLSchema#date")
PROFILE_IRI = URIRef("https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0")
MOLIT_REQUIREMENT_ID = URIRef(
    "https://data.molit.go.kr/def/molit-dcat-ap#requirementId"
)

APPROVED_REQUIREMENTS_SHA256 = "8277ae284fbbcb0bc26539ed0e9b6957e754fa672446ec424bbc2b7ce8e304c2"

APPROVED_RELEASE_INPUT_SHA256 = {
    "bundles/core.ttl": "35a2ec1e9c955466c87006a6817bf93c963503fc36dc5e5c94cf1e4382ce5f73",
    "bundles/geo.ttl": "4c3808b9de95851475cc442501da6662322324e8609ea6f3a2c63d0f593d4add",
    "bundles/support.ttl": "ace2d4de2a18f72a025ce93bc6f4d148646803585c0d907401fb9f4aa0f1bc8d",
    "examples/invalid/missing-korean-title.ttl": "e07e0d588a9facab33a1bc84da3da3fbd865848c7938a3d454944512c633c225",
    "examples/invalid/unapproved-frequency.ttl": "24c44907d3b53b2796af759c3e568d5ba4f4b84b122f46e4ce29d42b33ba65f7",
    "examples/invalid/unapproved-geometry-crs.ttl": "55ddce1b00ec2939b65048e7c2666933f7e225ebdc04dfc3f4a9a08216d594d6",
    "examples/invalid/withheld-spatial-geometry.ttl": "c6ce924aed7e635ffef819fa724986a089d9c30f0e80d0425e923b73d7eeef76",
    "examples/valid/road-network-catalog.ttl": "a0c180cb9035f656d8bb166c06b8713b95ebd0ee35a2598854cc97e3ecd87e92",
    "examples/valid/traffic-observation-catalog.ttl": "36952b5325dd0633c78033ecf68b56495143e46e62c0e0f17f42ec85e19a5965",
}

EXPECTED_OBSERVATIONS = {
    "PDP-LANG-KR": (
        "adapter-normalization",
        "`kr` is Kanuri in the IANA registry; Korean text requires reviewed `ko` normalization.",
    ),
    "PDP-XSD-DATE-LEXICAL": (
        "datatype-lexical-error",
        "Date-time text is declared as xsd:date and is not a valid lexical form for that datatype.",
    ),
    "PDP-LITERAL-THEME": (
        "dcat-ap-conformance-error",
        "dcat:theme is emitted as a literal instead of a controlled concept resource.",
    ),
    "PDP-LITERAL-FREQUENCY": (
        "dcat-ap-conformance-error",
        "dct:accrualPeriodicity is emitted as a literal instead of a frequency resource.",
    ),
    "PDP-WRONG-FORMAT-PREDICATE": (
        "adapter-normalization",
        "The source dialect uses dcat:format where the target mapping expects dct:format.",
    ),
    "PDP-EMPTY-MEDIA-TYPE": (
        "dcat-ap-conformance-error",
        "dcat:mediaType is an empty literal rather than a media-type resource.",
    ),
    "PDP-BLANK-PUBLISHER": (
        "enrichment-required",
        "The publisher blank node requires resolution to an approved stable organization identifier.",
    ),
    "PDP-BLANK-CATALOG": (
        "enrichment-required",
        "The anonymous Catalog requires a stable identifier for managed harvesting and change tracking.",
    ),
    "PDP-COMBINED-KEYWORDS": (
        "adapter-normalization",
        "Comma-delimited source keywords require reviewed splitting; the literal is not treated as a DCAT-AP syntax error.",
    ),
    "PDP-PROFILE-MARKER-MISSING": (
        "molit-profile-requirement",
        "The source record does not assert the MOLIT 0.1.0 profile marker required by this project.",
    ),
}

# Approval is intentionally duplicated outside the mutable evidence register.
# Changing the public capture requires a review of this executable allow-list.
APPROVED_SNAPSHOTS: dict[str, dict[str, object]] = {
    "data-go-kr-linked-100299070": {
        "bytes": 2265,
        "expectedDisposition": "quarantine",
        "expectedShaclResults": 39,
        "landingPage": "https://www.data.go.kr/data/100299070/linkedData.do",
        "path": "fixtures/interoperability/data-go-kr-100299070.rdf",
        "requestAccept": "*/*",
        "responseContentType": "application/xml;charset=UTF-8",
        "retrievedAt": "2026-07-12T09:07:00Z",
        "sha256": "2e3d631d39d517d6aeb8ba4c63ef87a04963d7f6ce50560d33c519b0984f2115",
        "sourceUrl": "https://www.data.go.kr/dcat/metadata/linked/100299070",
        "sourceIds": ["SRC-KR-003"],
        # Filled from the canonical result multiset below.  It is not a count.
        "resultDigest": "fbfdab8ca485d566a6dacc61293b6f7b876dfc9e3c2da2dc7f8b27300dcd9ef2",
        "requirementIdMultiset": (
            ("MOLIT-CAT-001", 8),
            ("MOLIT-CV-FREQ-001", 2),
            ("MOLIT-CV-MEDIATYPE-001", 2),
            ("MOLIT-DS-001", 13),
            ("MOLIT-PROFILE-CORE-001", 2),
            ("MOLIT-QUAL-001", 1),
        ),
    }
}

# Each negative case pins both the count and the canonical result multiset.
EXAMPLE_CASES: tuple[
    tuple[str, str, str, bool, int, str, tuple[tuple[str, int], ...]], ...
] = (
    (
        "core-valid",
        "core",
        "examples/valid/traffic-observation-catalog.ttl",
        True,
        0,
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        (),
    ),
    (
        "geo-valid",
        "geo",
        "examples/valid/road-network-catalog.ttl",
        True,
        0,
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        (),
    ),
    (
        "core-invalid-title",
        "core",
        "examples/invalid/missing-korean-title.ttl",
        False,
        3,
        "ed7d5e339c297be1b3b7e1bb6ca857d3ca6bde0ae67debbc1e0a6605fbd351e2",
        (("MOLIT-DS-001", 3),),
    ),
    (
        "core-invalid-frequency",
        "core",
        "examples/invalid/unapproved-frequency.ttl",
        False,
        3,
        "3c2bafbaefe34dd2ae66b22a8f70a13ae4983374bd9e67eb7feb2eef4a7e6201",
        (("MOLIT-CV-FREQ-001", 1), ("MOLIT-DS-001", 2)),
    ),
    (
        "geo-invalid-withheld",
        "geo",
        "examples/invalid/withheld-spatial-geometry.ttl",
        False,
        6,
        "610948f186d717bf82695aabe410879d5712604bf7d84e4298e849858e368c83",
        (
            ("MOLIT-DS-001", 2),
            ("MOLIT-GEO-001", 1),
            ("MOLIT-GEO-DISCLOSURE-001", 1),
            ("MOLIT-GEO-LINK-001", 1),
            ("MOLIT-GEO-LINK-002", 1),
        ),
    ),
    (
        "geo-invalid-crs",
        "geo",
        "examples/invalid/unapproved-geometry-crs.ttl",
        False,
        3,
        "1a50cb24d5cd88e561ac5461f593d854055396b5f06f83e9c63fbd1bad1170bb",
        (("MOLIT-DS-001", 2), ("MOLIT-GEO-ENCODING-003", 1)),
    ),
)

_DATE_RE = re.compile(
    r"^(-?(?:[1-9][0-9]{3,}|0[0-9]{3}))-([0-9]{2})-([0-9]{2})"
    r"(Z|[+-][0-9]{2}:[0-9]{2})?$"
)
_FORBIDDEN_XML_DECLARATIONS = (
    ("DOCTYPE", re.compile(r"<!\s*DOCTYPE\b", re.IGNORECASE)),
    ("ENTITY", re.compile(r"<!\s*ENTITY\b", re.IGNORECASE)),
)
_XINCLUDE_NAMESPACE = "http://www.w3.org/2001/XInclude"


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _portable_relative_parts(relative: str) -> tuple[str, ...]:
    if not isinstance(relative, str) or not relative or "\x00" in relative:
        raise ValueError("path must be a non-empty string without NUL")
    if "\\" in relative or ":" in relative or re.match(r"^[A-Za-z]:", relative):
        raise ValueError("path must use portable release-relative '/' separators")
    raw_parts = relative.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        raise ValueError("path contains an empty, current, or parent segment")
    parsed = PurePosixPath(relative)
    if parsed.is_absolute() or tuple(parsed.parts) != tuple(raw_parts):
        raise ValueError("path must be a normalized relative POSIX path")
    reserved = {"CON", "PRN", "AUX", "NUL"} | {
        f"{prefix}{number}"
        for prefix in ("COM", "LPT")
        for number in range(1, 10)
    }
    for part in raw_parts:
        if part.endswith((" ", ".")) or part.split(".", 1)[0].upper() in reserved:
            raise ValueError("path contains a Windows device-like or aliased segment")
    return tuple(raw_parts)


def _is_link_or_reparse(path: Path) -> bool:
    metadata = path.lstat()
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    attributes = getattr(metadata, "st_file_attributes", 0)
    return stat.S_ISLNK(metadata.st_mode) or bool(reparse_flag and attributes & reparse_flag)


def read_confined_regular_file(
    root: Path,
    relative: str,
    *,
    max_bytes: int,
) -> bytes:
    """Read one regular file once without following release-tree links."""

    parts = _portable_relative_parts(relative)
    if max_bytes < 0:
        raise ValueError("max_bytes must not be negative")
    if _is_link_or_reparse(root):
        raise ValueError(f"confinement root must not be a link or reparse point: {root}")
    root_resolved = root.resolve(strict=True)
    candidate = root
    for part in parts:
        candidate = candidate / part
        if _is_link_or_reparse(candidate):
            raise ValueError(f"linked path component is not allowed: {relative}")
    candidate_resolved = candidate.resolve(strict=True)
    try:
        candidate_resolved.relative_to(root_resolved)
    except ValueError as cause:
        raise ValueError(f"path escaped its confinement root: {relative}") from cause

    before = candidate.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError(f"path is not a regular file: {relative}")
    if before.st_size > max_bytes:
        raise ValueError(f"file exceeds {max_bytes} bytes: {relative}")

    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(candidate, flags)
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            raise ValueError(f"opened path is not a regular file: {relative}")
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError(f"file identity changed before open: {relative}")
        if opened.st_size > max_bytes:
            raise ValueError(f"file exceeds {max_bytes} bytes: {relative}")
        chunks: list[bytes] = []
        remaining = max_bytes + 1
        while remaining:
            chunk = os.read(descriptor, min(64 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        if len(payload) > max_bytes:
            raise ValueError(f"file exceeds {max_bytes} bytes: {relative}")
        return payload
    finally:
        os.close(descriptor)


def read_release_artifact(relative: str) -> bytes:
    _portable_relative_parts(relative)
    return read_confined_regular_file(
        ROOT,
        f"{RELEASE_RELATIVE_ROOT}/{relative}",
        max_bytes=MAX_RELEASE_ARTIFACT_BYTES,
    )


def _strict_json_object(payload: bytes, label: str) -> dict[str, Any]:
    try:
        source = payload.decode("utf-8")
    except UnicodeDecodeError as cause:
        raise ValueError(f"{label} must be strict UTF-8") from cause
    value = json.loads(source, object_pairs_hook=_reject_duplicate_json_keys)
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def list_release_machine_artifacts() -> list[str]:
    root_parts = _portable_relative_parts(RELEASE_RELATIVE_ROOT)
    directory = ROOT
    for part in root_parts:
        directory = directory / part
        if _is_link_or_reparse(directory):
            raise ValueError(f"linked release directory is not allowed: {directory}")
    if not directory.is_dir():
        raise ValueError("profile release root is not a directory")

    discovered: list[str] = []

    def walk(current: Path, relative_parent: str) -> None:
        with os.scandir(current) as entries:
            ordered = sorted(entries, key=lambda entry: entry.name)
        for entry in ordered:
            entry_path = Path(entry.path)
            relative = f"{relative_parent}/{entry.name}" if relative_parent else entry.name
            if _is_link_or_reparse(entry_path):
                raise ValueError(f"linked release entry is not allowed: {relative}")
            if entry.is_dir(follow_symlinks=False):
                walk(entry_path, relative)
            elif entry.is_file(follow_symlinks=False):
                if (
                    relative != "artifact-lock.json"
                    and PurePosixPath(relative).suffix.lower() in MACHINE_ARTIFACT_EXTENSIONS
                ):
                    discovered.append(relative)
            else:
                raise ValueError(f"non-regular release entry is not allowed: {relative}")

    walk(directory, "")
    return sorted(discovered)


def load_verified_release_artifacts() -> tuple[dict[str, bytes], str]:
    lock_payload = read_confined_regular_file(
        ROOT,
        ARTIFACT_LOCK_RELATIVE_PATH,
        max_bytes=MAX_REGISTER_BYTES,
    )
    lock = _strict_json_object(lock_payload, "profile artifact lock")
    if lock.get("schemaVersion") != "molit.profile-artifact-lock/1":
        raise ValueError("profile artifact lock schemaVersion is not approved")
    if lock.get("profileVersion") != "0.1.0":
        raise ValueError("profile artifact lock profileVersion is not approved")
    if lock.get("networkFetchAtRuntime") is not False:
        raise ValueError("profile artifact lock must prohibit runtime network fetches")
    records = lock.get("artifacts")
    if not isinstance(records, list):
        raise ValueError("profile artifact lock artifacts must be an array")

    by_path: dict[str, dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("profile artifact lock record must be an object")
        relative = record.get("path")
        if not isinstance(relative, str):
            raise ValueError("profile artifact lock path must be a string")
        _portable_relative_parts(relative)
        if (
            relative == "artifact-lock.json"
            or PurePosixPath(relative).suffix.lower() not in MACHINE_ARTIFACT_EXTENSIONS
        ):
            raise ValueError(f"profile artifact lock path is not a machine artifact: {relative}")
        if relative in by_path:
            raise ValueError(f"duplicate profile artifact lock path: {relative}")
        digest = record.get("sha256")
        if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
            raise ValueError(f"profile artifact digest is invalid: {relative}")
        for field in ("license", "version"):
            if not isinstance(record.get(field), str) or not record[field]:
                raise ValueError(f"profile artifact provenance is incomplete: {relative}/{field}")
        provenance_locator = record.get("origin") or record.get("source")
        if not isinstance(provenance_locator, str) or not provenance_locator:
            raise ValueError(f"profile artifact provenance is incomplete: {relative}/origin-or-source")
        by_path[relative] = record

    discovered = list_release_machine_artifacts()
    if set(by_path) != set(discovered) or len(by_path) != len(discovered):
        raise ValueError(
            "profile artifact inventory drift: "
            f"added={sorted(set(discovered) - set(by_path))!r}, "
            f"removed={sorted(set(by_path) - set(discovered))!r}"
        )

    payloads: dict[str, bytes] = {}
    for relative in discovered:
        payload = read_release_artifact(relative)
        digest = hashlib.sha256(payload).hexdigest()
        if digest != by_path[relative]["sha256"]:
            raise ValueError(
                f"profile artifact digest mismatch: {relative}: "
                f"{digest} != {by_path[relative]['sha256']}"
            )
        payloads[relative] = payload
    for relative, approved_digest in APPROVED_RELEASE_INPUT_SHA256.items():
        if relative not in payloads:
            raise ValueError(f"approved release input is absent from the lock: {relative}")
        actual_digest = hashlib.sha256(payloads[relative]).hexdigest()
        if actual_digest != approved_digest:
            raise ValueError(
                f"executable release input approval drift: {relative}: "
                f"{actual_digest} != {approved_digest}"
            )
    return payloads, hashlib.sha256(lock_payload).hexdigest()


def read_snapshot_payload(relative: str) -> bytes:
    parts = _portable_relative_parts(relative)
    required_prefix = ("fixtures", "interoperability")
    if parts[: len(required_prefix)] != required_prefix or len(parts) <= len(required_prefix):
        raise ValueError("snapshot path must be below fixtures/interoperability")
    return read_confined_regular_file(
        ROOT,
        relative,
        max_bytes=MAX_PORTAL_SNAPSHOT_BYTES,
    )


def assert_safe_rdfxml(payload: bytes) -> str:
    if len(payload) > MAX_PORTAL_SNAPSHOT_BYTES:
        raise ValueError(f"RDF/XML snapshot exceeds {MAX_PORTAL_SNAPSHOT_BYTES} bytes")
    try:
        source = payload.decode("utf-8")
    except UnicodeDecodeError as cause:
        raise ValueError("RDF/XML snapshot must be strict UTF-8") from cause
    expanded_character_references = html.unescape(source)
    for label, pattern in _FORBIDDEN_XML_DECLARATIONS:
        if pattern.search(expanded_character_references):
            raise ValueError(f"RDF/XML snapshot contains forbidden {label} markup")
    if _XINCLUDE_NAMESPACE in expanded_character_references:
        raise ValueError("RDF/XML snapshot contains forbidden XInclude markup")
    return source


def parse_graph_bytes(payload: bytes, rdf_format: str, public_id: str) -> Graph:
    graph = Graph()
    graph.parse(data=payload, format=rdf_format, publicID=public_id)
    return graph


def require_pinned_dependencies() -> dict[str, str]:
    return _installed_dependency_versions()


def _canonical_report_lines(report: Graph) -> tuple[list[str], Graph]:
    canonical = to_canonical_graph(report)
    lines = sorted(
        f"{subject.n3()} {predicate.n3()} {value.n3()} ."
        for subject, predicate, value in canonical
    )
    return lines, canonical


_SHAPE_CONTAINMENT_PREDICATES = frozenset(
    {
        RDF.first,
        RDF.rest,
        SH["and"],
        SH["condition"],
        SH["node"],
        SH["not"],
        SH["or"],
        SH["property"],
        SH["qualifiedValueShape"],
        SH["xone"],
    }
)


def _requirement_ids_for_source_shape(shapes: Graph, source_shape: object) -> set[str]:
    queue = [source_shape]
    visited: set[object] = set()
    requirement_ids: set[str] = set()
    while queue:
        node = queue.pop()
        if node in visited:
            continue
        visited.add(node)
        for requirement_id in shapes.objects(node, MOLIT_REQUIREMENT_ID):
            if isinstance(requirement_id, Literal):
                requirement_ids.add(str(requirement_id))
        for parent, predicate in shapes.subject_predicates(node):
            if predicate in _SHAPE_CONTAINMENT_PREDICATES:
                queue.append(parent)
    return requirement_ids


def _objects_from_graphs(graphs: tuple[Graph, ...], subject: object, predicate: URIRef) -> list[object]:
    values: list[object] = []
    for graph in graphs:
        values.extend(graph.objects(subject, predicate))
    return values


def _normalize_result_path(
    term: object,
    graphs: tuple[Graph, ...],
    seen: frozenset[object] = frozenset(),
) -> object:
    if isinstance(term, URIRef):
        return {"kind": "iri", "value": str(term)}
    if not isinstance(term, BNode):
        return {"kind": getattr(term, "termType", type(term).__name__)}
    if term in seen:
        return {"kind": "cycle"}
    next_seen = seen | {term}
    operators = (
        (SH["inversePath"], "inverse"),
        (SH["zeroOrMorePath"], "zero-or-more"),
        (SH["oneOrMorePath"], "one-or-more"),
        (SH["zeroOrOnePath"], "zero-or-one"),
    )
    for predicate, label in operators:
        values = _objects_from_graphs(graphs, term, predicate)
        if values:
            return {
                "kind": label,
                "path": _normalize_result_path(values[0], graphs, next_seen),
            }
    alternatives = _objects_from_graphs(graphs, term, SH["alternativePath"])
    if alternatives:
        return {
            "kind": "alternative",
            "paths": _normalize_result_path(alternatives[0], graphs, next_seen),
        }
    first = _objects_from_graphs(graphs, term, RDF.first)
    if first:
        items: list[object] = []
        cursor: object = term
        list_seen: set[object] = set()
        while cursor != RDF.nil:
            if cursor in list_seen:
                return {"kind": "cycle"}
            list_seen.add(cursor)
            values = _objects_from_graphs(graphs, cursor, RDF.first)
            rest = _objects_from_graphs(graphs, cursor, RDF.rest)
            if len(values) != 1 or len(rest) != 1:
                return {"kind": "complex-path"}
            items.append(_normalize_result_path(values[0], graphs, next_seen | list_seen))
            cursor = rest[0]
        return {"kind": "sequence", "paths": items}
    return {"kind": "complex-path"}


def _value_descriptor(term: object) -> dict[str, object]:
    if isinstance(term, Literal):
        return {
            "kind": "literal",
            "datatype": str(term.datatype) if term.datatype else None,
            "language": term.language.casefold() if term.language else None,
        }
    if isinstance(term, URIRef):
        return {"kind": "iri"}
    if isinstance(term, BNode):
        return {"kind": "blank-node"}
    return {"kind": getattr(term, "termType", type(term).__name__)}


def _iri_or_kind(term: object) -> str:
    if isinstance(term, URIRef):
        return str(term)
    return f"[{getattr(term, 'termType', type(term).__name__)}]"


def result_evidence(report: Graph, *, shapes: Graph, data: Graph) -> dict[str, object]:
    lines, canonical = _canonical_report_lines(report)
    signature_counts: Counter[str] = Counter()
    requirement_counts: Counter[str] = Counter()
    for result_node in set(report.objects(None, SH.result)):
        source_shapes = list(report.objects(result_node, SH.sourceShape))
        requirement_ids: set[str] = set()
        for source_shape in source_shapes:
            requirement_ids.update(_requirement_ids_for_source_shape(shapes, source_shape))
        requirement_counts.update(requirement_ids)

        focus_types = sorted(
            {
                _iri_or_kind(focus_type)
                for focus in report.objects(result_node, SH.focusNode)
                for focus_type in data.objects(focus, RDF.type)
            }
        )
        paths = [
            _normalize_result_path(path_term, (report, shapes))
            for path_term in report.objects(result_node, SH.resultPath)
        ]
        paths.sort(
            key=lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True)
        )
        value_descriptors = [
            _value_descriptor(value)
            for value in report.objects(result_node, SH.value)
        ]
        value_descriptors.sort(
            key=lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True)
        )
        normalized = {
            "focusTypes": focus_types,
            "paths": paths,
            "requirementIds": sorted(requirement_ids),
            "severities": sorted(
                _iri_or_kind(value)
                for value in report.objects(result_node, SH.resultSeverity)
            ),
            "sourceConstraintComponents": sorted(
                _iri_or_kind(value)
                for value in report.objects(result_node, SH.sourceConstraintComponent)
            ),
            "values": value_descriptors,
        }
        serialized = json.dumps(
            normalized,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        signature_counts[hashlib.sha256(serialized).hexdigest()] += 1
    multiset = [
        {"count": count, "signature": signature}
        for signature, count in sorted(signature_counts.items())
    ]
    multiset_bytes = json.dumps(
        multiset,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    report_bytes = "\n".join(lines).encode("utf-8")
    return {
        "reportDigest": hashlib.sha256(report_bytes).hexdigest(),
        "requirementIdMultiset": [
            {"count": count, "requirementId": requirement_id}
            for requirement_id, count in sorted(requirement_counts.items())
        ],
        "resultCount": sum(signature_counts.values()),
        "resultDigest": hashlib.sha256(multiset_bytes).hexdigest(),
        "resultMultiset": multiset,
    }


def run_shacl(
    data: Graph,
    *,
    bundle_name: str,
    support_payload: bytes,
    bundle_payload: bytes,
) -> dict[str, object]:
    support = parse_graph_bytes(
        support_payload,
        "turtle",
        "https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0/bundles/support.ttl",
    )
    shapes = parse_graph_bytes(
        bundle_payload,
        "turtle",
        f"https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0/bundles/{bundle_name}.ttl",
    )
    data_with_support = Graph()
    for statement in data:
        data_with_support.add(statement)
    for statement in support:
        data_with_support.add(statement)
    conforms, report, _ = validate(
        data_with_support,
        shacl_graph=shapes,
        inference="none",
        abort_on_first=False,
        allow_infos=True,
        allow_warnings=True,
        meta_shacl=False,
        advanced=False,
        js=False,
        iterate_rules=False,
        do_owl_imports=False,
    )
    evidence = result_evidence(report, shapes=shapes, data=data_with_support)
    return {"conforms": bool(conforms), **evidence}


def _assert_outcome(
    case_id: str,
    outcome: dict[str, object],
    *,
    expected_conforms: bool,
    expected_count: int,
    expected_digest: str,
    expected_requirements: tuple[tuple[str, int], ...],
) -> None:
    problems: list[str] = []
    if outcome["conforms"] is not expected_conforms:
        problems.append(f"conforms={outcome['conforms']!r}, expected {expected_conforms!r}")
    if outcome["resultCount"] != expected_count:
        problems.append(f"results={outcome['resultCount']!r}, expected {expected_count!r}")
    if outcome["resultDigest"] != expected_digest:
        problems.append(
            f"resultDigest={outcome['resultDigest']!r}, expected {expected_digest!r}"
        )
    expected_requirement_multiset = [
        {"count": count, "requirementId": requirement_id}
        for requirement_id, count in sorted(expected_requirements)
    ]
    if outcome["requirementIdMultiset"] != expected_requirement_multiset:
        problems.append(
            "requirementIdMultiset="
            f"{outcome['requirementIdMultiset']!r}, expected {expected_requirement_multiset!r}"
        )
    if problems:
        raise AssertionError(f"{case_id}: " + "; ".join(problems))


def check_examples(
    release_payloads: dict[str, bytes],
    support_payload: bytes,
    bundle_payloads: dict[str, bytes],
) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for (
        case_id,
        bundle,
        relative_path,
        expected_conforms,
        expected_count,
        expected_digest,
        expected_requirements,
    ) in EXAMPLE_CASES:
        payload = release_payloads[relative_path]
        graph = parse_graph_bytes(
            payload,
            "turtle",
            f"https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0/{relative_path}",
        )
        outcome = run_shacl(
            graph,
            bundle_name=bundle,
            support_payload=support_payload,
            bundle_payload=bundle_payloads[bundle],
        )
        _assert_outcome(
            case_id,
            outcome,
            expected_conforms=expected_conforms,
            expected_count=expected_count,
            expected_digest=expected_digest,
            expected_requirements=expected_requirements,
        )
        results.append({"caseId": case_id, "bundle": bundle, **outcome})
    return results


def valid_xsd_date(value: str) -> bool:
    match = _DATE_RE.fullmatch(value)
    if not match:
        return False
    year_text, month_text, day_text, timezone = match.groups()
    digits = year_text.removeprefix("-")
    if not digits.strip("0"):
        return False
    month = int(month_text)
    day = int(day_text)
    if not 1 <= month <= 12 or day < 1:
        return False
    year_mod_400 = int(digits[-4:]) % 400
    leap = year_mod_400 % 4 == 0 and (
        year_mod_400 % 100 != 0 or year_mod_400 == 0
    )
    month_lengths = (31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
    if day > month_lengths[month - 1]:
        return False
    if timezone and timezone != "Z":
        hours = int(timezone[1:3])
        minutes = int(timezone[4:6])
        if minutes > 59 or hours > 14 or (hours == 14 and minutes != 0):
            return False
    return True


def detect_portal_defects(graph: Graph, profile_iri: URIRef) -> set[str]:
    defects: set[str] = set()
    # "kr" is the registered BCP 47 code for Kanuri.  The portal used it on
    # Korean text, so this is an adapter normalization error, not an unknown tag.
    if any(
        isinstance(term, Literal)
        and term.language is not None
        and term.language.casefold() == "kr"
        for term in graph.all_nodes()
    ):
        defects.add("PDP-LANG-KR")
    if any(
        isinstance(term, Literal)
        and term.datatype == XSD_DATE
        and not valid_xsd_date(str(term))
        for term in graph.all_nodes()
    ):
        defects.add("PDP-XSD-DATE-LEXICAL")
    if any(isinstance(value, Literal) for value in graph.objects(None, DCAT.theme)):
        defects.add("PDP-LITERAL-THEME")
    if any(isinstance(value, Literal) for value in graph.objects(None, DCT.accrualPeriodicity)):
        defects.add("PDP-LITERAL-FREQUENCY")
    if any(True for _ in graph.triples((None, DCAT["format"], None))):
        defects.add("PDP-WRONG-FORMAT-PREDICATE")
    if any(
        isinstance(value, Literal) and str(value).strip() == ""
        for value in graph.objects(None, DCAT.mediaType)
    ):
        defects.add("PDP-EMPTY-MEDIA-TYPE")
    if any(isinstance(value, BNode) for value in graph.objects(None, DCT.publisher)):
        defects.add("PDP-BLANK-PUBLISHER")
    if any(isinstance(subject, BNode) for subject in graph.subjects(RDF.type, DCAT.Catalog)):
        defects.add("PDP-BLANK-CATALOG")
    if any(
        isinstance(value, Literal) and "," in str(value)
        for value in graph.objects(None, DCAT.keyword)
    ):
        defects.add("PDP-COMBINED-KEYWORDS")

    profile_focuses = set(graph.subjects(RDF.type, DCAT.Catalog)) | set(
        graph.subjects(RDF.type, DCAT.CatalogRecord)
    )
    if not profile_focuses or any(
        profile_iri not in set(graph.objects(focus, DCT.conformsTo))
        for focus in profile_focuses
    ):
        defects.add("PDP-PROFILE-MARKER-MISSING")
    return defects


def load_evidence_register() -> tuple[dict[str, Any], str]:
    payload = read_confined_regular_file(
        ROOT,
        REGISTER_RELATIVE_PATH,
        max_bytes=MAX_REGISTER_BYTES,
    )
    register = _strict_json_object(payload, "evidence register")
    return register, hashlib.sha256(payload).hexdigest()


def approved_snapshot_records(register: dict[str, Any]) -> list[dict[str, Any]]:
    snapshots = register.get("snapshots")
    if not isinstance(snapshots, list):
        raise ValueError("evidence register snapshots must be an array")
    ids = [snapshot.get("id") if isinstance(snapshot, dict) else None for snapshot in snapshots]
    duplicates = sorted({item for item in ids if item is not None and ids.count(item) > 1})
    actual_ids = {item for item in ids if isinstance(item, str)}
    expected_ids = set(APPROVED_SNAPSHOTS)
    if duplicates or len(actual_ids) != len(ids) or actual_ids != expected_ids:
        raise ValueError(
            "public snapshot inventory differs from the executable allow-list: "
            f"duplicates={duplicates!r}, expected={sorted(expected_ids)!r}, actual={ids!r}"
        )

    by_id = {snapshot["id"]: snapshot for snapshot in snapshots}
    approved: list[dict[str, Any]] = []
    for snapshot_id in sorted(expected_ids):
        snapshot = by_id[snapshot_id]
        pinned = APPROVED_SNAPSHOTS[snapshot_id]
        for field in (
            "bytes",
            "expectedDisposition",
            "expectedShaclResults",
            "landingPage",
            "path",
            "requestAccept",
            "responseContentType",
            "retrievedAt",
            "sha256",
            "sourceUrl",
            "sourceIds",
        ):
            if snapshot.get(field) != pinned[field]:
                raise ValueError(
                    f"{snapshot_id}: approved snapshot field drift for {field}: "
                    f"{snapshot.get(field)!r} != {pinned[field]!r}"
                )
        if snapshot.get("liveFetchInCi") is not False:
            raise ValueError(f"{snapshot_id}: liveFetchInCi must be false")
        observations = snapshot.get("observations")
        if not isinstance(observations, list):
            raise ValueError(f"{snapshot_id}: observations must be an array")
        normalized: list[tuple[str, str, str]] = []
        for observation in observations:
            if not isinstance(observation, dict) or set(observation) != {
                "code",
                "category",
                "finding",
            }:
                raise ValueError(f"{snapshot_id}: observation identity is invalid")
            code = observation.get("code")
            category = observation.get("category")
            finding = observation.get("finding")
            if (
                not isinstance(code, str)
                or not isinstance(category, str)
                or not isinstance(finding, str)
                or not 5 <= len(finding) <= 300
            ):
                raise ValueError(f"{snapshot_id}: observation values are invalid")
            normalized.append((code, category, finding))
        codes = [code for code, _category, _finding in normalized]
        expected_observations = {
            (code, category, finding)
            for code, (category, finding) in EXPECTED_OBSERVATIONS.items()
        }
        if (
            len(set(normalized)) != len(normalized)
            or len(set(codes)) != len(codes)
            or set(normalized) != expected_observations
        ):
            raise ValueError(
                f"{snapshot_id}: observation inventory drift: {sorted(normalized)!r}"
            )
        approved.append(snapshot)
    return approved


def check_portal_snapshots(
    snapshots: list[dict[str, Any]],
    *,
    support_payload: bytes,
    core_bundle_payload: bytes,
) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for snapshot in snapshots:
        snapshot_id = snapshot["id"]
        pinned = APPROVED_SNAPSHOTS[snapshot_id]
        if snapshot["bytes"] > MAX_PORTAL_SNAPSHOT_BYTES:
            raise AssertionError(f"{snapshot_id}: approved byte count exceeds the parser limit")
        payload = read_snapshot_payload(snapshot["path"])
        digest = hashlib.sha256(payload).hexdigest()
        if digest != snapshot["sha256"] or len(payload) != snapshot["bytes"]:
            raise AssertionError(f"{snapshot_id}: bytes do not match the evidence register")
        assert_safe_rdfxml(payload)

        # Parse the bytes that were hashed.  The file path is never reopened.
        logging.getLogger("rdflib.term").setLevel(logging.CRITICAL)
        graph = parse_graph_bytes(
            payload,
            "xml",
            f"urn:molit:public-portal-snapshot:{snapshot_id}:{digest}",
        )
        detected = detect_portal_defects(graph, PROFILE_IRI)
        observations = sorted(
            snapshot["observations"],
            key=lambda observation: (observation["code"], observation["category"]),
        )
        expected_codes = {observation["code"] for observation in observations}
        if detected != expected_codes:
            raise AssertionError(
                f"{snapshot_id}: defect classification drift: "
                f"expected {sorted(expected_codes)!r}, got {sorted(detected)!r}"
            )

        outcome = run_shacl(
            graph,
            bundle_name="core",
            support_payload=support_payload,
            bundle_payload=core_bundle_payload,
        )
        _assert_outcome(
            snapshot_id,
            outcome,
            expected_conforms=False,
            expected_count=snapshot["expectedShaclResults"],
            expected_digest=str(pinned["resultDigest"]),
            expected_requirements=tuple(pinned["requirementIdMultiset"]),
        )
        results.append(
            {
                "caseId": "PDP-REAL-001",
                "snapshotId": snapshot_id,
                "observations": observations,
                "sha256": digest,
                **outcome,
            }
        )
    return results


def runtime_evidence(dependencies: dict[str, str]) -> dict[str, object]:
    requirements = read_confined_regular_file(
        ROOT,
        REQUIREMENTS_RELATIVE_PATH,
        max_bytes=128 * 1024,
    )
    requirements_digest = hashlib.sha256(requirements).hexdigest()
    if requirements_digest != APPROVED_REQUIREMENTS_SHA256:
        raise ValueError(
            "independent dependency lock approval drift: "
            f"{requirements_digest} != {APPROVED_REQUIREMENTS_SHA256}"
        )
    return {
        "dependencies": dict(sorted(dependencies.items())),
        "expatVersion": pyexpat.EXPAT_VERSION,
        "installedDistributionContentSha256": dict(
            sorted(_PREIMPORT_CONTENT_DIGESTS.items())
        ),
        "networkPolicy": "python-audit-hook-deny-socket-and-process-spawn",
        "pythonBuild": list(platform.python_build()),
        "pythonCompiler": platform.python_compiler(),
        "pythonImplementation": platform.python_implementation(),
        "pythonVersion": platform.python_version(),
        "requirementsSha256": requirements_digest,
    }


def main() -> int:
    install_no_network_audit_hook()
    dependencies = require_pinned_dependencies()

    # Freeze every release input before the first validation.  Later filesystem
    # replacement cannot mix different revisions into one evidence document.
    release_payloads, artifact_lock_digest = load_verified_release_artifacts()
    support_payload = release_payloads["bundles/support.ttl"]
    bundle_payloads = {
        name: release_payloads[f"bundles/{name}.ttl"]
        for name in ("core", "geo")
    }
    register, register_digest = load_evidence_register()
    snapshots = approved_snapshot_records(register)

    output = {
        "schemaVersion": "molit.independent-shacl-check/2",
        "engine": {
            "name": "pySHACL",
            "version": dependencies["pyshacl"],
            "rdfLibrary": "rdflib",
            "rdfLibraryVersion": dependencies["rdflib"],
            "inference": "none",
            "networkImports": False,
        },
        "runtime": runtime_evidence(dependencies),
        "sourceEvidence": {
            "bundleSha256": {
                name: hashlib.sha256(payload).hexdigest()
                for name, payload in sorted(bundle_payloads.items())
            },
            "approvedReleaseInputSha256": dict(sorted(APPROVED_RELEASE_INPUT_SHA256.items())),
            "artifactLockSha256": artifact_lock_digest,
            "verifiedArtifactCount": len(release_payloads),
            "registerSha256": register_digest,
            "supportSha256": hashlib.sha256(support_payload).hexdigest(),
        },
        "examples": check_examples(release_payloads, support_payload, bundle_payloads),
        "portalSnapshots": check_portal_snapshots(
            snapshots,
            support_payload=support_payload,
            core_bundle_payload=bundle_payloads["core"],
        ),
    }
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
