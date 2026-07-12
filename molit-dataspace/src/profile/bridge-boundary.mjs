const PROFILE_VERSION_IRIS = new Set([
  "https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0",
  "https://data.molit.go.kr/profile/molit-dcat-ap/0.1.0/geo",
]);
const PROFILE_IRI_PREFIX = "https://data.molit.go.kr/profile/molit-dcat-ap";

function values(node, property) {
  const value = node?.[property];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function hasType(node, type) {
  return values(node, "@type").includes(type);
}

function idValue(value) {
  return typeof value === "object" && value !== null ? value["@id"] : null;
}

function profileMarkers(node) {
  return values(node, "dct:conformsTo")
    .map(idValue)
    .filter((value) => value === PROFILE_IRI_PREFIX || value?.startsWith(`${PROFILE_IRI_PREFIX}/`));
}

function approvedProfileMarkers(node) {
  return profileMarkers(node).filter((value) => PROFILE_VERSION_IRIS.has(value));
}

function issue(code, path, message) {
  return { code, message, path };
}

export function assessDraftProjectionGaps(candidate) {
  const projection = candidate?.catalogProjection;
  const graph = Array.isArray(projection?.["@graph"]) ? projection["@graph"] : [];
  const issues = [];

  if (projection?.profileStatus !== "molit-dcat-ap-0.1.0-validated") {
    issues.push(issue(
      "CURRENT_PROJECTION_DECLARED_DRAFT",
      "catalogProjection.profileStatus",
      "current Catalog projection is explicitly a project draft",
    ));
  }
  if (!graph.some((node) => hasType(node, "dcat:Catalog"))) {
    issues.push(issue("MISSING_CATALOG", "catalogProjection.@graph", "dcat:Catalog is missing"));
  }
  if (!graph.some((node) => hasType(node, "dcat:CatalogRecord"))) {
    issues.push(issue(
      "MISSING_CATALOG_RECORD",
      "catalogProjection.@graph",
      "dcat:CatalogRecord is missing",
    ));
  }

  const catalogs = graph.filter((node) => hasType(node, "dcat:Catalog"));
  if (!catalogs.some((node) => approvedProfileMarkers(node).length > 0)) {
    issues.push(issue(
      "MISSING_CATALOG_PROFILE_CONFORMANCE",
      "catalogProjection.@graph[dcat:Catalog].dct:conformsTo",
      "Catalogue does not identify an approved MOLIT metadata profile release",
    ));
  }
  const records = graph.filter((node) => hasType(node, "dcat:CatalogRecord"));
  if (!records.some((node) => approvedProfileMarkers(node).length > 0)) {
    issues.push(issue(
      "MISSING_RECORD_PROFILE_CONFORMANCE",
      "catalogProjection.@graph[dcat:CatalogRecord].dct:conformsTo",
      "CatalogRecord does not identify an approved MOLIT metadata profile release",
    ));
  }
  for (const [kind, nodes] of [["CATALOG", catalogs], ["RECORD", records]]) {
    for (const [index, node] of nodes.entries()) {
      if (profileMarkers(node).length > 1) {
        issues.push(issue(
          `AMBIGUOUS_${kind}_PROFILE_CONFORMANCE`,
          `catalogProjection.@graph[${kind === "CATALOG" ? "dcat:Catalog" : "dcat:CatalogRecord"}][${index}].dct:conformsTo`,
          "A metadata profile marker must occur once; do not duplicate or mix Core and Geo",
        ));
      }
    }
  }
  const declaredMarkers = new Set([
    ...catalogs.flatMap(profileMarkers),
    ...records.flatMap(profileMarkers),
  ]);
  if (declaredMarkers.size > 1) {
    issues.push(issue(
      "PROFILE_CONFORMANCE_MISMATCH",
      "catalogProjection.@graph.dct:conformsTo",
      "Catalogue and CatalogRecord metadata profile markers do not agree",
    ));
  }

  const agents = new Set(graph
    .filter((node) => hasType(node, "foaf:Agent"))
    .map((node) => node["@id"]));
  for (const [index, node] of graph.entries()) {
    if (hasType(node, "dcat:Dataset")) {
      if (values(node, "dct:title").some((item) => typeof item === "string")) {
        issues.push(issue(
          "UNTAGGED_TITLE_LITERAL",
          `catalogProjection.@graph[${index}].dct:title`,
          "Dataset title has no language tag",
        ));
      }
      if (values(node, "dct:description").some((item) => typeof item === "string")) {
        issues.push(issue(
          "UNTAGGED_DESCRIPTION_LITERAL",
          `catalogProjection.@graph[${index}].dct:description`,
          "Dataset description has no language tag",
        ));
      }
      if (values(node, "dct:accessRights").some((item) => typeof item === "string")) {
        issues.push(issue(
          "LITERAL_ACCESS_RIGHTS",
          `catalogProjection.@graph[${index}].dct:accessRights`,
          "dct:accessRights must be a dct:RightsStatement IRI",
        ));
      }
      for (const publisher of values(node, "dct:publisher")) {
        if (!agents.has(idValue(publisher))) {
          issues.push(issue(
            "MISSING_AGENT_NODE",
            `catalogProjection.@graph[${index}].dct:publisher`,
            "publisher IRI has no foaf:Agent node in the graph",
          ));
        }
      }
    }
    if (hasType(node, "dcat:Distribution")) {
      if (values(node, "dct:format").some((item) => typeof item === "string")) {
        issues.push(issue(
          "LITERAL_FORMAT",
          `catalogProjection.@graph[${index}].dct:format`,
          "dct:format must be an approved File Type IRI",
        ));
      }
      if (values(node, "dcat:accessURL").length === 0) {
        issues.push(issue(
          "MISSING_ACCESS_URL",
          `catalogProjection.@graph[${index}].dcat:accessURL`,
          "Distribution has no public access URL",
        ));
      }
    }
    if (hasType(node, "dcat:DataService") && values(node, "dct:title").length === 0) {
      issues.push(issue(
        "MISSING_DATA_SERVICE_TITLE",
        `catalogProjection.@graph[${index}].dct:title`,
        "DataService has no title",
      ));
    }
  }

  return {
    blockingIssues: issues,
    profileReadyForRdfValidation: issues.length === 0,
    requiredProfileVersionIris: [...PROFILE_VERSION_IRIS],
    shaclValidationStillRequired: true,
  };
}
