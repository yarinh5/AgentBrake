import { randomUUID } from "node:crypto";
import {
  actionSchema,
  HttpError,
  githubWrites,
  readTools,
  toolSchemas,
  actionPreviewSchema,
  TargetChangedError,
  type ActionRecord,
  type Agent,
  type Tool,
} from "./contracts.js";
import type { ControlStore, Settings } from "./control-store.js";
import { canonical, digest } from "./store.js";
import { Connectors } from "./connectors.js";
import { OpaEvaluator, policyHash } from "./policy/opa-client.js";
import {
  AUDIENCE,
  POLICY_VERSION,
  grantSchema,
  type PolicyEvaluator,
  type PolicyInput,
  type PolicyDecision,
} from "./policy/contracts.js";
import { assertPayloadLimits, RequestLimits } from "./security/limits.js";
import {
  issueReview,
  matchesReview,
  type ReviewContext,
} from "./security/approval.js";
const secretPattern =
  /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|api[_-]?key|secret|access[_-]?token)\s*[=:]\s*\S{8,})/i;
function hasCredentialLikeContent(value: unknown) {
  // This finite public literal has no confidential entropy. Only source review
  // can change it; neither a path nor an agent claim grants an exception.
  // Match before JSON escaping: a literal backslash-n is NOT a value boundary.
  // Preserve the original detector for all remaining bytes, including keys.
  const reviewed = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== "string") return item;
    return item.replace(
      /(?:password|api[_-]?key|secret|access[_-]?token)\s*[=:]\s*/gi,
      (prefix, offset: number) =>
        /^example-only-placeholder(?=$|\s)/.test(item.slice(offset + prefix.length))
          ? "[public-example] " : prefix,
    );
  });
  return secretPattern.test(reviewed);
}
const secretPath =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.ssh|\.aws|\.git|credentials[^/]*|secrets?[^/]*|id_rsa|id_ed25519)(?:\/|$)|\.(?:pem|key|p12)$/i;
function agentRecord(record: ActionRecord): ActionRecord {
  const { review, preview, approvalReceipt, ...safe } = record;
  return safe;
}
export class Gateway {
  private limits = new RequestLimits();
  private inflight = new Map<
    string,
    { digest: string; result: Promise<ActionRecord> }
  >();
  constructor(
    public store: ControlStore,
    public connectors: Connectors,
    private notify: () => void,
    private policy: PolicyEvaluator = new OpaEvaluator(),
  ) {}
  async evaluate(agent: Agent, tool: string, args: Record<string, unknown>) {
    return this.evaluateWithSettings(
      agent,
      tool,
      args,
      await this.store.settings(),
    );
  }
  private evaluateWithSettings(
    agent: Agent,
    tool: string,
    args: Record<string, unknown>,
    control: Settings,
  ): {
    status: "blocked" | "pending" | "allowed";
    rule: string;
    reason: string;
    resource: string;
    args: Record<string, unknown>;
  } {
    const deny = (rule: string, reason: string) => ({
      status: "blocked" as const,
      rule,
      reason,
      resource: "restricted",
      args: {} as Record<string, unknown>,
    });
    if (control.paused)
      return deny(
        "emergency-stop",
        "All agent activity is paused by an administrator.",
      );
    if (agent.status !== "active")
      return deny("agent-paused", "This agent has been paused.");
    const grant = grantSchema.safeParse(agent.grant);
    if (
      !grant.success ||
      grant.data.agent_id !== agent.id ||
      agent.tokenAudience !== AUDIENCE
    )
      return deny(
        "invalid-grant",
        "A current server-issued task grant and identity are required.",
      );
    if (
      (agent.tokenExpiresAt ?? 0) <= Date.now() ||
      grant.data.expires_at_ms <= Date.now()
    )
      return deny(
        "grant-expired",
        "Task grant or agent credential has expired.",
      );
    if (grant.data.revoked)
      return deny("grant-revoked", "This task grant has been revoked.");
    if (grant.data.used_calls >= grant.data.max_calls)
      return deny("quota-exhausted", "Task execution quota has been consumed.");
    if (
      !agent.sandbox &&
      (tool.startsWith("database_")
        ? this.connectors.modes().database
        : this.connectors.modes().github) !== "sandbox" &&
      !this.connectors.supportsLive(tool)
    )
      return deny(
        "live-integration-disabled",
        "Real service execution is disabled in this stage.",
      );
    if (hasCredentialLikeContent(args))
      return deny(
        "secret-protection",
        "Credential-like content detected. Raw arguments were discarded.",
      );
    if (tool === "database_delete")
      return deny(
        "destructive-action",
        "Deleting customer data is outside the supported tool contract.",
      );
    if (tool === "http_request")
      return deny(
        "external-egress",
        "Arbitrary network destinations are not permitted.",
      );
    if (!Object.hasOwn(toolSchemas, tool))
      return deny(
        "unknown-tool",
        "This tool is not registered. Unknown operations fail closed.",
      );
    if (!agent.tools.includes(tool))
      return deny(
        "task-scope",
        "This tool is outside the administrator-issued task grant.",
      );
    const parsed = toolSchemas[tool as Tool].safeParse(args);
    if (!parsed.success)
      return deny(
        "invalid-arguments",
        "Arguments do not match the strict tool schema.",
      );
    const safe = parsed.data as Record<string, unknown>;
    const resource = tool.startsWith("database_")
      ? "customers"
      : tool === "github_list_repo"
        ? (agent.sandbox ? "agentbrake/sandbox" : this.connectors.modes().repository)
        : (safe.repo as string);
    if (!agent.resources.includes(resource))
      return deny(
        "resource-scope",
        "This resource is outside the agent task grant.",
      );
    if (
      tool.startsWith("github_") &&
      resource !==
        (agent.sandbox
          ? "agentbrake/sandbox"
          : this.connectors.modes().repository)
    )
      return deny(
        "resource-scope",
        "This repository is not a configured destination.",
      );
    if (tool === "github_read_file") {
      const path = safe.path as string;
      if (
        path.split("/").some((s) => s === ".." || s === "." || !s) ||
        secretPath.test(path)
      )
        return deny(
          "secret-path",
          "Secret files and ambiguous paths are not accessible.",
        );
    }
    if (githubWrites.has(tool) && agent.tainted)
      return deny(
        "data-boundary",
        "This agent has accessed protected customer data. Outbound writes are blocked for this identity.",
      );
    const settings = control.policies;
    const rule =
      tool === "database_update"
        ? "database-writes"
        : githubWrites.has(tool)
          ? "github-writes"
          : "approved-reads";
    const decision =
      tool === "database_update"
        ? settings.databaseWrites
        : githubWrites.has(tool)
          ? settings.githubWrites
          : settings.reads;
    if (decision === "deny")
      return deny(rule, "The current workspace policy denies this operation.");
    return {
      status:
        decision === "approval" ? ("pending" as const) : ("allowed" as const),
      rule,
      reason:
        decision === "approval"
          ? "Human approval is required before this exact action can execute."
          : "Tool and resource match the agent task grant.",
      resource,
      args: safe,
    };
  }
  async submit(agentId: string, input: unknown): Promise<ActionRecord> {
    assertPayloadLimits(input);
    const request = actionSchema.safeParse(input);
    if (!request.success) throw new HttpError(400, "Invalid action envelope");
    const fingerprint = digest(canonical(request.data));
    const key = agentId + ":" + request.data.requestId;
    const running = this.inflight.get(key);
    if (running) {
      if (running.digest !== fingerprint)
        throw new HttpError(
          409,
          "Request ID is already bound to different arguments",
        );
      return agentRecord(await running.result);
    }
    const release = this.limits.enter(agentId);
    const result = this.submitOnce(agentId, request.data);
    this.inflight.set(key, { digest: fingerprint, result });
    try {
      return agentRecord(await result);
    } finally {
      this.inflight.delete(key);
      release();
    }
  }
  private taskFingerprint(agent: Agent) {
    const { used_calls, ...grant } = agent.grant ?? {};
    return digest(canonical(grant));
  }
  async actionForAgent(agentId: string, id: string) {
    const action = await this.store.action(id),
      agent = await this.store.agent(agentId);
    if (!action || !agent || action.agentId !== agentId)
      throw new HttpError(404, "Action not found");
    // Status recovery does not consume another execution quota. Revoke/expiry
    // and task changes still withdraw access to any cached protected result.
    const control = await this.store.settings();
    const grant = grantSchema.safeParse(agent.grant);
    if (
      !grant.success ||
      grant.data.revoked ||
      grant.data.expires_at_ms <= Date.now() ||
      agent.status !== "active" ||
      control.paused ||
      action.policyRevision !== control.revision ||
      action.policyHash !== policyHash() ||
      action.grantFingerprint !== this.taskFingerprint(agent)
    )
      throw new HttpError(
        403,
        "Current grant no longer permits access to this action",
      );
    return agentRecord(action);
  }
  private contextFingerprint(agent: Agent, settings: Settings) {
    return digest(
      canonical({
        grant: this.taskFingerprint(agent),
        status: agent.status,
        tokenAudience: agent.tokenAudience,
        tokenExpiresAt: agent.tokenExpiresAt,
        settings,
        tools: agent.tools,
        resources: agent.resources,
        sandbox: agent.sandbox,
      }),
    );
  }
  private async authorize(
    agent: Agent,
    tool: string,
    args: Record<string, unknown>,
  ) {
    const settings = await this.store.settings();
    const decision = this.evaluateWithSettings(agent, tool, args, settings);
    const decisionId = randomUUID();
    const context = this.contextFingerprint(agent, settings);
    const revision = settings.revision;
    let policy: PolicyDecision = {
      effect: "DENY",
      reason_code: decision.rule,
      decision_id: decisionId,
      policy_version: POLICY_VERSION,
      policy_hash: policyHash(),
    };
    if (decision.status !== "blocked") {
      const input: PolicyInput = {
        decision_id: decisionId,
        now_ms: Date.now(),
        identity: {
          agent_id: agent.id,
          tenant: "local",
          audience: AUDIENCE,
          expires_at_ms: agent.tokenExpiresAt!,
        },
        grant: agent.grant!,
        action: {
          tool,
          rows:
            tool === "database_read"
              ? Number(decision.args.limit)
              : tool === "database_update"
                ? 1
                : 0,
        },
        target: { id: decision.resource, environment: "sandbox" },
        controls: {
          paused: settings.paused,
          agent_active: agent.status === "active",
          tainted: agent.tainted,
          ...settings.policies,
        },
      };
      policy = await this.policy.evaluate(input);
      if (policy.effect === "DENY") {
        decision.status = "blocked";
        decision.rule = policy.reason_code;
        decision.reason = "The policy engine denied this action.";
        decision.args = {};
      } else if (policy.effect === "REQUIRE_APPROVAL")
        decision.status = "pending";
    }
    const current = await this.store.agent(agent.id);
    if (
      decision.status !== "blocked" &&
      (!current ||
        this.contextFingerprint(current, await this.store.settings()) !==
          context ||
        (await this.evaluate(current, tool, args)).status === "blocked")
    ) {
      decision.status = "blocked";
      decision.rule = "authority-changed";
      decision.reason = "Authority changed while awaiting the policy engine.";
      decision.args = {};
    }
    return { decision, policy, context, revision };
  }
  private async submitOnce(agentId: string, input: unknown) {
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, "Invalid action envelope");
    const request = parsed.data;
    const agent = await this.store.agent(agentId);
    if (!agent) throw new HttpError(401, "Unknown agent");
    const fingerprint = digest(canonical(request));
    const previous = await this.store.previous(agentId, request.requestId);
    if (previous) {
      if (
        (await this.evaluate(agent, request.tool, request.arguments)).status ===
        "blocked"
      )
        throw new HttpError(
          403,
          "Current authority no longer permits access to this action",
        );
      if (previous.digest !== fingerprint)
        throw new HttpError(
          409,
          "Request ID is already bound to different arguments",
        );
      return this.actionForAgent(agentId, previous.id);
    }
    const started = performance.now();
    const { decision, policy, context, revision } = await this.authorize(
      agent,
      request.tool,
      request.arguments,
    );
    const record: ActionRecord = {
      id: randomUUID(),
      agentId,
      requestId: request.requestId,
      tool:
        Object.hasOwn(toolSchemas, request.tool) ||
        ["database_delete", "http_request"].includes(request.tool)
          ? request.tool
          : "unregistered",
      digest: fingerprint,
      destination: "",
      correlationId: randomUUID(),
      grantId: agent.grant?.id,
      grantFingerprint: this.taskFingerprint(agent),
      policyRevision: revision,
      policyDecisionId: policy.decision_id,
      policyVersion: policy.policy_version,
      policyHash: policy.policy_hash,
      policyEffect: policy.effect,
      arguments: decision.args,
      status: decision.status,
      rule: decision.rule,
      reason: decision.reason,
      resource: decision.resource,
      sandbox:
        agent.sandbox ||
        (request.tool.startsWith("database_")
          ? this.connectors.modes().database === "sandbox"
          : this.connectors.modes().github === "sandbox"),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    };
    // Passing policy is not execution success. This state also survives an audit failure or process crash.
    record.destination = this.connectors.binding(record.tool, record.sandbox);
    if (record.status === "pending") {
      try {
        record.preview = actionPreviewSchema.parse(
          await this.connectors.preview(record),
        );
        if (hasCredentialLikeContent(record.preview))
          throw Error("Sensitive preview");
        record.review = issueReview(record);
      } catch {
        record.status = "blocked";
        record.rule = "preview-unavailable";
        record.reason =
          "A safe, current preview could not be obtained. No mutation was attempted.";
        delete record.preview;
      }
    }
    if (record.status === "allowed") record.status = "queued";
    await this.store.insertAction(record);
    await this.store.audit("action." + record.status, {
      actionId: record.id,
      agentId,
      tool: record.tool,
      rule: record.rule,
      correlationId: record.correlationId,
      grantId: record.grantId,
      decisionId: record.policyDecisionId,
      policyHash: record.policyHash,
      policyRevision: record.policyRevision,
      effect: record.policyEffect,
    });
    this.notify();
    if (record.status === "queued") return this.execute(record, context);
    return record;
  }
  async review(id: string) {
    const action = await this.store.action(id);
    if (!action) throw new HttpError(404, "Action not found");
    if (
      action.status !== "pending" ||
      !action.review ||
      !matchesReview(action, action.review)
    )
      throw new HttpError(409, "Action requires a new request and review");
    return { action, proof: action.review };
  }
  async approve(id: string, approve: boolean, reviewer?: ReviewContext) {
    const record = await this.store.action(id);
    if (!record) throw new HttpError(404, "Action not found");
    if (record.status !== "pending")
      throw new HttpError(409, "This action is no longer awaiting approval");
    const owner = await this.store.agent(record.agentId);
    if (reviewer) {
      if (
        reviewer.actor.tenant !== "local" ||
        !["administrator", "approver"].includes(reviewer.actor.role)
      )
        throw new HttpError(403, "Approver role required");
      if (
        approve &&
        reviewer.team &&
        reviewer.actor.id === owner?.grant?.human_owner &&
        (githubWrites.has(record.tool) || record.tool === "database_update")
      )
        throw new HttpError(403, "A different human must review this change");
      if (
        (reviewer.team || reviewer.proof) &&
        (!reviewer.proof || !matchesReview(record, reviewer.proof))
      )
        throw new HttpError(
          409,
          "Reviewed action fingerprint or nonce changed",
        );
    }
    record.approvalReceipt = {
      actorId: reviewer?.actor.id ?? "local-administrator",
      tenant: "local",
      decision: approve ? "approve" : "reject",
      at: new Date().toISOString(),
      proof: record.review ?? issueReview(record),
    };
    if (
      record.policyHash !== policyHash() ||
      record.policyRevision !== (await this.store.settings()).revision ||
      record.grantFingerprint !==
        this.taskFingerprint((await this.store.agent(record.agentId))!)
    ) {
      record.status = "blocked";
      record.rule = "approval-context-changed";
      record.reason =
        "Task grant or policy revision changed. A new request and review are required.";
      await this.store.blockPending(record);
      this.notify();
      return record;
    }
    if (!approve) {
      record.status = "blocked";
      record.reason = "An administrator rejected this action.";
      record.rule = "human-rejected";
    } else if (Date.parse(record.expiresAt) <= Date.now()) {
      record.status = "blocked";
      record.reason = "The 15-minute approval window expired.";
      record.rule = "approval-expired";
    } else if (
      record.destination !==
      this.connectors.binding(record.tool, record.sandbox)
    ) {
      record.status = "blocked";
      record.rule = "destination-changed";
      record.reason =
        "Connection configuration changed after this request. Submit a new action for review.";
    } else {
      let currentPreview;
      try {
        currentPreview = await this.connectors.preview(record);
      } catch {
        currentPreview = undefined;
      }
      if (
        !record.preview ||
        canonical(currentPreview ?? null) !== canonical(record.preview)
      ) {
        record.status = "blocked";
        record.rule = "preview-changed";
        record.reason =
          "The target or preview changed after review. Submit a new action.";
        await this.store.blockPending(record);
        this.notify();
        return record;
      }
      const { decision, policy, context } = await this.authorize(
        (await this.store.agent(record.agentId))!,
        record.tool,
        record.arguments,
      );
      if ((await this.store.action(id))?.status !== "pending")
        throw new HttpError(409, "This action is no longer awaiting approval");
      if (decision.status === "blocked") {
        record.status = "blocked";
        record.reason = decision.reason;
        record.rule = decision.rule;
      } else {
        await this.store.audit("approval.granted", {
          actionId: id,
          actor: record.approvalReceipt.actorId,
          fingerprint: record.approvalReceipt.proof.fingerprint,
        });
        record.policyDecisionId = policy.decision_id;
        return this.execute(record, context);
      }
    }
    await this.store.blockPending(record);
    this.notify();
    return record;
  }
  private async execute(record: ActionRecord, context: string) {
    const reserved = await this.store.reserve(
      record,
      (current, settings, persisted) => {
        if (
          persisted.policyHash !== policyHash() ||
          persisted.policyRevision !== settings.revision ||
          persisted.grantFingerprint !== this.taskFingerprint(current)
        )
          return {
            rule: "approval-context-changed",
            reason:
              "Task grant or policy changed. A new request and review are required.",
          };
        const recheck = this.evaluateWithSettings(
          current,
          record.tool,
          record.arguments,
          settings,
        );
        const expired =
          record.status === "pending" &&
          (!Number.isFinite(Date.parse(record.expiresAt)) ||
            Date.parse(record.expiresAt) <= Date.now());
        const bound = (a: ActionRecord) =>
          canonical({
            agentId: a.agentId,
            requestId: a.requestId,
            tool: a.tool,
            arguments: a.arguments,
            digest: a.digest,
            destination: a.destination,
            grantFingerprint: a.grantFingerprint,
            policyRevision: a.policyRevision,
            policyHash: a.policyHash,
            expiresAt: a.expiresAt,
            sandbox: a.sandbox,
            review: a.review,
            preview: a.preview,
          });
        const swapped =
          bound(record) !== bound(persisted) ||
          record.destination !==
            this.connectors.binding(record.tool, record.sandbox);
        if (
          expired ||
          recheck.status === "blocked" ||
          swapped ||
          this.contextFingerprint(current, settings) !== context
        )
          return {
            rule: expired
              ? "approval-expired"
              : recheck.status === "blocked"
                ? recheck.rule
                : swapped
                  ? "action-changed"
                  : "authority-changed",
            reason:
              "Authority or approved action changed before dispatch. No tool was called.",
          };
        return undefined;
      },
    );
    if (!reserved) {
      this.notify();
      return record;
    }
    this.notify();
    try {
      const result = await this.connectors.execute(record);
      record.status = "allowed";
      record.executionOutcome = "adapter-reported";
      if (hasCredentialLikeContent(result)) {
        record.resultDisclosure = "withheld";
        delete record.result;
        record.reason = "The adapter reported execution; credential-like output was withheld. This does not undo the action. Do not resubmit; reconcile target state if needed.";
      } else {
        record.resultDisclosure = "released";
        record.result = result;
        record.reason = "Executed through the enforced gateway.";
      }
    } catch (error) {
      record.status =
        error instanceof TargetChangedError
          ? "failed"
          : readTools.has(record.tool)
            ? "failed"
            : "unknown";
      record.executionOutcome = error instanceof TargetChangedError
        ? "not-applied" : record.status === "unknown" ? "unknown" : "failed";
      record.resultDisclosure = "unavailable";
      if (error instanceof TargetChangedError) record.rule = "target-changed";
      record.reason =
        error instanceof TargetChangedError
          ? "Reviewed target changed at dispatch; no mutation was applied."
          : record.status === "unknown"
            ? "Destination outcome is uncertain. Verify it before creating a new request."
            : "The connector could not complete the request. No result was released.";
    }
    await this.store.saveAction(record);
    await this.store.audit("execution." + record.status, {
      actionId: record.id,
      outcome: record.executionOutcome,
      resultDisclosure: record.resultDisclosure,
    });
    this.notify();
    return record;
  }
}
