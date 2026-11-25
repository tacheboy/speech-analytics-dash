import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, userId: string) {
  const r = await page.request.post("/api/internal/session", { data: { userId } });
  expect(r.status()).toBe(204);
}

test("login picker signs in and lands on the platform", async ({ page }) => {
  await page.goto("/platform");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: /Ananya Iyer/ }).click();
  await expect(page.getByRole("heading", { name: /Ananya/ })).toBeVisible();
  await expect(page.getByText("Quality score").first()).toBeVisible();
  await expect(page.getByText("Top performers")).toBeVisible();
});

test("conversation list filters live in the URL and sort", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.goto("/conversations/mid-bucket?outcome=Dispute%20Raised");
  await expect(page.getByRole("button", { name: /Outcome: Dispute Raised/ })).toBeVisible();
  const outcomes = page.locator("tbody tr td:nth-child(4)");
  await expect(outcomes.first()).toHaveText("Dispute Raised");
  await page.getByRole("button", { name: "Score" }).click();
  await expect(page).toHaveURL(/sort=score/);
});

test("upload a demo recording: processing → analyzed", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.goto("/conversations/early-bucket");
  await page.getByRole("button", { name: "Upload conversation" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "Rahul Sharma" }).click();
  await dialog.getByRole("button", { name: /Conversation with/ }).first().click();
  const created = page.waitForResponse((r) => r.url().endsWith("/api/v1/conversations") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Upload & analyze" }).click();
  const conv = await (await created).json();
  expect(conv.status).toBe("queued");
  const row = page.locator("tbody tr", { hasText: conv.id.replace("conv_", "#") });
  await expect(row.getByText("Analyzed")).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByText(/transcribed by/)).toBeVisible();
});

test("conversation detail: transcript seeks audio, manager override changes the score", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.goto("/conversations/early-bucket?score=excellent&sort=date");
  await page.locator("tbody tr").first().click();
  await expect(page.getByText(/of \d+ applicable criteria met/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled({ timeout: 15_000 });
  const line = page.locator("[data-i='3']");
  await line.click();
  await expect(page.getByText(/^0:(1|2|3)\d \/ /)).toBeVisible();

  const ring = page.getByRole("img", { name: /Overall score/ });
  const before = await ring.getAttribute("aria-label");
  await page.getByRole("button", { name: "Audit & override" }).click();
  await page.getByRole("radio", { name: "No", exact: true }).first().click();
  await page.getByRole("button", { name: "Save audit" }).click();
  await expect(page.getByText(/Audited by Ananya Iyer/)).toBeVisible();
  await expect(ring).not.toHaveAttribute("aria-label", before!);
});

test("conversation intelligence: tag tree drills into conversations at any level", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.goto("/analytics/org/all?tab=intelligence");
  await expect(page.getByText("Why conversations weren’t successful")).toBeVisible();
  await page.getByRole("link", { name: "Customer objection", exact: true }).click();
  await expect(page).toHaveURL(/tag=objection/);
  await expect(page.getByRole("button", { name: /Tag: Customer objection \(all\)/ })).toBeVisible();
});

test("analytics tabs and drill-through to conversations", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.goto("/analytics/category/early-bucket");
  await expect(page.getByText("Most common failure")).toBeVisible();
  await page.getByRole("tab", { name: "Quality analysis" }).click();
  await expect(page.getByText("Quality improvement hub")).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("button", { name: /Promise to Pay/ }).first().click();
  await expect(page).toHaveURL(/\/conversations\/early-bucket\?outcome=Promise/);
});

test("members only see their own conversations and a trimmed nav", async ({ page }) => {
  await signIn(page, "per_rahul_sharma");
  await page.goto("/conversations/all");
  await expect(page.getByRole("heading", { name: "My conversations" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Audits" })).toHaveCount(0);
  const names = await page.locator("tbody tr td:first-child a").allTextContents();
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names)).toEqual(new Set(["Rahul Sharma"]));
});

test("every sidebar destination renders", async ({ page }) => {
  await signIn(page, "u_admin");
  for (const path of ["/conversations", "/analytics/org/all", "/people", "/people/per_arun_prakash", "/cohorts", "/audits", "/conversations/settlement/configuration", "/workspace/users", "/workspace/tags", "/workspace/billing", "/workspace/integrations", "/workspace/pipeline", "/settings"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.locator("main h1")).toBeVisible();
  }
});

test("API reference renders from the OpenAPI document", async ({ page }) => {
  const res = await page.goto("/docs/api");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Platform API" })).toBeVisible();
  await expect(page.getByText("Submit a recording for analysis")).toBeVisible();
});

test("audits queues and settings show the pipeline configuration", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.goto("/audits?queue=review");
  await expect(page.getByRole("tab", { name: "Needs review" })).toHaveAttribute("aria-selected", "true");
  await page.goto("/settings");
  await expect(page.getByText("AI providers")).toBeVisible();
  await expect(page.getByText("mock:replay").first()).toBeVisible();
});
