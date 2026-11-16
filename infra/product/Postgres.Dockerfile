ARG POSTGRES_BASE_IMAGE
FROM ${POSTGRES_BASE_IMAGE}
# Compose already starts PostgreSQL as uid 70 with every capability dropped.
# The root-only identity-switch helper is unused and carries an obsolete Go runtime.
USER root
RUN rm -f /usr/local/bin/gosu
USER postgres
