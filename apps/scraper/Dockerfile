# Browser/runtime versions are deliberately coupled to apps/scraper/package.json and .bun-version.
FROM oven/bun:1.4.0 AS bun-runtime
FROM mcr.microsoft.com/playwright:v1.62.1-noble

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/documents/package.json packages/documents/package.json
COPY packages/memory/package.json packages/memory/package.json
COPY packages/pipeline/package.json packages/pipeline/package.json
COPY packages/search/package.json packages/search/package.json
COPY packages/store/package.json packages/store/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/pages/package.json apps/pages/package.json
COPY apps/scraper/package.json apps/scraper/package.json
RUN npm ci --ignore-scripts

COPY packages packages
COPY apps/scraper apps/scraper

ENV NODE_ENV=production \
    TANGLE_SCRAPER_HOST=0.0.0.0 \
    TANGLE_SCRAPER_PORT=4720

USER pwuser
EXPOSE 4720
CMD ["bun", "apps/scraper/src/main.ts"]
