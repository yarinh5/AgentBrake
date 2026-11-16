ARG RUNTIME_IMAGE
FROM ${RUNTIME_IMAGE}
USER root
ARG CODEX_VERSION
RUN npm install --global --ignore-scripts @openai/codex@${CODEX_VERSION}
USER node
CMD ["node","tests/milestone-b/codex-agent.mjs"]
