import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

// Actual installed Next/Control service; generated acceptance identities only.
export async function serviceBrowserSmoke({ port, credential, directory }) {
  const base = "http://127.0.0.1:" + port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [],
    externalRequests = [];
  try {
    await context.route("**/*", (route) => {
      const origin = new URL(route.request().url()).origin;
      if (origin === base) return route.continue();
      externalRequests.push(origin);
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel("Email", { exact: true }).fill(credential.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credential.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Security overview" }),
    ).toBeVisible();
    await page.screenshot({
      path: join(directory, "installed-overview.png"),
      fullPage: true,
    });
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Team", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Workspace members" }),
    ).toBeVisible();
    await expect(
      page
        .locator(".member-card")
        .filter({
          has: page.getByRole("heading", {
            name: "Independent reviewer",
            exact: true,
          }),
        }),
    ).toBeVisible();
    await page.screenshot({
      path: join(directory, "installed-team.png"),
      fullPage: true,
    });
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Account settings" }),
    ).toBeVisible();
    await expect(page.getByLabel("Profile name")).toHaveValue("Service owner");
    const storage = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    assert.deepEqual(storage, { local: [], session: [] });
    await page.getByTitle("Sign out").click();
    await expect(
      page.getByRole("heading", { name: "Sign in", exact: true }),
    ).toBeVisible();
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    return {
      accountLogin: true,
      persistedReviewerVisible: true,
      profileVisible: true,
      signedOut: true,
      browserErrors: 0,
      externalRequests: 0,
      credentialStorage: storage,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
