import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { backend, frontend, keys } from "./constants.js";

async function control(role: keyof typeof keys) {
  const login = await fetch(backend + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: keys[role] }) });
  expect(login.status).toBe(200); const session = await login.json(); const cookie = login.headers.get("set-cookie")!.split(";")[0];
  return async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(backend + "/api" + path, { method, headers: { Cookie: cookie, "Content-Type": "application/json", "X-AB-CSRF": session.csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
}
async function signIn(page: Page, role: keyof typeof keys) {
  await page.goto("/"); await page.getByLabel("Workspace key").fill(keys[role]); await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByRole("heading", { name: "Security overview" })).toBeVisible();
}
async function pending(role: "administrator" | "operator" = "operator", id = 1) {
  const request = await control(role);
  const created = await request("/agents", { name: `UI ${role} ${randomUUID().slice(0, 8)}`, tools: ["database_update"], resources: ["customers"], sandbox: true });
  expect(created.status).toBe(201);
  const envelope = { requestId: randomUUID(), tool: "database_update", arguments: { id, status: "paused" } };
  const response = await fetch(backend + "/api/actions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${created.body.token}` }, body: JSON.stringify(envelope) });
  const action = await response.json(); expect(action.status).toBe("pending");
  const reviewed = await request(`/approvals/${action.id}`); expect(reviewed.status).toBe(200);
  return { action, proof: reviewed.body.proof, request, token: created.body.token, envelope };
}
async function openAction(page: Page, id: string) {
  await page.getByRole("navigation").getByRole("button", { name: /^Approvals/ }).click();
  await page.getByRole("button", { name: `Inspect ${id}`, exact: true }).click();
  await expect(page.getByTestId("action-preview")).toBeVisible();
}
async function state() { return (await fetch(backend + "/__fixture")).json(); }

test("operator can create identity, issue a bounded task grant, revoke, reload session and keep bearer only in memory", async ({ page }) => {
  await signIn(page, "operator");
  await page.getByRole("button", { name: "Create task identity" }).click();
  await page.getByLabel("Agent name").fill("Bounded fixture task");
  await page.getByRole("button", { name: "Create scoped agent" }).click();
  await expect(page.locator(".token-row code")).toContainText("ab_");
  const token = await page.locator(".token-row code").textContent();
  await expect(page.getByRole("button", { name: "Configure task grant" })).toBeVisible();
  await page.getByRole("button", { name: "Configure task grant" }).click();
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  await expect(page.getByText(token!, { exact: true })).toHaveCount(0);
  const card = page.locator(".agent-card").filter({ has: page.getByRole("heading", { name: "Bounded fixture task" }) });
  await card.getByRole("button", { name: "Grant task" }).click();
  await page.getByLabel("Expiry in seconds").fill("120"); await page.getByLabel("Maximum calls").fill("3"); await page.getByLabel("Maximum rows").fill("2");
  const granted = page.waitForResponse(response => response.url().endsWith("/grant") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Issue task grant" }).click(); expect((await granted).status()).toBe(201);
  await expect(card.locator(".task-grant")).toContainText("0 / 3");
  await page.reload(); await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Revoke grant" }).click(); await expect(card.locator(".task-grant .badge")).toHaveText("Revoked");
  await page.getByTitle("Sign out").click(); await expect(page.getByLabel("Workspace key")).toHaveValue("");
});

test("administrator sees independent-review restriction; server rejects self-approval without target dispatch", async ({ page }) => {
  const fixture = await pending("administrator", 3); const before = await state();
  await signIn(page, "administrator"); await openAction(page, fixture.action.id);
  await expect(page.getByRole("dialog")).toContainText("Independent reviewer required"); await expect(page.getByRole("button", { name: "Approve & execute" })).toBeDisabled();
  const denied = await fixture.request(`/approvals/${fixture.action.id}`, { decision: "approve", proof: fixture.proof }); expect(denied.status).toBe(403);
  expect((await state()).executions).toEqual(before.executions);
});

test("independent reviewer submits displayed real preview proof, executes once and exports recorded evidence", async ({ page }) => {
  const fixture = await pending(); const before = await state();
  await signIn(page, "approver"); await openAction(page, fixture.action.id);
  const dialog = page.getByRole("dialog"); await expect(dialog).toContainText(fixture.proof.fingerprint); await expect(dialog).toContainText("Fixture approver");
  await expect(dialog.getByTestId("action-preview")).toContainText('"before"'); await expect(dialog.getByTestId("action-preview")).toContainText('"after"');
  const sent = page.waitForRequest(request => request.url().endsWith(`/approvals/${fixture.action.id}`) && request.method() === "POST");
  await page.getByRole("button", { name: "Approve & execute" }).click(); expect((await sent).postDataJSON()).toEqual({ decision: "approve", proof: fixture.proof });
  await expect(dialog.locator(".badge")).toHaveText("Allowed"); await expect(dialog).toContainText('"actorId": "approver"');
  expect((await state()).executions[1]).toBe((before.executions[1] ?? 0) + 1);
  const reviewer = await control("approver"); expect((await reviewer(`/approvals/${fixture.action.id}`, { decision: "approve", proof: fixture.proof })).status).toBe(409);
  expect((await state()).executions[1]).toBe((before.executions[1] ?? 0) + 1);
  const download = page.waitForEvent("download"); await dialog.getByRole("link", { name: "Export evidence JSON" }).click(); expect((await download).suggestedFilename()).toContain("agentbrake-evidence-");
  await page.getByRole("button", { name: "Close dialog" }).click(); await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.getByLabel("Recorded action").selectOption(fixture.action.id); await expect(page.getByText("Execution observation: adapter-reported")).toBeVisible();
  const exported = await page.request.get(`/api/evidence/${fixture.action.id}/export?format=json`); expect(exported.status()).toBe(200); const evidence = await exported.json();
  expect(evidence.review.fingerprint).toBe(fixture.proof.fingerprint); expect(evidence.action.result).toBeUndefined(); expect(evidence.review.receipt.actorId).toBe("approver");
  await page.getByRole("button", { name: "Activity", exact: true }).click(); await page.getByLabel("Agent ID", { exact: true }).fill(fixture.action.agentId); await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("button", { name: `Inspect ${fixture.action.id}` })).toBeVisible();
});

test("stale one-time review displays conflict and refreshes status without retrying", async ({ page }) => {
  const fixture = await pending("operator", 3); const reviewer = await control("approver");
  await signIn(page, "approver"); await openAction(page, fixture.action.id);
  expect((await reviewer(`/approvals/${fixture.action.id}`, { decision: "reject", proof: fixture.proof })).status).toBe(200);
  const requests: string[] = []; page.on("request", request => { if (request.method() === "POST" && request.url().endsWith(`/approvals/${fixture.action.id}`)) requests.push(request.postData()!); });
  await page.getByRole("button", { name: "Approve & execute" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("no longer awaiting approval"); await expect(page.getByRole("dialog").locator(".badge")).toHaveText("Blocked");
  expect(requests).toHaveLength(1); await expect(page.getByRole("button", { name: "Approve & execute" })).toHaveCount(0);
});

test("actual committed mutation with withheld output is shown separately from a blocked action", async ({ page }) => {
  const fixture = await pending("operator", 4); const before = await state();
  await signIn(page, "approver"); await openAction(page, fixture.action.id);
  await page.getByRole("button", { name: "Approve & execute" }).click();
  await expect(page.getByRole("dialog").locator(".badge")).toHaveText("Allowed");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.getByLabel("Recorded action").selectOption(fixture.action.id);
  await expect(page.getByText("Execution observation: adapter-reported")).toBeVisible();
  await expect(page.getByText("Result disclosure: withheld")).toBeVisible();
  await expect(page.locator(".evidence-detail").getByRole("alert")).toContainText("Do not resubmit");
  expect((await state()).executions[4]).toBe((before.executions[4] ?? 0) + 1);
  expect(await page.locator("body").textContent()).not.toContain("ghp_" + "Z".repeat(32));
});

test("actual lost response after target commit displays UNKNOWN and never offers retry", async ({ page }) => {
  const fixture = await pending("operator", 2); const before = await state();
  await signIn(page, "approver"); await openAction(page, fixture.action.id); await page.getByRole("button", { name: "Approve & execute" }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog.locator(".badge")).toHaveText("Unknown"); await expect(dialog.getByRole("alert")).toContainText("Reconcile target state");
  await expect(dialog.getByRole("button", { name: /retry|approve/i })).toHaveCount(0); expect((await state()).executions[2]).toBe((before.executions[2] ?? 0) + 1);
  await page.getByRole("button", { name: "Close dialog" }).click(); await page.getByRole("button", { name: "Evidence", exact: true }).click(); await page.getByLabel("Recorded action").selectOption(fixture.action.id);
  await expect(page.getByText("Execution observation: unverified")).toBeVisible(); await expect(page.getByText("Outcome is unverified.", { exact: false })).toContainText("Do not resubmit");
});

async function selectPendingEvidence(page: Page, id: string) {
  await signIn(page, "viewer");
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.getByLabel("Recorded action").selectOption(id);
  await expect(page.getByText("Execution observation: not-dispatched")).toBeVisible();
  await expect(page.locator(".evidence-detail .badge")).toHaveText("Needs approval");
}

test("selected evidence follows another reviewer's execution after workspace Refresh without reselection", async ({ page }) => {
  const fixture = await pending("operator", 1); await selectPendingEvidence(page, fixture.action.id);
  const reviewer = await control("approver"); const approved = await reviewer(`/approvals/${fixture.action.id}`, { decision: "approve", proof: fixture.proof });
  expect(approved.status).toBe(200); expect(approved.body.status).toBe("allowed");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Execution observation: adapter-reported")).toBeVisible();
  await expect(page.locator(".evidence-detail .badge")).toHaveText("Allowed");
  await expect(page.getByLabel("Recorded action")).toHaveValue(fixture.action.id);
  await expect(page.getByText("No target dispatch was recorded for this action.", { exact: true })).toHaveCount(0);
});

test("selected evidence follows actual UNKNOWN through normal workspace polling without reselection", async ({ page }) => {
  const fixture = await pending("operator", 2); await selectPendingEvidence(page, fixture.action.id);
  const reviewer = await control("approver"); const approved = await reviewer(`/approvals/${fixture.action.id}`, { decision: "approve", proof: fixture.proof });
  expect(approved.status).toBe(200); expect(approved.body.status).toBe("unknown");
  // The ordinary ten-second workspace timer is the only refresh trigger here.
  await expect(page.getByText("Execution observation: unverified")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".evidence-detail .badge")).toHaveText("Unknown");
  await expect(page.getByLabel("Recorded action")).toHaveValue(fixture.action.id);
  await expect(page.getByText("Outcome is unverified.", { exact: false })).toContainText("Reconcile target state");
  await expect(page.getByText("No target dispatch was recorded for this action.", { exact: true })).toHaveCount(0);
});

test("selected evidence clears an obsolete observation and exposes a refresh read failure", async ({ page }) => {
  const fixture = await pending("operator", 3); await selectPendingEvidence(page, fixture.action.id);
  const reviewer = await control("approver"); const approved = await reviewer(`/approvals/${fixture.action.id}`, { decision: "approve", proof: fixture.proof });
  expect(approved.status).toBe(200); expect(approved.body.status).toBe("allowed");
  // Only inject a browser-to-API transport failure on the evidence read. The
  // selected pending record, approval and workspace response are real fixtures.
  await page.route(`**/api/evidence/${fixture.action.id}`, route => route.abort("connectionfailed"));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".section-pad").getByRole("alert")).toContainText("Failed to fetch");
  await expect(page.locator(".evidence-detail")).toHaveCount(0);
  await expect(page.getByText("No target dispatch was recorded for this action.", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Recorded action")).toHaveValue(fixture.action.id);
});

test("viewer sees policy history and local connections with role-gated controls and mobile layout", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await signIn(page, "viewer");
  await expect(page.getByRole("button", { name: "Create task identity" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Toggle navigation" }).click(); await page.getByRole("button", { name: "Policies", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Customer record changes" })).toBeDisabled(); await expect(page.getByRole("button", { name: "Save policies" })).toBeDisabled(); await expect(page.getByRole("heading", { name: "Policy revision history" })).toBeVisible();
  await page.getByRole("button", { name: "Toggle navigation" }).click(); await page.getByRole("button", { name: "Connections", exact: true }).click(); await expect(page.getByRole("heading", { name: "Connect your MCP client" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
});

test("Demo Lab uses real gateway denial/read and canonical Git branch/PR reviews", async ({ page, browser }) => {
  await signIn(page, "operator"); await page.getByRole("button", { name: "Demo Lab", exact: true }).click();
  await page.getByRole("button", { name: "Run Safe read" }).click(); await expect(page.locator("main table .badge")).toHaveText("Allowed");
  await page.getByRole("button", { name: "Run Blocked destructive SQL" }).click(); await expect(page.locator("main table .badge")).toHaveText("Blocked");
  await page.getByRole("button", { name: "Run PR approval" }).click(); await expect(page.locator("main table .badge").last()).toHaveText("Needs approval");
  const operator = await control("operator"); let workspace = (await operator("/workspace")).body; const branch = workspace.actions.find((action: any) => action.tool === "github_create_branch" && action.status === "pending"); expect(branch).toBeTruthy();
  const context = await browser.newContext({ baseURL: frontend }); const reviewer = await context.newPage();
  try {
    await signIn(reviewer, "approver"); await openAction(reviewer, branch.id); await expect(reviewer.getByTestId("action-preview")).toContainText("git-branch"); await reviewer.getByRole("button", { name: "Approve & execute" }).click(); await expect(reviewer.getByRole("dialog").locator(".badge")).toHaveText("Allowed"); await reviewer.getByRole("button", { name: "Close dialog" }).click();
    const prRequested = page.waitForResponse(response => response.url().endsWith("/api/demo") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Run PR approval" }).click(); expect((await prRequested).status()).toBe(200); workspace = (await operator("/workspace")).body; const pr = workspace.actions.find((action: any) => action.tool === "github_open_pull_request" && action.status === "pending"); expect(pr).toBeTruthy();
    await reviewer.getByRole("button", { name: "Refresh", exact: true }).click(); await openAction(reviewer, pr.id); await expect(reviewer.getByTestId("action-preview")).toContainText("diff --git"); await expect(reviewer.getByTestId("action-preview")).toContainText("proposalFingerprint"); await reviewer.getByRole("button", { name: "Approve & execute" }).click(); await expect(reviewer.getByRole("dialog").locator(".badge")).toHaveText("Allowed");
  } finally { await context.close(); }
});
