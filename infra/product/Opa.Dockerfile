# OPA 1.22.4 source unchanged; rebuild its vulnerable x/net dependency at the fixed version.
FROM golang@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS build
ADD --checksum=sha256:4eddbf690f65d6ca440fa8c1f2ce2a3439070cdf5d42c7aa8669a9e1552fbd59 https://github.com/open-policy-agent/opa/archive/refs/tags/v1.22.4.tar.gz /tmp/opa.tar.gz
WORKDIR /src
RUN tar -xzf /tmp/opa.tar.gz --strip-components=1 -C /src
ENV CGO_ENABLED=0 GOFLAGS=-mod=mod GOTOOLCHAIN=local
RUN go get golang.org/x/net@v0.62.0 && go mod verify
RUN go test golang.org/x/net/html && go build -trimpath -tags=opa_wasm -ldflags='-s -w' -o /out/opa .
FROM scratch
COPY --from=build /out/opa /opa
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /src/LICENSE /licenses/OPA-LICENSE
USER 1000:1000
ENTRYPOINT ["/opa"]
CMD ["run"]
