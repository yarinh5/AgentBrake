ARG NODE_IMAGE
FROM ${NODE_IMAGE}
RUN apk add --no-cache git ca-certificates zlib=1.4-r0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && rm -rf /root/.npm /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/corepack
COPY server ./server
COPY services ./services
COPY scripts ./scripts
COPY infra ./infra
USER node
CMD ["node", "--import", "tsx", "server/product.ts"]
