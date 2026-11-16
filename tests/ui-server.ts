import express from "express";
import { resolve } from "node:path";
import { createApp } from "../server/app.js";
const system = createApp({
  databasePath: ":memory:",
  adminKey: "isolated-browser-test-administrator-key",
});
system.app.use(express.static(resolve("dist")));
system.app.get("/{*path}", (_req, res) =>
  res.sendFile(resolve("dist/index.html")),
);
system.app.listen(4311, "127.0.0.1");
