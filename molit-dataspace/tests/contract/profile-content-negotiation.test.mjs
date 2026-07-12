import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { selectContentNegotiationResponse } from "../../src/profile/content-negotiation.mjs";
import { loadProfileRelease } from "../../src/profile/registry.mjs";
import { buildPublicationContract } from "../../tools/profile/build-publication-representations.mjs";

const release = await loadProfileRelease("1.0.0-rc.1");
const contract = buildPublicationContract(release);
const ontologyVersionIri = `https://data.molit.go.kr/def/molit-dcat-ap/${release.version}`;

test("PUBLICATION-HTTP-001: generated contract includes stable and versioned ontology IRIs", async () => {
  const schema = JSON.parse(await readFile(
    "contracts/content-negotiation-contract.v1.schema.json",
    "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(contract), true, JSON.stringify(validate.errors, null, 2));
  const ontology = contract.resources.find(({ iris }) => (
    iris.includes("https://data.molit.go.kr/def/molit-dcat-ap")
  ));
  assert.ok(ontology.iris.includes(ontologyVersionIri));
});

test("PUBLICATION-HTTP-002: exact Accept values select locked artifacts and emit Vary", () => {
  const expected = {
    "application/ld+json": "serializations/molit-dcat-ap.jsonld",
    "text/html": "ontology.html",
    "text/turtle": "ontology/molit-dcat-ap.ttl",
  };
  for (const [accept, artifact] of Object.entries(expected)) {
    assert.deepEqual(selectContentNegotiationResponse({
      accept,
      contract,
      iri: ontologyVersionIri,
    }), {
      artifact,
      headers: { "Content-Type": accept, Vary: "Accept" },
      iri: ontologyVersionIri,
      mediaType: accept,
      status: 200,
    });
  }
  assert.equal(selectContentNegotiationResponse({
    accept: "text/*;q=0.4, application/ld+json;q=0.9",
    contract,
    iri: ontologyVersionIri,
  }).mediaType, "application/ld+json");
  assert.equal(selectContentNegotiationResponse({
    accept: "*/*",
    contract,
    iri: ontologyVersionIri,
  }).mediaType, "text/html");
  assert.equal(selectContentNegotiationResponse({
    accept: "text/html;q=0, */*;q=1",
    contract,
    iri: ontologyVersionIri,
  }).mediaType, "application/ld+json");
  assert.equal(selectContentNegotiationResponse({
    contract,
    iri: ontologyVersionIri,
  }).mediaType, "text/html");
});

test("PUBLICATION-HTTP-003: unsupported Accept and unknown IRIs return 406 and 404", () => {
  assert.deepEqual(selectContentNegotiationResponse({
    accept: "application/rdf+xml",
    contract,
    iri: ontologyVersionIri,
  }), {
    artifact: null,
    headers: { Vary: "Accept" },
    iri: ontologyVersionIri,
    mediaType: null,
    status: 406,
  });
  assert.equal(selectContentNegotiationResponse({
    accept: "text/html",
    contract,
    iri: "https://data.molit.go.kr/profile/not-published",
  }).status, 404);
});

test("PUBLICATION-HTTP-004: a trailing slash redirects permanently to the canonical version IRI", () => {
  const versionIri = release.manifest.versionIri;
  assert.deepEqual(selectContentNegotiationResponse({
    accept: "text/turtle",
    contract,
    iri: `${versionIri}/?view=full`,
  }), {
    artifact: null,
    headers: {
      Location: `${versionIri}?view=full`,
      Vary: "Accept",
    },
    iri: versionIri,
    mediaType: null,
    status: 308,
  });
});

test("PUBLICATION-HTTP-005: duplicate resource IRIs and fragment-bearing requests fail closed", () => {
  const duplicated = structuredClone(contract);
  duplicated.resources[1].iris.push(duplicated.resources[0].iris[0]);
  assert.throws(
    () => selectContentNegotiationResponse({
      accept: "text/html",
      contract: duplicated,
      iri: release.manifest.versionIri,
    }),
    (error) => error.code === "INVALID_NEGOTIATION_CONTRACT",
  );
  assert.throws(
    () => selectContentNegotiationResponse({
      accept: "text/html",
      contract,
      iri: `${ontologyVersionIri}#TransferableDataset`,
    }),
    (error) => error.code === "INVALID_NEGOTIATION_IRI",
  );
});
