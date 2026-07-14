# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM eclipse-temurin:17-jdk-jammy@sha256:723151f3fc88ca2060153ee08ab8dbbea7983d6ed6f2622fe440acf178737c94 AS build
WORKDIR /workspace
COPY runtime/ ./
RUN chmod 0755 gradlew && ./gradlew --no-daemon --stacktrace :control-plane:shadowJar :data-plane:shadowJar

FROM build AS smoke-build
RUN ./gradlew --no-daemon --stacktrace :smoke-data-plane:shadowJar

FROM eclipse-temurin:17-jre-jammy@sha256:475d8e96b4b2bfe08999e5e854755c773af1581acdf959a4545d88f0696a2339 AS runtime-base
RUN useradd --create-home --uid 10001 edc
WORKDIR /opt/edc
USER 10001:10001

FROM runtime-base AS control-plane
COPY --from=build --chown=10001:10001 /workspace/control-plane/build/libs/molit-edc-control-plane.jar /opt/edc/runtime.jar
ENTRYPOINT ["java", "-jar", "/opt/edc/runtime.jar"]

FROM runtime-base AS data-plane
COPY --from=build --chown=10001:10001 /workspace/data-plane/build/libs/molit-edc-data-plane.jar /opt/edc/runtime.jar
ENTRYPOINT ["java", "-jar", "/opt/edc/runtime.jar"]

# Deliberately separate from the production data-plane target. This target
# contains an EDC Samples-derived pull proxy only for the local/CI smoke test.
FROM runtime-base AS smoke-data-plane
COPY --from=smoke-build --chown=10001:10001 /workspace/smoke-data-plane/build/libs/molit-edc-smoke-data-plane.jar /opt/edc/runtime.jar
ENTRYPOINT ["java", "-jar", "/opt/edc/runtime.jar"]
