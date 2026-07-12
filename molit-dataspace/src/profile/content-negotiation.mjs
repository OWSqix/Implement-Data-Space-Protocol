function failure(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requestUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw failure("INVALID_NEGOTIATION_IRI", "request IRI must be an absolute HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw failure("INVALID_NEGOTIATION_IRI", "request IRI must be an absolute HTTPS URL without credentials or fragment");
  }
  return parsed;
}

function resourceIndex(contract) {
  if (!contract || typeof contract !== "object" || !Array.isArray(contract.resources)) {
    throw failure("INVALID_NEGOTIATION_CONTRACT", "content-negotiation contract has no resources");
  }
  const index = new Map();
  for (const resource of contract.resources) {
    if (!resource || !Array.isArray(resource.iris)
      || !resource.representations || typeof resource.representations !== "object") {
      throw failure("INVALID_NEGOTIATION_CONTRACT", "content-negotiation resource is malformed");
    }
    for (const iri of resource.iris) {
      const parsed = requestUrl(iri);
      if (parsed.search) {
        throw failure("INVALID_NEGOTIATION_CONTRACT", "published resource IRI must not contain a query", { iri });
      }
      if (index.has(iri)) {
        throw failure("INVALID_NEGOTIATION_CONTRACT", "published resource IRI is duplicated", { iri });
      }
      index.set(iri, resource);
    }
  }
  return index;
}

function acceptRanges(value) {
  if (value === undefined || value === null || String(value).trim() === "") return [];
  return String(value).split(",").map((part, order) => {
    const [rangeText, ...parameters] = part.trim().split(";");
    const range = rangeText.toLowerCase();
    if (!/^(?:\*\/\*|[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+))$/u.test(range)) {
      return null;
    }
    let quality = 1;
    for (const parameter of parameters) {
      const [name, raw] = parameter.trim().split("=");
      if (name?.toLowerCase() !== "q") continue;
      if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.test(raw ?? "")) return null;
      quality = Number(raw);
    }
    return { order, quality, range };
  }).filter(Boolean);
}

function matchSpecificity(range, mediaType) {
  if (range === mediaType) return 2;
  if (range === "*/*") return 0;
  const [rangeType, rangeSubtype] = range.split("/");
  const [type] = mediaType.split("/");
  return rangeType === type && rangeSubtype === "*" ? 1 : -1;
}

function selectMediaType(representations, accept, defaultMediaType) {
  const supported = Object.keys(representations);
  if (accept === undefined || accept === null || String(accept).trim() === "") {
    return supported.includes(defaultMediaType) ? defaultMediaType : null;
  }
  const ranges = acceptRanges(accept);
  const candidates = [];
  for (const [supportedOrder, mediaType] of supported.entries()) {
    const matches = ranges.map((range) => ({
      ...range,
      specificity: matchSpecificity(range.range, mediaType),
    })).filter(({ specificity }) => specificity >= 0).sort((left, right) => (
      right.specificity - left.specificity || left.order - right.order
    ));
    const selected = matches[0];
    if (!selected || selected.quality === 0) continue;
    candidates.push({
      mediaType,
      quality: selected.quality,
      rangeOrder: selected.order,
      specificity: selected.specificity,
      supportedOrder: mediaType === defaultMediaType ? -1 : supportedOrder,
    });
  }
  candidates.sort((left, right) => (
    right.quality - left.quality
      || right.specificity - left.specificity
      || left.rangeOrder - right.rangeOrder
      || left.supportedOrder - right.supportedOrder
  ));
  return candidates[0]?.mediaType ?? null;
}

export function selectContentNegotiationResponse({ accept, contract, iri }) {
  const index = resourceIndex(contract);
  const rules = contract.responseRules;
  if (!rules || rules.canonicalRedirect?.trailingSlash !== "remove"
    || rules.canonicalRedirect?.status !== 308
    || rules.canonicalRedirect?.preserveQuery !== true
    || !Array.isArray(rules.vary)
    || typeof rules.defaultMediaType !== "string") {
    throw failure("INVALID_NEGOTIATION_CONTRACT", "response rules are incomplete");
  }
  const parsed = requestUrl(iri);
  const canonicalRequestIri = `${parsed.origin}${parsed.pathname}`;
  const headers = { Vary: rules.vary.join(", ") };
  let resource = index.get(canonicalRequestIri);
  if (!resource && parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    const withoutSlash = `${parsed.origin}${parsed.pathname.slice(0, -1)}`;
    if (index.has(withoutSlash)) {
      return {
        artifact: null,
        headers: {
          ...headers,
          Location: `${withoutSlash}${parsed.search}`,
        },
        iri: withoutSlash,
        mediaType: null,
        status: rules.canonicalRedirect.status,
      };
    }
  }
  if (!resource) {
    return {
      artifact: null,
      headers,
      iri: canonicalRequestIri,
      mediaType: null,
      status: rules.notFound,
    };
  }
  const mediaType = selectMediaType(
    resource.representations,
    accept,
    rules.defaultMediaType,
  );
  if (mediaType === null) {
    return {
      artifact: null,
      headers,
      iri: canonicalRequestIri,
      mediaType: null,
      status: rules.unsupportedAccept,
    };
  }
  return {
    artifact: resource.representations[mediaType],
    headers: {
      ...headers,
      "Content-Type": mediaType,
    },
    iri: canonicalRequestIri,
    mediaType,
    status: 200,
  };
}
