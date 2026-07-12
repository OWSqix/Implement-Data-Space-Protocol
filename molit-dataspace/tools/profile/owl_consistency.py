#!/usr/bin/env python3
"""Offline OWL-RL consistency gate for MOLIT-DCAT-AP RC datasets."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

import owlrl
import rdflib
from owlrl import OWLRL_Semantics
from rdflib import BNode, Graph, Literal, URIRef
from rdflib.namespace import DCTERMS, OWL, RDF, RDFS, SKOS, XSD


EXPECTED_PYTHON = (3, 12)
EXPECTED_RDFLIB = "7.6.0"
EXPECTED_OWLRL = "7.6.2"
MAX_FILE_BYTES = 32 * 1024 * 1024
DCAT = rdflib.Namespace("http://www.w3.org/ns/dcat#")
FOAF = rdflib.Namespace("http://xmlns.com/foaf/0.1/")
QUDT = rdflib.Namespace("http://qudt.org/schema/qudt/")
PROV = rdflib.Namespace("http://www.w3.org/ns/prov#")
DQV = rdflib.Namespace("http://www.w3.org/ns/dqv#")
RDF_LANG_STRING = URIRef(f"{RDF}langString")
PROPERTY_DISJOINT_WITH = URIRef(f"{OWL}propertyDisjointWith")
ALL_DISJOINT_PROPERTIES = URIRef(f"{OWL}AllDisjointProperties")
DISTINCT_MEMBERS = URIRef(f"{OWL}distinctMembers")
DCAT_RESOURCE_TYPES = {
    DCAT.Catalog,
    DCAT.Dataset,
    DCAT.DatasetSeries,
    DCAT.DataService,
    DCAT.Resource,
}


def term_text(term: Any) -> str:
    if isinstance(term, Literal):
        if term.language:
            return f'"{term}"@{term.language}'
        if term.datatype:
            return f'"{term}"^^<{term.datatype}>'
        return f'"{term}"'
    if isinstance(term, BNode):
        return "_:blank"
    return str(term)


def add_finding(findings: list[dict[str, Any]], code: str, message: str, **details: Any) -> None:
    findings.append({
        "code": code,
        "message": message,
        **{key: value for key, value in details.items() if value is not None},
    })


def checked_local_file(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative or "\\" in relative or ":" in relative:
        raise ValueError(f"unsafe release-relative path: {relative!r}")
    parts = relative.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"unsafe release-relative path: {relative!r}")
    candidate = root.joinpath(*parts)
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"symlinked release input rejected: {relative}")
    resolved_root = root.resolve(strict=True)
    resolved = candidate.resolve(strict=True)
    if resolved_root not in resolved.parents:
        raise ValueError(f"release input escapes root: {relative}")
    if not resolved.is_file() or resolved.stat().st_size > MAX_FILE_BYTES:
        raise ValueError(f"bounded regular file required: {relative}")
    return resolved


def load_turtle(path: Path) -> Graph:
    data = path.read_text(encoding="utf-8", errors="strict")
    graph = Graph()
    # Parsing from text rather than a URL prevents rdflib from dereferencing inputs.
    graph.parse(data=data, format="turtle", publicID=path.as_uri())
    return graph


def merged_graph(*graphs: Graph) -> Graph:
    result = Graph()
    for graph in graphs:
        for triple in graph:
            result.add(triple)
    return result


def rdf_list(graph: Graph, head: Any) -> list[Any]:
    values: list[Any] = []
    seen: set[Any] = set()
    current = head
    while current != RDF.nil:
        if not isinstance(current, BNode) or current in seen or len(values) >= 10_000:
            raise ValueError("invalid or cyclic RDF list")
        seen.add(current)
        first = list(graph.objects(current, RDF.first))
        rest = list(graph.objects(current, RDF.rest))
        if len(first) != 1 or len(rest) != 1:
            raise ValueError("invalid RDF list cardinality")
        values.append(first[0])
        current = rest[0]
    return values


def equivalent_connected(graph: Graph, left: Any, right: Any, predicate: URIRef) -> bool:
    if left == right:
        return True
    pending = [left]
    seen: set[Any] = set()
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        adjacent = set(graph.objects(current, predicate)) | set(graph.subjects(predicate, current))
        if right in adjacent:
            return True
        pending.extend(adjacent - seen)
    return False


def subclass_of(graph: Graph, actual: URIRef, expected: URIRef) -> bool:
    if actual == expected:
        return True
    pending = [actual]
    seen: set[URIRef] = set()
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        for parent in graph.objects(current, RDFS.subClassOf):
            if not isinstance(parent, URIRef):
                continue
            if parent == expected:
                return True
            pending.append(parent)
        for equivalent in graph.objects(current, OWL.equivalentClass):
            if isinstance(equivalent, URIRef):
                if equivalent == expected:
                    return True
                pending.append(equivalent)
    return False


def resource_matches_class(graph: Graph, resource: Any, expected: URIRef) -> bool:
    if isinstance(resource, Literal):
        return False
    types = {value for value in graph.objects(resource, RDF.type) if isinstance(value, URIRef)}
    if expected == RDFS.Resource:
        return True
    if expected == DCAT.Resource and any(value in DCAT_RESOURCE_TYPES for value in types):
        return True
    return any(subclass_of(graph, value, expected) for value in types)


def literal_datatype(value: Literal) -> URIRef:
    if value.language:
        return RDF_LANG_STRING
    return value.datatype or XSD.string


def datatype_matches(value: Literal, expected: URIRef) -> bool:
    actual = literal_datatype(value)
    if actual != expected:
        return False
    if value.ill_typed is True:
        return False
    lexical = str(value)
    if expected == XSD.hexBinary:
        return len(lexical) % 2 == 0 and re.fullmatch(r"[0-9A-Fa-f]*", lexical) is not None
    return True


def is_true_boolean(value: Any) -> bool:
    return (
        isinstance(value, Literal)
        and value.datatype == XSD.boolean
        and str(value) in {"true", "1"}
        and value.ill_typed is not True
    )


def local_property_findings(
    ontology: Graph,
    explicit: Graph,
    fixture: Graph,
    local_namespace: str,
    dataset_id: str,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    object_properties = set(ontology.subjects(RDF.type, OWL.ObjectProperty))
    datatype_properties = set(ontology.subjects(RDF.type, OWL.DatatypeProperty))
    annotation_properties = set(ontology.subjects(RDF.type, OWL.AnnotationProperty))
    declared = object_properties | datatype_properties | annotation_properties

    for subject, predicate, object_ in fixture:
        if not isinstance(predicate, URIRef) or not str(predicate).startswith(local_namespace):
            continue
        if predicate not in declared:
            add_finding(
                findings,
                "UNDECLARED_LOCAL_PROPERTY",
                "A fixture uses a local predicate that the ontology does not declare.",
                dataset=dataset_id,
                predicate=str(predicate),
            )
            continue
        if predicate in annotation_properties:
            continue
        domains = [value for value in ontology.objects(predicate, RDFS.domain) if isinstance(value, URIRef)]
        ranges = [value for value in ontology.objects(predicate, RDFS.range) if isinstance(value, URIRef)]
        if not domains:
            add_finding(
                findings,
                "PROPERTY_DOMAIN_MISSING",
                "A local data property has no declared domain.",
                dataset=dataset_id,
                predicate=str(predicate),
            )
        for expected in domains:
            if not resource_matches_class(explicit, subject, expected):
                add_finding(
                    findings,
                    "DOMAIN_TYPE_MISMATCH",
                    "The subject of a local property lacks an explicit compatible domain type.",
                    dataset=dataset_id,
                    predicate=str(predicate),
                    subject=term_text(subject),
                    expectedType=str(expected),
                )
        if predicate in object_properties:
            if isinstance(object_, Literal):
                add_finding(
                    findings,
                    "OBJECT_PROPERTY_LITERAL",
                    "An owl:ObjectProperty has a literal value.",
                    dataset=dataset_id,
                    predicate=str(predicate),
                    value=term_text(object_),
                )
                continue
            if not ranges:
                add_finding(
                    findings,
                    "PROPERTY_RANGE_MISSING",
                    "A local object property has no declared range.",
                    dataset=dataset_id,
                    predicate=str(predicate),
                )
            for expected in ranges:
                if not resource_matches_class(explicit, object_, expected):
                    add_finding(
                        findings,
                        "RANGE_TYPE_MISMATCH",
                        "The object of a local property lacks an explicit compatible range type.",
                        dataset=dataset_id,
                        predicate=str(predicate),
                        value=term_text(object_),
                        expectedType=str(expected),
                    )
        elif predicate in datatype_properties:
            if not isinstance(object_, Literal):
                add_finding(
                    findings,
                    "DATATYPE_PROPERTY_RESOURCE",
                    "An owl:DatatypeProperty has a non-literal value.",
                    dataset=dataset_id,
                    predicate=str(predicate),
                    value=term_text(object_),
                )
                continue
            if not ranges:
                add_finding(
                    findings,
                    "PROPERTY_RANGE_MISSING",
                    "A local datatype property has no declared datatype range.",
                    dataset=dataset_id,
                    predicate=str(predicate),
                )
            for expected in ranges:
                if not datatype_matches(object_, expected):
                    add_finding(
                        findings,
                        "DATATYPE_RANGE_MISMATCH",
                        "A local datatype-property value does not match its declared datatype.",
                        dataset=dataset_id,
                        predicate=str(predicate),
                        value=term_text(object_),
                        expectedDatatype=str(expected),
                    )
    return findings


def schema_consistency_findings(
    ontology: Graph,
    explicit_schema: Graph,
    local_namespace: str,
    config: dict[str, Any],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if any(True for _ in explicit_schema.triples((None, OWL.imports, None))):
        add_finding(
            findings,
            "OWL_IMPORTS_PROHIBITED",
            "The offline ontology gate rejects owl:imports.",
        )

    object_properties = {
        term for term in ontology.subjects(RDF.type, OWL.ObjectProperty)
        if str(term).startswith(local_namespace)
    }
    datatype_properties = {
        term for term in ontology.subjects(RDF.type, OWL.DatatypeProperty)
        if str(term).startswith(local_namespace)
    }
    for term in object_properties.intersection(datatype_properties):
        add_finding(
            findings,
            "PROPERTY_KIND_CONTRADICTION",
            "A local property is both owl:ObjectProperty and owl:DatatypeProperty.",
            term=term_text(term),
        )
    if config.get("requireExplicitDomainRangeTypes"):
        for term in object_properties | datatype_properties:
            domains = [value for value in ontology.objects(term, RDFS.domain) if isinstance(value, URIRef)]
            ranges = [value for value in ontology.objects(term, RDFS.range) if isinstance(value, URIRef)]
            if not domains:
                add_finding(
                    findings,
                    "PROPERTY_DOMAIN_MISSING",
                    "A local ontology property has no named rdfs:domain.",
                    term=term_text(term),
                )
            if not ranges:
                add_finding(
                    findings,
                    "PROPERTY_RANGE_MISSING",
                    "A local ontology property has no named rdfs:range.",
                    term=term_text(term),
                )
            for domain in domains:
                if str(domain).startswith(str(XSD)) or domain in {RDFS.Literal, RDF_LANG_STRING}:
                    add_finding(
                        findings,
                        "PROPERTY_DOMAIN_NOT_CLASS",
                        "A local property domain is a datatype rather than a resource class.",
                        term=term_text(term),
                        domain=term_text(domain),
                    )
            for range_ in ranges:
                is_datatype = (
                    str(range_).startswith(str(XSD))
                    or range_ in {RDFS.Literal, RDF_LANG_STRING}
                    or (range_, RDF.type, RDFS.Datatype) in explicit_schema
                )
                if term in object_properties and is_datatype:
                    add_finding(
                        findings,
                        "OBJECT_PROPERTY_DATATYPE_RANGE",
                        "An owl:ObjectProperty declares a datatype range.",
                        term=term_text(term),
                        range=term_text(range_),
                    )
                if term in datatype_properties and not is_datatype:
                    add_finding(
                        findings,
                        "DATATYPE_PROPERTY_RESOURCE_RANGE",
                        "An owl:DatatypeProperty declares a resource-class range.",
                        term=term_text(term),
                        range=term_text(range_),
                    )

    equivalence_predicates = {OWL.equivalentClass, OWL.equivalentProperty, OWL.sameAs}
    if config.get("prohibitLocalEquivalence"):
        for subject, predicate, object_ in ontology:
            if predicate not in equivalence_predicates:
                continue
            if str(subject).startswith(local_namespace) or str(object_).startswith(local_namespace):
                add_finding(
                    findings,
                    "LOCAL_EQUIVALENCE_PROHIBITED",
                    "Local terms must not erase semantic boundaries with OWL equivalence.",
                    subject=term_text(subject),
                    predicate=str(predicate),
                    object=term_text(object_),
                )

    disjoint_classes = set(explicit_schema.subject_objects(OWL.disjointWith))
    for node in explicit_schema.subjects(RDF.type, OWL.AllDisjointClasses):
        for head in explicit_schema.objects(node, OWL.members):
            values = rdf_list(explicit_schema, head)
            for index, left in enumerate(values):
                for right in values[index + 1 :]:
                    disjoint_classes.add((left, right))
    for left, right in disjoint_classes:
        if equivalent_connected(explicit_schema, left, right, OWL.equivalentClass):
            add_finding(
                findings,
                "EQUIVALENT_DISJOINT_CLASS",
                "Two classes are both equivalent and disjoint.",
                left=term_text(left),
                right=term_text(right),
            )
    disjoint_properties = set(explicit_schema.subject_objects(PROPERTY_DISJOINT_WITH))
    for node in explicit_schema.subjects(RDF.type, ALL_DISJOINT_PROPERTIES):
        for head in explicit_schema.objects(node, OWL.members):
            values = rdf_list(explicit_schema, head)
            for index, left in enumerate(values):
                for right in values[index + 1 :]:
                    disjoint_properties.add((left, right))
    for left, right in disjoint_properties:
        if equivalent_connected(explicit_schema, left, right, OWL.equivalentProperty):
            add_finding(
                findings,
                "EQUIVALENT_DISJOINT_PROPERTY",
                "Two properties are both equivalent and disjoint.",
                left=term_text(left),
                right=term_text(right),
            )

    deprecated: set[Any] = set()
    for term, _, marker in ontology.triples((None, OWL.deprecated, None)):
        if is_true_boolean(marker):
            deprecated.add(term)
        elif not (
            isinstance(marker, Literal)
            and marker.datatype == XSD.boolean
            and str(marker) in {"false", "0"}
            and marker.ill_typed is not True
        ):
            add_finding(
                findings,
                "DEPRECATED_MARKER_INVALID",
                "owl:deprecated must use a valid xsd:boolean lexical form.",
                term=term_text(term),
                value=term_text(marker),
            )
    replacement_graph: dict[Any, set[Any]] = {}
    for term in deprecated:
        replacements = set(ontology.objects(term, DCTERMS.isReplacedBy))
        replacement_graph[term] = replacements
        if config.get("requireDeprecatedReplacement") and not replacements:
            add_finding(
                findings,
                "DEPRECATED_REPLACEMENT_MISSING",
                "A deprecated local term has no dct:isReplacedBy target.",
                term=term_text(term),
            )
        if term in replacements:
            add_finding(
                findings,
                "DEPRECATED_SELF_REPLACEMENT",
                "A deprecated term replaces itself.",
                term=term_text(term),
            )
        for replacement in replacements:
            if any(equivalent_connected(ontology, term, replacement, predicate) for predicate in (
                OWL.equivalentClass,
                OWL.equivalentProperty,
                OWL.sameAs,
            )):
                add_finding(
                    findings,
                    "DEPRECATED_REPLACEMENT_EQUIVALENT",
                    "A deprecated term is declared equivalent to its replacement.",
                    term=term_text(term),
                    replacement=term_text(replacement),
                )

    def has_replacement_cycle(start: Any) -> bool:
        pending = list(replacement_graph.get(start, ()))
        seen: set[Any] = set()
        while pending:
            current = pending.pop()
            if current == start:
                return True
            if current in seen:
                continue
            seen.add(current)
            pending.extend(replacement_graph.get(current, ()))
        return False

    for term in deprecated:
        if has_replacement_cycle(term):
            add_finding(
                findings,
                "DEPRECATED_REPLACEMENT_CYCLE",
                "The deprecated replacement graph contains a cycle.",
                term=term_text(term),
            )
        pending = list(replacement_graph.get(term, ()))
        seen: set[Any] = set()
        has_terminal = False
        while pending:
            current = pending.pop()
            if current in seen:
                continue
            seen.add(current)
            if current not in deprecated:
                has_terminal = True
                break
            pending.extend(replacement_graph.get(current, ()))
        if replacement_graph.get(term) and not has_terminal:
            add_finding(
                findings,
                "DEPRECATED_REPLACEMENT_TERMINAL_MISSING",
                "The replacement chain has no non-deprecated terminal target.",
                term=term_text(term),
            )
    return findings


def closure_consistency_findings(
    explicit: Graph,
    closure: Graph,
    fixture: Graph,
    deprecated: set[Any],
    dataset_id: str,
    config: dict[str, Any],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for resource in closure.subjects(RDF.type, OWL.Nothing):
        add_finding(
            findings,
            "OWL_NOTHING_INSTANCE",
            "OWL-RL closure typed a resource as owl:Nothing.",
            dataset=dataset_id,
            resource=term_text(resource),
        )

    disjoint_pairs: set[tuple[Any, Any]] = set()
    for left, _, right in closure.triples((None, OWL.disjointWith, None)):
        disjoint_pairs.add((left, right))
    for node in closure.subjects(RDF.type, OWL.AllDisjointClasses):
        for head in closure.objects(node, OWL.members):
            values = rdf_list(closure, head)
            for index, left in enumerate(values):
                for right in values[index + 1 :]:
                    disjoint_pairs.add((left, right))
    for left, right in disjoint_pairs:
        left_instances = set(closure.subjects(RDF.type, left))
        for resource in left_instances.intersection(closure.subjects(RDF.type, right)):
            add_finding(
                findings,
                "DISJOINT_CLASS_INSTANCE",
                "A resource is typed as two disjoint classes.",
                dataset=dataset_id,
                resource=term_text(resource),
                left=term_text(left),
                right=term_text(right),
            )

    property_pairs: set[tuple[Any, Any]] = set(closure.subject_objects(PROPERTY_DISJOINT_WITH))
    for node in closure.subjects(RDF.type, ALL_DISJOINT_PROPERTIES):
        for head in closure.objects(node, OWL.members):
            values = rdf_list(closure, head)
            for index, left in enumerate(values):
                for right in values[index + 1 :]:
                    property_pairs.add((left, right))
    for left, right in property_pairs:
        left_assertions = {(subject, object_) for subject, _, object_ in closure.triples((None, left, None))}
        right_assertions = {(subject, object_) for subject, _, object_ in closure.triples((None, right, None))}
        for subject, object_ in left_assertions.intersection(right_assertions):
            add_finding(
                findings,
                "DISJOINT_PROPERTY_ASSERTION",
                "One subject/value pair uses two disjoint properties.",
                dataset=dataset_id,
                subject=term_text(subject),
                value=term_text(object_),
                left=term_text(left),
                right=term_text(right),
            )

    for left, _, right in closure.triples((None, OWL.differentFrom, None)):
        if (left, OWL.sameAs, right) in closure or (right, OWL.sameAs, left) in closure:
            add_finding(
                findings,
                "SAME_AND_DIFFERENT_RESOURCE",
                "Two resources are both owl:sameAs and owl:differentFrom.",
                dataset=dataset_id,
                left=term_text(left),
                right=term_text(right),
            )
    for node in closure.subjects(RDF.type, OWL.AllDifferent):
        heads = list(closure.objects(node, OWL.members)) + list(closure.objects(node, DISTINCT_MEMBERS))
        for head in heads:
            values = rdf_list(closure, head)
            for index, left in enumerate(values):
                for right in values[index + 1 :]:
                    if (left, OWL.sameAs, right) in closure or (right, OWL.sameAs, left) in closure:
                        add_finding(
                            findings,
                            "ALL_DIFFERENT_SAME_AS",
                            "Members of owl:AllDifferent are also owl:sameAs.",
                            dataset=dataset_id,
                            left=term_text(left),
                            right=term_text(right),
                        )

    if config.get("failOnDeprecatedFixtureUse"):
        for term in deprecated:
            for subject in fixture.subjects(RDF.type, term):
                add_finding(
                    findings,
                    "DEPRECATED_CLASS_IN_FIXTURE",
                    "A current valid fixture uses a deprecated class.",
                    dataset=dataset_id,
                    term=term_text(term),
                    subject=term_text(subject),
                )
            for subject, _, object_ in fixture.triples((None, term, None)):
                add_finding(
                    findings,
                    "DEPRECATED_PROPERTY_IN_FIXTURE",
                    "A current valid fixture uses a deprecated property.",
                    dataset=dataset_id,
                    term=term_text(term),
                    subject=term_text(subject),
                    value=term_text(object_),
                )
            for subject, predicate, object_ in fixture:
                if subject == term or (object_ == term and predicate != RDF.type):
                    add_finding(
                        findings,
                        "DEPRECATED_RESOURCE_IN_FIXTURE",
                        "A current valid fixture uses a deprecated resource.",
                        dataset=dataset_id,
                        term=term_text(term),
                        subject=term_text(subject),
                        predicate=term_text(predicate),
                    )
    return findings


def unique_sorted(findings: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    records = {json.dumps(item, ensure_ascii=False, sort_keys=True): item for item in findings}
    return [records[key] for key in sorted(records)]


def run_gate(release_root: Path, registry_path: Path) -> dict[str, Any]:
    raw = registry_path.read_text(encoding="utf-8", errors="strict")
    registry = json.loads(raw)
    base_paths = [checked_local_file(release_root, item) for item in registry["baseGraphs"]]
    ontology_path = checked_local_file(release_root, registry["baseGraphs"][0])
    ontology = load_turtle(ontology_path)
    base_graphs = [load_turtle(path) for path in base_paths]
    schema = merged_graph(*base_graphs)
    config = registry["owlConsistency"]
    schema_findings = schema_consistency_findings(
        ontology,
        schema,
        config["localNamespace"],
        config,
    )
    deprecated = {
        term
        for term, _, marker in ontology.triples((None, OWL.deprecated, None))
        if is_true_boolean(marker)
    }

    dataset_reports: list[dict[str, Any]] = []
    all_findings = list(schema_findings)
    for dataset in registry["datasets"]:
        fixture_path = checked_local_file(release_root, dataset["fixture"])
        fixture = load_turtle(fixture_path)
        explicit = merged_graph(schema, fixture)
        findings = local_property_findings(
            ontology,
            explicit,
            fixture,
            config["localNamespace"],
            dataset["id"],
        )
        closure = merged_graph(explicit)
        semantics = OWLRL_Semantics(closure, axioms=False, daxioms=True, rdfs=True)
        semantics.closure()
        for message in semantics.error_messages:
            add_finding(
                findings,
                "OWL_RL_RULE_ERROR",
                str(message),
                dataset=dataset["id"],
            )
        findings.extend(closure_consistency_findings(
            explicit,
            closure,
            fixture,
            deprecated,
            dataset["id"],
            config,
        ))
        findings = unique_sorted(findings)
        all_findings.extend(findings)
        dataset_reports.append({
            "id": dataset["id"],
            "module": dataset["module"],
            "fixture": dataset["fixture"],
            "explicitTriples": len(explicit),
            "closureTriples": len(closure),
            "findings": findings,
            "passed": not findings,
        })

    all_findings = unique_sorted(all_findings)
    return {
        "schemaVersion": "molit.owl-consistency-report/1",
        "profileVersion": registry["profileVersion"],
        "toolchain": {
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "rdflib": rdflib.__version__,
            "owlrl": owlrl.__version__,
            "inference": "OWL-RL",
            "networkAccess": "prohibited-local-bytes-only",
        },
        "schemaFindings": unique_sorted(schema_findings),
        "datasets": dataset_reports,
        "findings": all_findings,
        "gatePassed": not all_findings,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-root", required=True)
    parser.add_argument("--registry", required=True)
    arguments = parser.parse_args()
    version_findings: list[dict[str, Any]] = []
    if sys.version_info[:2] != EXPECTED_PYTHON:
        add_finding(
            version_findings,
            "PYTHON_VERSION_MISMATCH",
            "The OWL gate requires Python 3.12.",
            actual=f"{sys.version_info.major}.{sys.version_info.minor}",
        )
    if rdflib.__version__ != EXPECTED_RDFLIB:
        add_finding(
            version_findings,
            "RDFLIB_VERSION_MISMATCH",
            "The OWL gate requires the hash-pinned rdflib version.",
            actual=rdflib.__version__,
        )
    if owlrl.__version__ != EXPECTED_OWLRL:
        add_finding(
            version_findings,
            "OWLRL_VERSION_MISMATCH",
            "The OWL gate requires the hash-pinned owlrl version.",
            actual=owlrl.__version__,
        )
    if version_findings:
        report = {
            "schemaVersion": "molit.owl-consistency-report/1",
            "gatePassed": False,
            "findings": version_findings,
        }
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
        return 1
    try:
        release_root = Path(arguments.release_root).resolve(strict=True)
        registry_path = Path(arguments.registry).resolve(strict=True)
        if release_root not in registry_path.parents or registry_path.is_symlink():
            raise ValueError("registry must be a non-symlinked file below the release root")
        report = run_gate(release_root, registry_path)
    except Exception as error:  # Fail closed with a machine-readable diagnostic.
        report = {
            "schemaVersion": "molit.owl-consistency-report/1",
            "gatePassed": False,
            "findings": [{
                "code": "OWL_GATE_EXECUTION_ERROR",
                "message": str(error),
            }],
        }
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if report.get("gatePassed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
