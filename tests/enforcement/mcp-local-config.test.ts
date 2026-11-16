import test from "node:test";
import assert from "node:assert/strict";
import { gatewayBase } from "../../server/mcp-config.js";
test("stdio permits the exact private fixture host only with explicit isolated mode", () => {
  assert.equal(gatewayBase("http://gateway:4313", true).hostname, "gateway");
  for (const url of [
    "http://gateway:4313",
    "http://target-db:5432",
    "http://example.com",
    "http://gateway.evil:4313",
  ])
    assert.throws(() => gatewayBase(url, false));
  for (const url of [
    "http://example.com",
    "http://target-db:5432",
    "http://gateway:8080",
    "http://user:pass@gateway:4313",
  ])
    assert.throws(() => gatewayBase(url, true));
  assert.equal(
    gatewayBase("http://127.0.0.1:4312", false).hostname,
    "127.0.0.1",
  );
});
