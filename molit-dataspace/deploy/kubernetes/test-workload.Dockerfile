FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

ARG MOLIT_TEST_RELEASE=baseline
ENV MOLIT_TEST_RELEASE=$MOLIT_TEST_RELEASE
WORKDIR /app
COPY --chown=node:node deploy/kubernetes/test-workload.mjs /app/test-workload.mjs

USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["node", "/app/test-workload.mjs"]
