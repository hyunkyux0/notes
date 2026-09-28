import { expect, test } from "@playwright/test";

test("Google setup, cancellation, retry and local disconnect expose no credentials", async ({
  page,
}) => {
  const status = { configured: false, connected: false, connecting: false };
  let firstAttempt = true;
  let cancel: (() => void) | undefined;
  await page.exposeBinding("googleInvoke", async (_, command: string) => {
    switch (command) {
      case "get_vault":
        return null;
      case "get_review_settings":
        return {
          preferences: {
            intervals: [3, 7, 30],
            alertTime: "09:00",
            timezone: "UTC",
          },
          revision: null,
        };
      case "get_google_connection":
        return status;
      case "import_google_client":
        status.configured = true;
        return status;
      case "connect_google": {
        status.connecting = true;
        if (firstAttempt) {
          firstAttempt = false;
          await new Promise<void>((_, reject) => {
            cancel = () => {
              status.connecting = false;
              reject(new Error("Google sign-in cancelled."));
            };
          });
        }
        status.connected = true;
        status.connecting = false;
        return;
      }
      case "cancel_google_sign_in":
        cancel?.();
        return;
      case "disconnect_google":
        status.connected = false;
        return "Disconnected locally. Google revocation could not be confirmed.";
      default:
        throw new Error(`Unexpected command ${command}`);
    }
  });
  await page.addInitScript(() => {
    const runtime = window as unknown as {
      isTauri: boolean;
      googleInvoke: unknown;
      __TAURI_INTERNALS__: unknown;
    };
    runtime.isTauri = true;
    runtime.__TAURI_INTERNALS__ = { invoke: runtime.googleInvoke };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const panel = page.getByRole("region", { name: "Google connection" });
  await expect(
    panel.getByRole("button", { name: "Connect Google", exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole("button", { name: "Import Google client JSON" })
    .click();
  await panel
    .getByRole("button", { name: "Connect Google", exact: true })
    .click();
  await expect(panel).toContainText("Waiting for Google sign-in");
  await panel.getByRole("button", { name: "Cancel Google sign-in" }).click();
  await expect(panel.getByRole("alert")).toContainText("cancelled");
  await panel
    .getByRole("button", { name: "Connect Google", exact: true })
    .click();
  await expect(panel).toContainText("Google credentials saved on this device");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(panel).toContainText("Google credentials saved on this device");
  await panel.getByRole("button", { name: "Disconnect Google" }).click();
  await expect(panel.getByRole("status")).toContainText("Disconnected locally");
  await expect(
    panel.getByRole("button", { name: "Connect Google", exact: true }),
  ).toBeEnabled();
});
