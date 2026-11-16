ARG NODE_IMAGE
FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends curl git postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server ./server
COPY services ./services
COPY tests ./tests
COPY scripts ./scripts
COPY infra ./infra
USER node
CMD ["node","--import","tsx","server/isolated.ts"]
