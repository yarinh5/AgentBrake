import type { ActionRecord } from "../contracts.js";
import { actionPreviewSchema, TargetChangedError } from "../contracts.js";
import { expectedVersion } from "./preview.js";
export type ExecutionAction = Pick<
  ActionRecord,
  "tool" | "arguments" | "sandbox" | "preview"
> & { precondition?: { version: number } };
export class FixtureHttpAdapter {
  private endpoint: URL;
  constructor(
    url: string,
    private token: string,
  ) {
    this.endpoint = new URL("/execute", url);
    if (
      this.endpoint.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "mock-target"].includes(
        this.endpoint.hostname,
      ) ||
      this.endpoint.username ||
      this.endpoint.password
    )
      throw new Error("Only a local fixture endpoint is supported");
    if (token.length < 24) throw new Error("Fixture credential is required");
  }
  async preview(action: ExecutionAction) {
    return actionPreviewSchema.parse(await this.request(action, "/preview"));
  }
  async execute(action: ExecutionAction) {
    return this.request(action, "/execute");
  }
  private async request(action: ExecutionAction, path: string) {
    const version = expectedVersion(action.preview);
    const response = await fetch(new URL(path, this.endpoint), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(2000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        tool: action.tool,
        arguments: action.arguments,
        precondition: version === undefined ? action.precondition : { version },
      }),
    });
    if (response.status === 409) throw new TargetChangedError();
    if (!response.ok) throw new Error("Fixture request failed");
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 128000) {
        await reader.cancel();
        throw new Error("Fixture output too large");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
}
