import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";

function pythonCommand() {
  const candidates = process.platform === "win32"
    ? [{ command: "py", prefix: ["-3.12"] }]
    : [
        ...(process.env.PYTHON
          ? [{ command: process.env.PYTHON, prefix: [] }]
          : []),
        { command: "python3", prefix: [] },
        { command: "python", prefix: [] },
      ];
  for (const candidate of candidates) {
    const result = spawnSync(
      candidate.command,
      [...candidate.prefix, "-c", "import sys; raise SystemExit(0)"],
      {
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        shell: false,
        windowsHide: true,
      },
    );
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error("Python interpreter not found");
}

test("ST-INDEPENDENT-001: independent lane rejects parser and evidence escapes", () => {
  const python = pythonCommand();
  const source = String.raw`
import socket
import os
import subprocess
import sys
import tempfile
from copy import deepcopy
from pathlib import Path

from rdflib import BNode, Graph, Literal, RDF, URIRef

from tools.profile.independent_shacl import (
    APPROVED_SNAPSHOTS,
    DCAT,
    DCT,
    MACHINE_ARTIFACT_EXTENSIONS,
    MAX_PORTAL_SNAPSHOT_BYTES,
    PROFILE_IRI,
    SH,
    _strict_json_object,
    approved_snapshot_records,
    assert_safe_rdfxml,
    detect_portal_defects,
    install_no_network_audit_hook,
    load_evidence_register,
    read_confined_regular_file,
    result_evidence,
    valid_xsd_date,
)


def rejected(operation):
    try:
        operation()
    except (AssertionError, RuntimeError, ValueError):
        return
    raise AssertionError("operation unexpectedly succeeded")


assert MACHINE_ARTIFACT_EXTENSIONS == {
    ".csv", ".json", ".jsonld", ".nq", ".nt", ".rdf", ".sch", ".ttl", ".xml", ".xsd"
}

assert valid_xsd_date("2024-02-29")
assert valid_xsd_date("-0001-12-31Z")
for value in ("2026-02-30", "2026-99-99", "0000-01-01", "2026-01-01+14:01"):
    assert not valid_xsd_date(value), value

safe_xml = b'''<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>'''
assert assert_safe_rdfxml(safe_xml)
for payload in (
    b'<!DOCTYPE rdf:RDF SYSTEM "https://attacker.invalid/payload"><rdf:RDF/>',
    b'<!   DoCtYpE rdf:RDF SYSTEM "file:///secret"><rdf:RDF/>',
    b'<!DOCTYPE rdf:RDF [<!ENTITY x "boom">]><rdf:RDF/>',
    b'<rdf:RDF xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="file:///secret"/></rdf:RDF>',
    b'<rdf:RDF xmlns:xi="http://www.w3.org/2001/XInc&#108;ude"><xi:include href="file:///secret"/></rdf:RDF>',
    b'\xff',
    b'x' * (MAX_PORTAL_SNAPSHOT_BYTES + 1),
):
    rejected(lambda payload=payload: assert_safe_rdfxml(payload))

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / "safe.rdf").write_bytes(b"safe")
    assert read_confined_regular_file(root, "safe.rdf", max_bytes=4) == b"safe"
    for relative in (
        "../secret",
        "nested/../secret",
        "/absolute",
        "//server/share/x",
        "NUL.json",
        r"C:\\secret",
        r"\\\\server\\share\\x",
    ):
        rejected(lambda relative=relative: read_confined_regular_file(root, relative, max_bytes=4))
    rejected(lambda: read_confined_regular_file(root, "safe.rdf", max_bytes=3))
    link = root / "linked.rdf"
    try:
        link.symlink_to(root / "safe.rdf")
    except OSError:
        pass
    else:
        rejected(lambda: read_confined_regular_file(root, "linked.rdf", max_bytes=4))

snapshot_id = next(iter(APPROVED_SNAPSHOTS))
rejected(lambda: _strict_json_object(b'{"same":1,"same":2}', "duplicate probe"))
rejected(lambda: _strict_json_object(b'\xff', "UTF-8 probe"))
rejected(lambda: approved_snapshot_records({"snapshots": [{"id": snapshot_id}, {"id": snapshot_id}]}))
rejected(lambda: approved_snapshot_records({"snapshots": [{"id": snapshot_id}, {"id": "unapproved"}]}))
register, _register_digest = load_evidence_register()
assert len(approved_snapshot_records(register)) == 1
for field in (
    "landingPage", "retrievedAt", "requestAccept", "responseContentType", "sourceIds"
):
    changed_register = deepcopy(register)
    changed_register["snapshots"][0][field] = "changed"
    rejected(lambda changed_register=changed_register: approved_snapshot_records(changed_register))
changed_register = deepcopy(register)
changed_register["snapshots"][0]["observations"][0]["finding"] = "spoofed finding"
rejected(lambda: approved_snapshot_records(changed_register))

graph = Graph()
catalog_a = BNode("catalog-a")
catalog_b = URIRef("urn:catalog:b")
irrelevant = URIRef("urn:not-a-catalog")
graph.add((catalog_a, RDF.type, DCAT.Catalog))
graph.add((catalog_b, RDF.type, DCAT.Catalog))
graph.add((catalog_a, DCT.conformsTo, PROFILE_IRI))
graph.add((irrelevant, DCT.conformsTo, PROFILE_IRI))
assert "PDP-PROFILE-MARKER-MISSING" in detect_portal_defects(graph, PROFILE_IRI)
graph.add((catalog_b, DCT.conformsTo, PROFILE_IRI))
assert "PDP-PROFILE-MARKER-MISSING" not in detect_portal_defects(graph, PROFILE_IRI)

def report(report_id, result_id, focus_id, message, component=SH.MinCountConstraintComponent):
    value = Graph()
    report_node = BNode(report_id)
    result_node = BNode(result_id)
    value.add((report_node, SH.result, result_node))
    value.add((result_node, SH.focusNode, BNode(focus_id)))
    value.add((result_node, SH.resultMessage, Literal(message, lang="en")))
    value.add((result_node, SH.sourceConstraintComponent, component))
    return value

first = result_evidence(report("report-1", "result-1", "focus-1", "missing"), shapes=Graph(), data=Graph())
isomorphic = result_evidence(report("report-x", "result-x", "focus-x", "missing"), shapes=Graph(), data=Graph())
changed = result_evidence(report("report-x", "result-x", "focus-x", "different"), shapes=Graph(), data=Graph())
component_changed = result_evidence(
    report("report-x", "result-x", "focus-x", "missing", SH.MaxCountConstraintComponent),
    shapes=Graph(),
    data=Graph(),
)
assert first["resultDigest"] == isomorphic["resultDigest"]
assert first["resultDigest"] == changed["resultDigest"]
assert first["resultDigest"] != component_changed["resultDigest"]

install_no_network_audit_hook()
rejected(lambda: socket.getaddrinfo("example.com", 443))
rejected(lambda: socket.socket())
rejected(lambda: subprocess.run([sys.executable, "-c", "raise SystemExit(0)"], check=False))
rejected(lambda: os.system("echo blocked"))
rejected(lambda: os.spawnv(os.P_WAIT, sys.executable, [sys.executable, "-c", "raise SystemExit(0)"]))
`;
  const result = spawnSync(
    python.command,
    [...python.prefix, "-c", source],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      shell: false,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
