FROM node:18-slim

WORKDIR /usr/src/app

COPY src ./src
COPY tsconfig.json ./
COPY drizzle.config.ts ./
COPY package.json ./
COPY yarn.lock ./

RUN mkdir ./data

RUN yarn install --frozen-lockfile --network-timeout 600000
RUN yarn build

CMD ["yarn", "start"]