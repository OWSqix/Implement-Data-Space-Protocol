# Reference Documents

Downloaded protocol references and upstream implementation source used while
planning and implementing this repository.

## Dataspace Protocol 2025-1

- Local file: `dataspace-protocol-2025-1.html`
- Source URL: https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1/
- Downloaded on: 2026-06-15
- Purpose: official DSP 2025-1 rendered specification baseline for the Python
  implementation plan.

## Upstream implementation source (cloned)

To study the implementations discussed in Posting 002 (DSP 2025-1) and Posting
003 (Eclipse EDC at code level), the following upstream repositories were
**shallow-cloned** (`git clone --depth 1`) into this directory on **2026-06-18**.

These clones are **local-only working copies**: each keeps its own `.git`, and
the containing folders are git-ignored by this repository (see `.gitignore`), so
they are never committed here. Refresh any clone with `git -C <path> pull`, or
re-run the fetch to recreate them. This README is the tracked manifest of what
was fetched and why.

### Eclipse EDC — `eclipse-edc/` (GitHub, branch `main`)

The EDC connector framework dissected in Posting 003. EDC is a Java/Gradle,
Apache-2.0 toolbox built on the Gaia-X Trust Framework + DSP baseline.

| Path | Source | Role (per postings) |
| --- | --- | --- |
| `eclipse-edc/Connector` | https://github.com/eclipse-edc/Connector | Core: control plane + data plane, DSP/`dataspace-protocol-http` impl, `StatefulEntity`/`StateMachineManager`, `ContractNegotiation(States)`, `TransferProcess(States)`, `DataFlowController`, policy engine, transformers. 103 decision records under `docs/developer/decision-records/`. |
| `eclipse-edc/IdentityHub` | https://github.com/eclipse-edc/IdentityHub | Identity Hub (DCP, DID/VC) **and** the Issuer Service (`core/issuerservice`, `spi/issuerservice`, `launcher/issuer-service`). |
| `eclipse-edc/FederatedCatalog` | https://github.com/eclipse-edc/FederatedCatalog | Federated Catalog crawler/cache. *(upstream archived — kept for reference)* |
| `eclipse-edc/RegistrationService` | https://github.com/eclipse-edc/RegistrationService | Dataspace participant Registration Service. *(upstream archived — kept for reference)* |
| `eclipse-edc/Samples` | https://github.com/eclipse-edc/Samples | Official usage samples / runnable extension examples. |
| `eclipse-edc/MinimumViableDataspace` | https://github.com/eclipse-edc/MinimumViableDataspace | End-to-end example dataspace wiring the components together. |
| `eclipse-edc/Runtime-Metamodel` | https://github.com/eclipse-edc/Runtime-Metamodel | SPI metamodel + annotations (`@Inject`, `@Provides`, `@Setting`, Autodoc). |
| `eclipse-edc/GradlePlugins` | https://github.com/eclipse-edc/GradlePlugins | Build tooling, incl. the `autodoc` plugin that emits `build/edc.json`. |

### Dataspace Protocol spec & TCK — `dataspace-protocol/`, `tck/` (GitHub, branch `main`)

| Path | Source | Role |
| --- | --- | --- |
| `dataspace-protocol/DataspaceProtocol` | https://github.com/eclipse-dataspace-protocol-base/DataspaceProtocol | DSP specification source (the standard itself, governed by the Eclipse Dataspace Working Group). |
| `tck/dsp-tck` | https://github.com/eclipse-dataspacetck/dsp-tck | DSP Technology Compatibility Kit — conformance tests for DSP/DCP. |
| `tck/cvf` | https://github.com/eclipse-dataspacetck/cvf | Compliance Verification Framework underlying the TCK. |

### Eclipse Tractus-X — `eclipse-tractusx/` (GitHub, branch `main`)

| Path | Source | Role |
| --- | --- | --- |
| `eclipse-tractusx/tractusx-edc` | https://github.com/eclipse-tractusx/tractusx-edc | Catena-X reference distribution: EDC + Helm/Vault/PostgreSQL/DCP/BPN-DID packaging. |
| `eclipse-tractusx/tutorial-resources` | https://github.com/eclipse-tractusx/tutorial-resources | Deployment tutorials and example configs. |

### Gaia-X Trust Framework / Digital Clearing House — `gaia-x/` (GitLab, branch `development`)

The Gaia-X implementations that EDC takes as its trust/compliance baseline,
provided on GitLab under `gitlab.com/gaia-x/lab/`. The three services that make
up a **Gaia-X Digital Clearing House (GXDCH)** are Compliance, Registry and
Notary; `gxdch` itself is the operations/deployment layer that ties them
together.

| Path | Source | Role |
| --- | --- | --- |
| `gaia-x/gxdch` | https://gitlab.com/gaia-x/lab/gxdch | **GXDCH** — operational guidelines, architecture, `docker-compose` (loire/tagus releases), load-balancer config, revocation lists (`revoked-issuers.txt`), `trusted-gxdch.yaml`. The deployment layer over the three services below. |
| `gaia-x/gx-compliance` | https://gitlab.com/gaia-x/lab/compliance/gx-compliance | GXDCH service: Compliance (NestJS) — validates credentials against the Trust Framework. |
| `gaia-x/gx-registry` | https://gitlab.com/gaia-x/lab/compliance/gx-registry | GXDCH service: Registry — trusted shapes/terms and trust-anchor list. |
| `gaia-x/gaia-x-notary-registrationnumber` | https://gitlab.com/gaia-x/lab/compliance/gaia-x-notary-registrationnumber | GXDCH service: Notary — issues registration-number credentials. |
| `gaia-x/gx-trust-anchor-service` | https://gitlab.com/gaia-x/lab/compliance/gx-trust-anchor-service | Trust Anchor management service. |

### Re-fetching / updating

```sh
# update a single clone in place
git -C docs/reference/eclipse-edc/Connector pull

# update everything
find docs/reference -maxdepth 3 -name .git -type d \
  -execdir git pull \;
```
