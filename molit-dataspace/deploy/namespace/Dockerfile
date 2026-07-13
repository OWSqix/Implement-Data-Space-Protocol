ARG NODE_IMAGE=node:24.16.0-alpine
FROM ${NODE_IMAGE} AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
    MOLIT_NAMESPACE_ALLOWED_HOSTS=data.molit.go.kr \
    MOLIT_NAMESPACE_LISTEN_HOST=0.0.0.0 \
    MOLIT_NAMESPACE_PORT=8080 \
    MOLIT_NAMESPACE_PUBLIC_ORIGIN=https://data.molit.go.kr \
    MOLIT_NAMESPACE_RELEASE_ROOT=/app/profiles/molit-dcat-ap/releases/1.0.0-rc.1

WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node src/profile/content-negotiation.mjs ./src/profile/content-negotiation.mjs
COPY --chown=node:node src/publication ./src/publication
COPY --chown=node:node profiles/molit-dcat-ap/releases/1.0.0-rc.1 ./profiles/molit-dcat-ap/releases/1.0.0-rc.1

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const h=require('http');const r=h.get({host:'127.0.0.1',port:8080,path:'/readyz',headers:{Host:process.env.MOLIT_NAMESPACE_ALLOWED_HOSTS.split(',')[0]}},x=>process.exit(x.statusCode===200?0:1));r.on('error',()=>process.exit(1));r.setTimeout(2000,()=>{r.destroy();process.exit(1)})"

CMD ["node", "src/publication/cli.mjs"]
