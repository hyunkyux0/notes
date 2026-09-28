import { expect, test } from "@playwright/test";

test("review settings persist, recover from errors, and protect edits across windows", async ({
  context,
}) => {
  let saved = {
    preferences: { intervals: [3, 7, 30], alertTime: "09:00", timezone: "UTC" },
    revision: null as string | null,
  };
  let failSave = false;
  let failLoad = false;
  let loadDelay = 0;
  await context.exposeBinding(
    "settingsInvoke",
    async (
      _,
      command: string,
      args: typeof saved & { expectedRevision: string | null },
    ) => {
      if (command === "get_google_connection")
        return { configured: false, connected: false, connecting: false };
      if (command === "get_vault") return null;
      if (command === "get_review_settings") {
        if (loadDelay)
          await new Promise((resolve) => setTimeout(resolve, loadDelay));
        if (failLoad) throw new Error("Settings could not be read.");
        return saved;
      }
      if (command === "save_review_settings") {
        if (failSave) throw new Error("Settings could not be saved.");
        if (args.expectedRevision !== saved.revision)
          throw new Error("Review settings changed in another window.");
        if (args.preferences.timezone === "bad-zone")
          throw new Error("Unknown IANA timezone.");
        saved = {
          preferences: args.preferences,
          revision: String(Number(saved.revision) + 1),
        };
        return saved;
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  );
  await context.addInitScript(() => {
    const runtime = window as unknown as {
      isTauri: boolean;
      settingsInvoke: unknown;
      __TAURI_INTERNALS__: unknown;
    };
    runtime.isTauri = true;
    runtime.__TAURI_INTERNALS__ = { invoke: runtime.settingsInvoke };
  });
  const first = await context.newPage();
  const second = await context.newPage();
  for (const page of [first, second]) {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Review intervals (days)")).toHaveValue(
      "3, 7, 30",
    );
  }
  await first.getByLabel("Review intervals (days)").fill("1, 5, 20");
  await first.getByLabel("Alert time").fill("18:30");
  await first.getByLabel("Timezone", { exact: true }).fill("bad-zone");
  await first.getByRole("button", { name: "Save review settings" }).click();
  await expect(first.getByRole("alert")).toContainText("Unknown IANA timezone");
  expect(saved.revision).toBeNull();
  await first.getByLabel("Timezone", { exact: true }).fill("Asia/Hong_Kong");
  failSave = true;
  await first.getByRole("button", { name: "Save review settings" }).click();
  await expect(first.getByRole("alert")).toContainText("could not be saved");
  await expect(first.getByLabel("Alert time")).toHaveValue("18:30");
  failSave = false;
  await first.getByRole("button", { name: "Save review settings" }).click();
  await expect(first.getByRole("status")).toHaveText("Review settings saved.");
  await expect(second.getByLabel("Alert time")).toHaveValue("18:30");
  await second.getByLabel("Alert time").fill("20:00");
  await first.getByLabel("Alert time").fill("19:00");
  await first.getByRole("button", { name: "Save review settings" }).click();
  await expect.poll(() => saved.preferences.alertTime).toBe("19:00");
  await expect(second.getByRole("alert")).toContainText("another window");
  await expect(second.getByLabel("Alert time")).toHaveValue("20:00");
  await expect(
    second.getByRole("button", { name: "Save review settings" }),
  ).toBeDisabled();
  await second.getByRole("button", { name: "Reload saved settings" }).click();
  await expect(second.getByLabel("Alert time")).toHaveValue("19:00");
  await second.reload();
  await second.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(second.getByLabel("Alert time")).toHaveValue("19:00");
  failLoad = true;
  await second.getByRole("button", { name: "Reload saved settings" }).click();
  await expect(second.getByRole("alert")).toContainText("could not be read");
  await expect(second.getByLabel("Alert time")).toHaveValue("19:00");
  failLoad = false;
  await second.getByRole("button", { name: "Reload saved settings" }).click();
  await expect(second.getByRole("alert")).toHaveCount(0);
  // A slow explicit reload must finish despite the polling timer and block new input.
  loadDelay = 2500;
  await second.getByRole("button", { name: "Reload saved settings" }).click();
  await expect(second.getByLabel("Alert time")).toBeDisabled();
  await expect(second.getByLabel("Alert time")).toBeEnabled();
  await expect(second.getByLabel("Alert time")).toHaveValue("19:00");
});
