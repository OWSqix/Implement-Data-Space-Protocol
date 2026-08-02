# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM eclipse-temurin:17-jdk-jammy@sha256:723151f3fc88ca2060153ee08ab8dbbea7983d6ed6f2622fe440acf178737c94 AS build
WORKDIR /workspace
COPY runtime/ ./
RUN chmod 0755 gradlew && ./gradlew --no-daemon --stacktrace :control-plane:shadowJar :data-plane:shadowJar

FROM build AS smoke-build
RUN ./gradlew --no-daemon --stacktrace :smoke-control-plane:shadowJar :smoke-data-plane:shadowJar

FROM build AS schema-build
WORKDIR /schema/control-plane
RUN jar xf /workspace/control-plane/build/libs/molit-edc-control-plane.jar \
      asset-index-schema.sql contract-definition-schema.sql contract-negotiation-schema.sql \
      policy-definition-schema.sql transfer-process-schema.sql edr-index-schema.sql \
      jti-validation-schema.sql dataplane-instance-schema.sql policy-monitor-schema.sql \
      cache-schema.sql target-node-directory-schema.sql
WORKDIR /schema/data-plane
RUN jar xf /workspace/data-plane/build/libs/molit-edc-data-plane.jar \
      accesstoken-data-schema.sql dataplane-schema.sql
COPY database-schema/migration-manifest.v1.json /schema/migration-manifest.v1.json
COPY database-schema/run-schema-migration.sh /schema/run-schema-migration.sh

FROM eclipse-temurin:17-jre-jammy@sha256:475d8e96b4b2bfe08999e5e854755c773af1581acdf959a4545d88f0696a2339 AS runtime-base
RUN useradd --create-home --uid 10001 edc
WORKDIR /opt/edc
USER 10001:10001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD ["java", "-cp", "/opt/edc/runtime.jar", "org.eclipse.edc.molit.health.HttpHealthProbe", "http://127.0.0.1:8080/api/check/readiness"]

FROM runtime-base AS control-plane
LABEL kr.go.molit.dataspace.runtime-class="edc-control-plane" \
      kr.go.molit.dataspace.production-eligible="false"
COPY --from=build --chown=10001:10001 /workspace/control-plane/build/libs/molit-edc-control-plane.jar /opt/edc/runtime.jar
ENTRYPOINT ["java", "-jar", "/opt/edc/runtime.jar"]

# Local/CI only. This artifact contains mock IAM and the deprecated legacy
# Data Plane signaling compatibility module and is never production eligible.
FROM runtime-base AS smoke-control-plane
LABEL kr.go.molit.dataspace.runtime-class="smoke-control-plane" \
      kr.go.molit.dataspace.production-eligible="false"
COPY --from=smoke-build --chown=10001:10001 /workspace/smoke-control-plane/build/libs/molit-edc-smoke-control-plane.jar /opt/edc/runtime.jar
ENTRYPOINT ["java", "-jar", "/opt/edc/runtime.jar"]

FROM runtime-base AS data-plane
LABEL kr.go.molit.dataspace.runtime-class="edc-data-plane" \
      kr.go.molit.dataspace.production-eligible="false"
COPY --from=build --chown=10001:10001 /workspace/data-plane/build/libs/molit-edc-data-plane.jar /opt/edc/runtime.jar
ENTRYPOINT ["java", "-jar", "/opt/edc/runtime.jar"]

# Local/CI only. This target contains an EDC Samples-derived pull proxy.
FROM runtime-base AS smoke-data-plane
LABEL kr.go.molit.dataspace.runtime-class="smoke-data-plane" \
      kr.go.molit.dataspace.production-eligible="false"
COPY --from=smoke-build --chown=10001:10001 /workspace/smoke-data-plane/build/libs/molit-edc-smoke-data-plane.jar /opt/edc/runtime.jar
ENTRYPOINT ["java", "-jar", "/opt/edc/runtime.jar"]

FROM postgres:17.10-alpine3.24@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193 AS schema-migration
LABEL kr.go.molit.dataspace.runtime-class="schema-migration" \
      kr.go.molit.dataspace.production-eligible="true" \
      kr.go.molit.dataspace.production-gate="signed-release-attestation"
COPY --from=schema-build --chown=70:70 /schema /opt/molit-edc-schema
RUN chmod 0555 /opt/molit-edc-schema/run-schema-migration.sh
USER 70:70
HEALTHCHECK NONE
ENTRYPOINT ["/opt/molit-edc-schema/run-schema-migration.sh"]
