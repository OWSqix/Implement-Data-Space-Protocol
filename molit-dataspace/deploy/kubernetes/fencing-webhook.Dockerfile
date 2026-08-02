FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

LABEL kr.go.molit.dataspace.runtime-class="fencing-webhook" \
      kr.go.molit.dataspace.production-eligible="true"

WORKDIR /app
COPY --chown=node:node src/caas/kubernetes-fencing-webhook.mjs /app/kubernetes-fencing-webhook.mjs

USER 1000:1000
EXPOSE 8443
ENTRYPOINT ["node", "/app/kubernetes-fencing-webhook.mjs"]
