# Qualified Linux amd64 runtime and engine client; the daemon remains host-owned.
FROM oven/bun@sha256:296a79bbc988bb0a91ef11099af70a78a8cba98b73fd53f7b2a7715b7c86ced2 AS bun-runtime
FROM docker@sha256:b0dfb3beea69612ccf1f9cfd8f74179b9c497d6b0c9e1294664dffe9bc1c070a AS engine-client
FROM node@sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=engine-client /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages packages
COPY components components
COPY apps apps
COPY benchmark/package.json benchmark/package.json
RUN npm ci --ignore-scripts
ENV TANGLE_RESEARCH_HOST=0.0.0.0 TANGLE_RESEARCH_PORT=8020 TANGLE_RESEARCH_STATE=/research-state
USER node
EXPOSE 8020
CMD ["bun", "apps/research-runner/src/main.ts"]
