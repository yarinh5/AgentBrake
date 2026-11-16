import { test, expect } from "@playwright/test";
import { keys } from "./constants.js";
import { backend, frontend } from "./constants.js";
import type { Page } from "@playwright/test";
test.describe.configure({ mode: "serial" });
const adminEmail = "admin@fixture.test", adminPassword = "synthetic-admin-password";
async function login(page: Page, email = adminEmail, password = adminPassword) {
  await page.goto("/"); await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Security overview" })).toBeVisible();

}
async function team(page: Page) { await page.getByRole("navigation").getByRole("button", {name:"Team",exact:true}).click(); await expect(page.getByRole("heading",{name:"Workspace members"})).toBeVisible(); await page.getByRole("button",{name:"Refresh",exact:true}).click(); }
async function invite(page: Page, email: string, role: string) {
  await team(page); await page.getByLabel("Invitation email").fill(email); await page.getByLabel("Invitation role").selectOption(role);
  await page.getByRole("button",{name:"Create invitation"}).click(); await expect(page.getByLabel("One-time link")).toBeVisible();
  const link = await page.getByLabel("One-time link").inputValue(); await page.getByRole("button",{name:"Dismiss link"}).click(); return link;
}
async function accept(page: Page, link: string, name: string, password = "synthetic-member-password") {
  await page.goto(link); await expect(page.getByRole("heading",{name:"Accept invitation"})).toBeVisible();
  expect(page.url()).toBe(frontend + "/");
  expect(await page.evaluate(() => ({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}))).toEqual({local:[],session:[]});
  await page.getByLabel("Full name").fill(name); await page.getByLabel("Password",{exact:true}).fill(password); await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button",{name:"Accept invitation",exact:true}).click();
}

test("managed workspace requires one-time bootstrap then account sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up workspace" })).toBeVisible();
  await page.getByLabel("Bootstrap key").fill("incorrect-bootstrap");
  await page.getByLabel("Full name").fill("Workspace Admin");
  await page.getByLabel("Email", { exact: true }).fill("admin@fixture.test");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-admin-password");
  await page.getByLabel("Confirm password").fill("synthetic-admin-password");
  await page.getByRole("button", { name: "Set up workspace" }).click();
  await expect(page.locator(".error[role=alert]")).toBeVisible();
  await page.getByLabel("Bootstrap key").fill(keys.administrator);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-admin-password");
  await page.getByLabel("Confirm password").fill("synthetic-admin-password");
  await page.getByRole("button", { name: "Set up workspace" }).click();
  await expect(page.getByRole("heading", { name: "Security overview" })).toBeVisible();
  await page.getByTitle("Sign out").click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const repeated = await page.request.post("/api/setup", {headers:{Origin:frontend},data:{key:keys.administrator,name:"Repeat",email:adminEmail,password:adminPassword}}); expect(repeated.status()).toBe(409);
  await page.getByLabel("Email",{exact:true}).fill(adminEmail); await page.getByLabel("Password",{exact:true}).fill("incorrect-password-long"); await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page.locator(".error[role=alert]")).toContainText("Invalid account credential");
  await login(page);
  await page.getByRole("button",{name:/^Get started:/}).click(); await expect(page.getByRole("heading",{name:"Your first controlled task"})).toBeVisible();
});

test("administrator invites viewer, changes role, disables session and preserves last administrator", async ({page,browser}) => {
  await login(page);
  const link = await invite(page,"viewer@fixture.test","viewer");
  const context = await browser.newContext(), viewer = await context.newPage();
  try {
    await accept(viewer,link,"Fixture Viewer"); await expect(viewer.getByRole("heading",{name:"Security overview"})).toBeVisible();
    await expect(viewer.getByRole("navigation").getByRole("button",{name:"Team",exact:true})).toHaveCount(0);
    await expect(viewer.locator(".user-profile")).toContainText("viewer");
    expect((await viewer.request.get(frontend+"/api/team")).status()).toBe(403);
    await viewer.goto(frontend+"/#Team"); await expect(viewer.getByRole("heading",{name:"Workspace members"})).toHaveCount(0);
    await team(page); const member=page.locator(".member-card").filter({has:page.getByRole("heading",{name:"Fixture Viewer",exact:true})});
    await member.getByLabel("Member role").selectOption("operator"); await member.getByRole("button",{name:"Save member"}).click();
    await expect(member.getByText("Current role: operator",{exact:true})).toBeVisible();
    await viewer.getByRole("button",{name:"Refresh",exact:true}).click(); await expect(viewer.getByRole("heading",{name:"Sign in",exact:true})).toBeVisible();
    await login(viewer,"viewer@fixture.test","synthetic-member-password"); await expect(viewer.getByRole("button",{name:"Create task identity"})).toBeVisible();
    await member.getByLabel("Account active").uncheck(); await member.getByRole("button",{name:"Save member"}).click(); await expect(member.getByText("Disabled",{exact:true})).toBeVisible();
    await viewer.getByRole("button",{name:"Refresh",exact:true}).click(); await expect(viewer.getByRole("heading",{name:"Sign in",exact:true})).toBeVisible();
    const admin=page.locator(".member-card").filter({has:page.getByRole("heading",{name:"Workspace Admin",exact:true})});
    await admin.getByLabel("Account active").uncheck(); await admin.getByRole("button",{name:"Save member"}).click(); await expect(page.locator(".error[role=alert]")).toContainText("last active administrator");
    await expect(admin.getByText("Active",{exact:true})).toBeVisible();
    await expect(admin.getByLabel("Account active")).toBeChecked();
    await expect(admin.getByLabel("Member role")).toHaveValue("administrator");
  } finally {await context.close();}
});

test("member drafts survive unchanged background polling and real authority changes reconcile", async ({ page }) => {
  test.setTimeout(45_000);
  await login(page);
    // Reuse the synthetic member created above. Another public acceptance would
    // exhaust the real shared credential-attempt budget in this fresh suite.
    const loaded = page.waitForResponse(response => response.url().endsWith("/api/team") && response.request().method() === "GET");
    await page.getByRole("navigation").getByRole("button", { name: "Team", exact: true }).click();
    await (await loaded).finished();
    const member = page.locator(".member-card").filter({ has: page.getByRole("heading", { name: "Fixture Viewer", exact: true }) });
    await expect(member.getByText("Current role: operator", { exact: true })).toBeVisible();
    await expect(member.getByText("Disabled", { exact: true })).toBeVisible();
    const role = member.getByLabel("Member role"), active = member.getByLabel("Account active");
    await role.selectOption("viewer");
    await active.check();

    // No Refresh button or mocked clock: the ordinary ten-second workspace
    // timer must drive this real team read through the dashboard proxy.
    const unchanged = await page.waitForResponse(response => response.url().endsWith("/api/team") && response.request().method() === "GET", { timeout: 15_000 });
    expect(unchanged.status()).toBe(200);
    await unchanged.finished();
    await expect(role).toHaveValue("viewer");
    await expect(active).toBeChecked();

    const saved = page.waitForResponse(response => /\/api\/team\/[^/]+$/.test(response.url()) && response.request().method() === "PATCH");
    await member.getByRole("button", { name: "Save member" }).click();
    const response = await saved;
    expect(response.request().postDataJSON()).toEqual({ role: "viewer", active: true });
    expect(response.status()).toBe(200);
    const account = await response.json();
    const authoritative = await (await page.request.get("/api/team")).json();
    expect(authoritative.members.find((value: { id: string }) => value.id === account.id)).toMatchObject({ role: "viewer", active: true });
    await expect(member.getByText("Current role: viewer", { exact: true })).toBeVisible();
    await expect(member.getByText("Active", { exact: true })).toBeVisible();
    await expect(role).toHaveValue("viewer");
    await expect(active).toBeChecked();

    await role.selectOption("operator");
    const session = await (await page.request.get("/api/session")).json();
    const reconciled = page.waitForResponse(value => value.url().endsWith("/api/team") && value.request().method() === "GET", { timeout: 15_000 });
    const changed = await page.request.patch(`/api/team/${account.id}`, { headers: { Origin: frontend, "X-AB-CSRF": session.csrfToken }, data: { role: "approver", active: false } });
    expect(changed.status()).toBe(200);
    await (await reconciled).finished();
    await expect(member.getByText("Current role: approver", { exact: true })).toBeVisible();
    await expect(role).toHaveValue("approver");
    await expect(active).not.toBeChecked();
});

test("profile/password and administrator recovery use real one-time links and fresh login", async ({page,browser}) => {
  await login(page); const link=await invite(page,"profile@fixture.test","operator"); const context=await browser.newContext(), member=await context.newPage();
  const changed="synthetic-changed-password", recovered="synthetic-recovered-password";
  try {
    await accept(member,link,"Profile Member"); await expect(member.getByRole("heading",{name:"Security overview"})).toBeVisible();
    await member.getByRole("button",{name:"Settings",exact:true}).click(); await member.getByLabel("Profile name").fill("Renamed Member"); await member.getByRole("button",{name:"Save profile"}).click(); await expect(member.getByRole("status")).toContainText("Profile saved");
    await member.getByLabel("Current password").fill("synthetic-member-password"); await member.getByLabel("New password",{exact:true}).fill(changed); await member.getByLabel("Confirm new password").fill(changed); await member.getByRole("button",{name:"Change password"}).click(); await expect(member.getByRole("heading",{name:"Sign in",exact:true})).toBeVisible();
    await member.getByLabel("Email",{exact:true}).fill("profile@fixture.test"); await member.getByLabel("Password",{exact:true}).fill("synthetic-member-password"); await member.getByRole("button",{name:"Sign in",exact:true}).click(); await expect(member.locator(".error[role=alert]")).toContainText("Invalid account credential");
    await login(member,"profile@fixture.test",changed);
    await team(page); const card=page.locator(".member-card").filter({has:page.getByRole("heading",{name:"Renamed Member",exact:true})}); await card.getByRole("button",{name:"Issue recovery link"}).click(); const recovery=await page.getByLabel("One-time link").inputValue(); await expect(page.getByText(/15 minutes/)).toBeVisible();
    await member.goto(recovery); await expect(member.getByRole("heading",{name:"Reset password"})).toBeVisible(); expect(member.url()).toBe(frontend+"/");
    await member.getByLabel("Password",{exact:true}).fill(recovered); await member.getByLabel("Confirm password").fill(recovered); await member.getByRole("button",{name:"Reset password",exact:true}).click(); await expect(member.getByRole("heading",{name:"Sign in",exact:true})).toBeVisible();
    await login(member,"profile@fixture.test",recovered);
    expect((await member.request.post(frontend+"/api/login",{headers:{Origin:frontend},data:{email:"profile@fixture.test",password:changed}})).status()).toBe(401);
    await member.goto(recovery); await member.getByLabel("Password",{exact:true}).fill(recovered); await member.getByLabel("Confirm password").fill(recovered); await member.getByRole("button",{name:"Reset password",exact:true}).click(); await expect(member.locator(".error[role=alert]")).toContainText("fresh link");
  } finally {await context.close();}
});

test("expired, revoked and replayed invitations are actionable and fragment secrets stay out of browser storage", async({page,browser})=>{
  await login(page);
  const context=await browser.newContext(), recipient=await context.newPage();
  try {
    const expired=await invite(page,"expired@fixture.test","viewer");
    expect((await fetch(backend+"/__fixture/expire-invitations",{method:"POST"})).status).toBe(200);
    await accept(recipient,expired,"Expired Viewer"); await expect(recipient.locator(".error[role=alert]")).toContainText("fresh link");
    const revoked=await invite(page,"revoked@fixture.test","viewer"); await page.getByRole("button",{name:"Revoke invitation for revoked@fixture.test"}).click(); await expect(page.getByRole("button",{name:"Revoke invitation for revoked@fixture.test"})).toHaveCount(0);
    await accept(recipient,revoked,"Revoked Viewer"); await expect(recipient.locator(".error[role=alert]")).toContainText("fresh link");
    const used=await invite(page,"used@fixture.test","viewer"); await accept(recipient,used,"Used Viewer"); await expect(recipient.getByRole("heading",{name:"Security overview"})).toBeVisible();
    await accept(recipient,used,"Used Again"); await expect(recipient.locator(".error[role=alert]")).toContainText("fresh link");
    expect(recipient.url()).toBe(frontend+"/"); expect(await recipient.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}))).toEqual({local:[],session:[]});
  } finally {await context.close();}
});

test("setup transport errors offer a real retry and managed account forms fit mobile",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route("**/api/setup",route=>route.abort("connectionfailed")); await page.goto("/");
  await expect(page.getByRole("heading",{name:"Workspace unavailable"})).toBeVisible(); await page.unroute("**/api/setup"); await page.getByRole("button",{name:"Retry connection"}).click(); await expect(page.getByRole("heading",{name:"Sign in",exact:true})).toBeVisible(); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("managed owner and invited independent approver review real preview once with evidence",async({page,browser})=>{
  await login(page); const link=await invite(page,"approver@fixture.test","approver"); const context=await browser.newContext(), reviewer=await context.newPage();
  try {
    await accept(reviewer,link,"Independent Approver"); await expect(reviewer.getByRole("heading",{name:"Security overview"})).toBeVisible();
    await page.getByRole("button",{name:"Create task identity"}).click(); await page.getByLabel("Agent name").fill("Managed reviewed task"); await page.getByLabel("database_update",{exact:true}).check();
    const createdResponse=page.waitForResponse(r=>r.url().endsWith("/api/agents")&&r.request().method()==="POST"); await page.getByRole("button",{name:"Create scoped agent"}).click(); const created=await (await createdResponse).json();
    const actionResponse=await fetch(backend+"/api/actions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${created.token}`},body:JSON.stringify({requestId:crypto.randomUUID(),tool:"database_update",arguments:{id:1,status:"paused"}})}); const action=await actionResponse.json(); expect(action.status).toBe("pending");
    await reviewer.getByRole("button",{name:/^Approvals/}).click(); await reviewer.getByRole("button",{name:"Refresh",exact:true}).click(); await reviewer.getByRole("button",{name:`Inspect ${action.id}`,exact:true}).click(); await expect(reviewer.getByTestId("action-preview")).toContainText('"before"'); const sent=reviewer.waitForRequest(r=>r.url().endsWith(`/api/approvals/${action.id}`)&&r.method()==="POST"); await reviewer.getByRole("button",{name:"Approve & execute"}).click(); const proof=(await sent).postDataJSON().proof; await expect(reviewer.getByRole("dialog").locator(".badge")).toHaveText("Allowed");
    const exported=await reviewer.request.get(frontend+`/api/evidence/${action.id}/export?format=json`); expect(exported.status()).toBe(200); const evidence=await exported.json(); expect(evidence.review.receipt.actorId).not.toBe(created.agent.ownerId); expect(evidence.execution.status).toBe("allowed");
    const before=await (await fetch(backend+"/__fixture")).json(); expect(before.executions[1]).toBe(1);
    const session=await (await reviewer.request.get(frontend+"/api/session")).json(); const replay=await reviewer.request.post(frontend+`/api/approvals/${action.id}`,{headers:{Origin:frontend,"X-AB-CSRF":session.csrfToken},data:{decision:"approve",proof}}); expect(replay.status()).toBe(409); expect((await (await fetch(backend+"/__fixture")).json()).executions[1]).toBe(1);
  } finally {await context.close();}
});
