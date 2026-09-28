import { expect, type Page, test } from "@playwright/test";

test("two windows isolate vaults and hand off a retained draft without overwriting it", async ({
  context,
}) => {
  const vaults = new Map<Page, string>();
  const editors = new Map<string, { page: Page; token: string }>();
  const disk = new Map<string, string>();
  const failedSaves = new Set<Page>();
  let createdWindows = 0;
  const releaseWindow = (page: Page) => {
    for (const [key, owner] of editors)
      if (owner.page === page) editors.delete(key);
  };
  context.on("page", (page) => page.on("close", () => releaseWindow(page)));
  await context.exposeBinding(
    "desktopInvoke",
    async ({ page }, command: string, args: Record<string, string> = {}) => {
      const vault = vaults.get(page) ?? "/test/one";
      const key = `${args.vaultPath}/${args.filename}`;
      const content = disk.get(key) ?? "# Original\n";
      const note = { filename: args.filename, id: null, content };
      switch (command) {
        case "window_loaded":
          releaseWindow(page);
          return;
        case "get_vault":
          return { path: vault };
        case "choose_vault":
          vaults.set(page, "/test/two");
          return { path: "/test/two" };
        case "new_window":
          createdWindows++;
          return;
        case "list_vault_contents":
          return { files: ["study.md", "other.md"], folders: [] };
        case "read_note":
          return note;
        case "acquire_note": {
          const owner = editors.get(key);
          if (owner && (owner.page !== page || owner.token !== args.token))
            return false;
          editors.set(key, { page, token: args.token });
          return true;
        }
        case "release_note":
          for (const [key, owner] of editors) {
            if (owner.page === page && owner.token === args.token)
              editors.delete(key);
          }
          return;
        case "save_note":
          if (args.vaultPath !== vault) throw new Error("Wrong window vault");
          if (
            editors.get(key)?.page !== page ||
            editors.get(key)?.token !== args.editToken
          )
            throw new Error("Not editable here");
          if (failedSaves.has(page))
            throw new Error("Save failed; draft retained");
          if (content !== args.expectedContent && content !== args.body)
            throw new Error("External conflict");
          disk.set(key, args.body);
          return { ...note, content: args.body };
        default:
          throw new Error(`Unexpected command ${command}`);
      }
    },
  );
  await context.addInitScript(() => {
    const runtime = window as unknown as {
      desktopInvoke: (
        command: string,
        args?: Record<string, string>,
      ) => Promise<unknown>;
      isTauri: boolean;
      __TAURI_INTERNALS__: {
        invoke: (
          command: string,
          args?: Record<string, string>,
        ) => Promise<unknown>;
      };
    };
    runtime.isTauri = true;
    const loaded = runtime.desktopInvoke("window_loaded");
    runtime.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        await loaded;
        return runtime.desktopInvoke(command, args);
      },
    };
  });
  const first = await context.newPage();
  await first.goto("/");
  await first.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(first.getByLabel("Markdown content")).toBeVisible();
  await first.getByRole("button", { name: "New window", exact: true }).click();
  expect(createdWindows).toBe(1);

  const second = await context.newPage();
  await second.goto("/");
  await second.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(second.getByLabel("Note reader")).toContainText(
    "another window",
  );
  await first.getByLabel("Markdown content").fill("# Saved in first window");
  await expect
    .poll(() => disk.get("/test/one/study.md"))
    .toBe("# Saved in first window");
  await expect(second.getByLabel("Note reader")).toContainText(
    "# Saved in first window",
  );

  // Different notes in the same vault can be edited simultaneously.
  await second.getByRole("button", { name: "other.md", exact: true }).click();
  await second.getByLabel("Markdown content").fill("# Other note");
  await expect.poll(() => disk.get("/test/one/other.md")).toBe("# Other note");
  await second.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(second.getByLabel("Note reader")).toBeVisible();

  failedSaves.add(first);
  await first.getByLabel("Markdown content").fill("# Recover this draft");
  await expect(first.getByRole("alert")).toContainText("Save failed");
  const draftKey = 'notes:draft:["/test/one","study.md"]';
  expect(
    await second.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toContain("# Recover this draft");
  await second.getByRole("button", { name: "Edit here" }).click();
  await expect(second.getByLabel("Note reader")).toContainText(
    "another window",
  );
  expect(
    await second.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toContain("# Recover this draft");
  await first.close();
  await second.getByRole("button", { name: "Edit here" }).click();
  await expect(second.getByLabel("Markdown content")).toContainText(
    "# Recover this draft",
  );
  await expect
    .poll(() => disk.get("/test/one/study.md"))
    .toBe("# Recover this draft");
  await second.reload();
  await second.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(second.getByLabel("Markdown content")).toBeVisible();

  const third = await context.newPage();
  await third.goto("/");
  await third.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(third.getByLabel("Note reader")).toBeVisible();
  await third
    .getByRole("button", { name: "Switch vault: one", exact: true })
    .click();
  await third.getByRole("button", { name: "study.md", exact: true }).click();
  await third.getByLabel("Markdown content").fill("# Separate vault");
  await expect
    .poll(() => disk.get("/test/two/study.md"))
    .toBe("# Separate vault");
  await second
    .getByLabel("Markdown content")
    .fill("# Original vault still works");
  await expect
    .poll(() => disk.get("/test/one/study.md"))
    .toBe("# Original vault still works");
});
