ARG NODE_IMAGE=library/node@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
FROM ${NODE_IMAGE} AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/dashboard/package.json apps/dashboard/package-lock.json ./apps/dashboard/
RUN cd apps/dashboard && npm ci --ignore-scripts
# TypeScript resolves imports relative to shared /workspace/src. The container
# uses only this app's pinned install, so expose that same install at its parent.
RUN ln -s apps/dashboard/node_modules /workspace/node_modules
COPY apps/dashboard ./apps/dashboard
COPY src ./src
RUN cd apps/dashboard && npm run build

FROM ${NODE_IMAGE} AS runtime
RUN if command -v apk >/dev/null 2>&1; then apk add --no-cache zlib=1.4-r0; fi
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/corepack
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 AGENTBRAKE_CONTROL_URL=http://control-api:4314
COPY --from=build --chown=node:node /workspace/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER 1000:1000
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
