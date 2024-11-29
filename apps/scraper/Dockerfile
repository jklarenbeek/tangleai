# This docker file is written for a monorepo that is two parents up root.
# build this docker image with the tangleai workspace in mind!

ARG NODE_VERSION=22.11
ARG PORT=3002

# Playwright
ARG CHROME_BIN=/usr/bin/chromium-browser
ARG CHROME_PATH=/usr/lib/chromium/
ARG CHROMIUM_FLAGS="--disable-software-rasterizer --disable-dev-shm-usage"
# ARG CHROMIUM_FLAGS="--use-gl=angle --use-angle=swiftshader-webgl"

ARG PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ARG PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

#### BASE IMAGE (TODO: we need to push this to docker hub)
FROM node:${NODE_VERSION}-alpine3.20 as base-playwright

ARG CHROME_BIN
ARG CHROME_PATH
ARG CHROMIUM_FLAGS
ARG PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
ARG PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH

ENV CHROME_BIN=${CHROME_BIN} \
    CHROME_PATH=${CHROME_PATH} \
    CHROMIUM_FLAGS=${CHROMIUM_FLAGS} \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD} \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}

USER root

# Install chromium and tini
RUN echo "http://dl-cdn.alpinelinux.org/alpine/v3.20/community" >> /etc/apk/repositories \
  && echo "http://dl-cdn.alpinelinux.org/alpine/v3.20/main" >> /etc/apk/repositories \
  && apk upgrade -U -a \
  && apk add --no-cache \
    libstdc++ \
    libc6-compat \
    tini \
  && apk add \
    chromium-swiftshader \
    harfbuzz \
    nss \
    freetype \
    ttf-freefont \
    font-noto-emoji \
    wqy-zenhei \
  && rm -rf /var/cache/* \
  && mkdir /var/cache/apk

COPY app/scraper/local.conf /etc/fonts/local.conf

### BUILDER IMAGE
FROM base-playwright as builder
WORKDIR /usr/src/app
# RUN npm install pnpm turbo --global
# RUN pnpm config set store-dir ~/.pnpm-store

# copy all project files from workspace
COPY . .

# and install them with npm for now
RUN npm install --workspace=@tangleai/scraper
RUN npm run build --workspace=@tangleai/scraper

# PRODUCTION IMAGE
FROM base-playwright AS prod
WORKDIR /usr/src/app
USER node
COPY --from=builder --chown=node /usr/src/app/app/scraper/dist .

ARG PORT
ENV NODE_ENV=production

ENV PORT=${PORT}

EXPOSE ${PORT}

ENTRYPOINT ["tini", "--"]

CMD node index.js
