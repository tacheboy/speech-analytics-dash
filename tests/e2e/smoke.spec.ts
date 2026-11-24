import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, userId: string) {
  await page.context().addCookies([{ name: "demo_user", value: userId, url: "http://localhost:3200" }]);
}

test("login picker signs in and lands on the dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: /Ananya Iyer/ }).click();
  await expect(page.getByRole("heading", { name: /Ananya/ })).toBeVisible();
  await expect(page.getByText("Quality score").first()).toBeVisible();
  await expect(page.getByText("Top performers")).toBeVisible();
});

test("call list filters live in the URL and sort", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.goto("/calls/mid-bucket?outcome=Dispute%20Raised");
  await expect(page.getByRole("button", { name: /Outcome: Dispute Raised/ })).toBeVisible();
  const outcomes = page.locator("tbody tr td:nth-child(4)");
  await expect(outcomes.first()).toHaveText("Dispute Raised");
  await page.getByRole("button", { name: "Score" }).click();
  await expect(page).toHaveURL(/sort=score/);
});

test("upload a demo recording: processing → analyzed", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.goto("/calls/early-bucket");
  await page.getByRole("button", { name: "Upload call" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "Rahul Sharma" }).click();
  await dialog.getByRole("button", { name: /Call with/ }).first().click();
  await dialog.getByRole("button", { name: "Upload & analyze" }).click();
  await expect(page.getByText("Processing").first()).toBeVisible();
  await expect(page.locator("tbody tr").first().getByText("Analyzed")).toBeVisible({ timeout: 30_000 });
});

test("call detail: transcript seeks audio, manager override changes the score", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.goto("/calls/early-bucket?scoreBucket=excellent&sort=date");
  await page.locator("tbody tr").first().click();
  await expect(page.getByText(/of \d+ applicable criteria met/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled({ timeout: 15_000 });
  const line = page.locator("[data-i='3']");
  await line.click();
  await expect(page.getByText(/^0:(1|2|3)\d \/ /)).toBeVisible();

  const ring = page.getByRole("img", { name: /Overall score/ });
  const before = await ring.getAttribute("aria-label");
  await page.getByRole("button", { name: "Review & override" }).click();
  await page.getByRole("radio", { name: "Missed" }).first().click();
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText(/Reviewed by Ananya Iyer/)).toBeVisible();
  await expect(ring).not.toHaveAttribute("aria-label", before!);
});

test("analytics tabs and drill-through to calls", async ({ page }) => {
  await signIn(page, "u_admin");
  await page.goto("/analytics/category/early-bucket");
  await expect(page.getByText("Most common failure")).toBeVisible();
  await page.getByRole("tab", { name: "Quality analysis" }).click();
  await expect(page.getByText("Quality improvement hub")).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("button", { name: /Promise to Pay/ }).first().click();
  await expect(page).toHaveURL(/\/calls\/early-bucket\?outcome=Promise/);
});

test("agents only see their own calls and a trimmed nav", async ({ page }) => {
  await signIn(page, "u_rahul_sharma");
  await page.goto("/calls/all");
  await expect(page.getByRole("heading", { name: "My calls" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Review queue" })).toHaveCount(0);
  const names = await page.locator("tbody tr td:first-child a").allTextContents();
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names)).toEqual(new Set(["Rahul Sharma"]));
});

test("every sidebar destination renders", async ({ page }) => {
  await signIn(page, "u_admin");
  for (const path of ["/calls", "/analytics/org/all", "/agents", "/agents/u_arun_prakash", "/teams", "/review", "/calls/settlement/configuration", "/workspace/users", "/workspace/tags", "/workspace/billing", "/workspace/integrations", "/settings"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.locator("main h1")).toBeVisible();
  }
});
