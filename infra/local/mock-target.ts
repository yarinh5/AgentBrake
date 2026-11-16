import { readFile } from "node:fs/promises";
import { createFixtureTarget } from "../../server/fixture-target.js";
import { PostgresFixtureAdapter } from "../../server/adapters/postgres-fixture.js";
import { GitFixtureAdapter } from "../../server/adapters/git-fixture.js";
const token = (await readFile("/run/secrets/target-token", "utf8")).trim(),
  observer = (await readFile("/run/secrets/observer-token", "utf8")).trim();
const secret = async (name: string) =>
  (await readFile("/run/secrets/" + name, "utf8")).trim();
const database = new PostgresFixtureAdapter({
  readUrl:
    "postgresql://fixture_reader:" +
    (await secret("target-read-password")) +
    "@target-db:5432/agentbrake_target_fixture",
  writeUrl:
    "postgresql://fixture_writer:" +
    (await secret("target-write-password")) +
    "@target-db:5432/agentbrake_target_fixture",
});
const git =
  process.env.AGENTBRAKE_PRODUCT === "1"
    ? await GitFixtureAdapter.openPersistent(
        "/var/lib/agentbrake/git/repository",
        process.env.AGENTBRAKE_INSTALLATION_ID!,
      )
    : await GitFixtureAdapter.create(
        "/tmp/agentbrake-git-fixture",
        process.env.AGENTBRAKE_INJECTION_FIXTURE === "1"
          ? await readFile("/app/tests/fixtures/injection-readme.md", "utf8")
          : undefined,
      );
async function observed<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "fixture-observer-failed",
        step,
        error: error instanceof Error ? error.message : "unknown",
        diagnostics: error instanceof Error ? error.cause : undefined,
      }),
    );
    throw error;
  }
}
const target = createFixtureTarget(token, observer, {
  preview: (action) =>
    action.tool.startsWith("database_")
      ? database.preview(action)
      : git.preview(action),
  execute: (action) =>
    action.tool.startsWith("database_")
      ? database.execute(action)
      : git.execute(action),
  snapshot: async () => ({
    customers: await observed("database", () =>
      database.execute({
        tool: "database_read",
        arguments: { limit: 100 },
        sandbox: true,
      }),
    ),
    schema: await database.execute({
      tool: "database_schema",
      arguments: {},
      sandbox: true,
    }),
    git: await observed("git", () => git.snapshot()),
  }),
  close: async () => {
    await database.close();
    await git.close();
  },
});
const http = target.app.listen(8080, "0.0.0.0", () =>
  console.log("Synthetic target ready"),
);
process.on("SIGTERM", async () => {
  http.close();
  await target.close();
  process.exit(0);
});
