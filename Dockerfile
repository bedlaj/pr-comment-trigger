FROM node:14.13-alpine3.10 AS builder_environment
RUN apk add --no-cache git python3 build-base
RUN npm i -g @vercel/ncc && npm i -g typescript

FROM builder_environment as builder
ADD . .
RUN npm ci --production
RUN npm run build

FROM node:14.13-alpine3.10
COPY --from=builder dist /dist
RUN apk add --no-cache git && apk add --no-cache -X http://dl-cdn.alpinelinux.org/alpine/edge/testing hub
ENTRYPOINT ["node", "/dist/index.js"]
