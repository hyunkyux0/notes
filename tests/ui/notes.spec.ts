import { expect, test } from "@playwright/test";

const diskKey = "test:disk";
const draftKey = 'notes:draft:["/test/vault","study.md"]';

test.beforeEach(async ({ page }) => {
  // Mock only the desktop transport; Rust tests exercise actual file replacement.
  await page.addInitScript(() => {
    const runtime = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: {
        invoke: (
          command: string,
          args?: Record<string, string>,
        ) => Promise<unknown>;
      };
    };
    runtime.isTauri = true;
    runtime.__TAURI_INTERNALS__ = {
      invoke: async (command, args = {}) => {
        const content = localStorage.getItem("test:disk") ?? "# Original\n";
        const filename = localStorage.getItem("test:filename") ?? "study.md";
        const note = { filename, id: null, content };
        switch (command) {
          case "get_vault":
            return { path: "/test/vault" };
          case "list_vault_contents":
            return {
              files: sessionStorage.getItem("test:missing") ? [] : [filename],
              folders: JSON.parse(localStorage.getItem("test:folders") ?? "[]"),
            };
          case "create_folder": {
            const folders: string[] = JSON.parse(
              localStorage.getItem("test:folders") ?? "[]",
            );
            const path = args.parent
              ? `${args.parent}/${args.name}`
              : args.name;
            if (folders.includes(path) || args.name.includes("/"))
              throw "Folder already exists or invalid name";
            localStorage.setItem(
              "test:folders",
              JSON.stringify([...folders, path]),
            );
            return path;
          }
          case "create_note": {
            const filename = `${args.folder ? `${args.folder}/` : ""}new.md`;
            const content = `# ${args.title}\n`;
            localStorage.setItem("test:filename", filename);
            localStorage.setItem("test:disk", content);
            return { filename, id: null, content };
          }
          case "read_note":
            if (sessionStorage.getItem("test:missing")) throw "File missing";
            return note;
          case "rename_note": {
            if (args.newFilename === "occupied.md")
              throw "Destination already exists";
            if (args.expectedContent !== content)
              throw "Conflict: external edit";
            localStorage.setItem("test:filename", args.newFilename);
            return { ...note, filename: args.newFilename };
          }
          case "save_note": {
            if (args.filename !== filename) throw "Wrong note filename";
            sessionStorage.setItem(
              "test:saves",
              String(Number(sessionStorage.getItem("test:saves")) + 1),
            );
            await new Promise((resolve) =>
              setTimeout(resolve, Number(sessionStorage.getItem("test:delay"))),
            );
            if (sessionStorage.getItem("test:fail"))
              throw "Save failed; draft retained";
            const disk = localStorage.getItem("test:disk") ?? "# Original\n";
            if (disk !== args.expectedContent && disk !== args.body)
              throw "Conflict: external edit; draft retained";
            localStorage.setItem("test:disk", args.body);
            return { ...note, content: args.body };
          }
          default:
            throw new Error(`Unexpected command: ${command}`);
        }
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "study.md", exact: true }).click();
});

test("debounces changes and saves the newest text typed during a save", async ({
  page,
}) => {
  await page.evaluate(() => sessionStorage.setItem("test:delay", "600"));
  const editor = page.getByLabel("Markdown content");
  await editor.fill("# First draft");
  await expect(page.getByRole("status")).toHaveText("Saving…");
  await editor.fill("# Latest draft");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), diskKey))
    .toBe("# Latest draft");
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toBeNull();
});

test("recovers unsaved text after navigation and reload", async ({ page }) => {
  await page.getByLabel("Markdown content").fill("# Recover me");
  await page.getByRole("button", { name: "Reviews", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveValue("# Recover me");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), diskKey))
    .toBe("# Recover me");
});

test("conflict retains both versions and reload requires explicit discard", async ({
  page,
}) => {
  await page.evaluate(
    (key) => localStorage.setItem(key, "# External edit"),
    diskKey,
  );
  await page.getByLabel("Markdown content").fill("# My draft");
  await expect(page.getByRole("alert")).toContainText("Conflict");
  expect(await page.evaluate((key) => localStorage.getItem(key), diskKey)).toBe(
    "# External edit",
  );
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByRole("alert")).toContainText("Conflict");

  await page.getByRole("button", { name: "Reload disk version" }).click();
  await page.getByRole("button", { name: "Keep draft" }).click();
  await expect(page.getByLabel("Markdown content")).toHaveValue("# My draft");
  await page.getByRole("button", { name: "Reload disk version" }).click();
  await page.getByRole("button", { name: "Discard draft and reload" }).click();
  await expect(page.getByLabel("Markdown content")).toHaveValue(
    "# External edit",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toBeNull();
});

test("failed save retains draft and retry succeeds", async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem("test:fail", "yes"));
  await page.getByLabel("Markdown content").fill("# Retained");
  await expect(page.getByRole("alert")).toContainText("Save failed");
  await page.reload();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveValue("# Retained");
  await expect(page.getByRole("alert")).toContainText("Save failed");
  await page.evaluate(() => sessionStorage.removeItem("test:fail"));
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
});

test("deleted notes still expose their recovery draft after restart", async ({
  page,
}) => {
  await page.getByLabel("Markdown content").fill("# Keep after deletion");
  await page.evaluate(() => {
    sessionStorage.setItem("test:missing", "yes");
    sessionStorage.setItem("test:fail", "yes");
  });
  await page.reload();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveValue(
    "# Keep after deletion",
  );
  await expect(
    page.getByText(
      "The disk file is unavailable. Showing its recovery draft so you can copy it.",
    ),
  ).toBeVisible();
});

test("corrupt drafts pause editing until explicitly discarded", async ({
  page,
}) => {
  await page.evaluate((key) => localStorage.setItem(key, "{broken"), draftKey);
  await page.reload();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toBeDisabled();
  await page.getByRole("button", { name: "Reload disk version" }).click();
  await page.getByRole("button", { name: "Discard draft and reload" }).click();
  await expect(page.getByLabel("Markdown content")).toBeEnabled();
});

test("draft storage failure does not accept an unprotected edit", async ({
  page,
}) => {
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage full");
    };
  });
  await page.getByLabel("Markdown content").fill("# Unprotected");
  await expect(page.getByRole("alert")).toContainText("could not be preserved");
  await expect(page.getByLabel("Markdown content")).toHaveValue("# Original\n");
});

test("reopening during a save preserves a newer draft", async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem("test:delay", "1200"));
  await page.getByLabel("Markdown content").fill("# In flight");
  await expect(page.getByRole("status")).toHaveText("Saving…");
  await page.getByLabel("Markdown content").fill("# Original\n");
  await page.getByRole("button", { name: "Reviews", exact: true }).click();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveValue("# Original\n");
  await expect(page.getByRole("status")).toHaveText("Saved", {
    timeout: 10000,
  });
  expect(await page.evaluate((key) => localStorage.getItem(key), diskKey)).toBe(
    "# Original\n",
  );
});

test("reverting before autosave clears the recovery draft", async ({
  page,
}) => {
  await page.getByLabel("Markdown content").fill("temporary");
  await page.getByLabel("Markdown content").fill("# Original\n");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toBeNull();
});

test("rename updates selection and later autosaves use the new filename", async ({
  page,
}) => {
  await page.getByLabel("Path within vault (including .md)").fill("renamed.md");
  await page
    .getByRole("button", { name: "Rename or move note", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "renamed.md", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "study.md", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Markdown content").fill("# After rename");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "renamed.md", exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveValue(
    "# After rename",
  );
});

test("unsaved drafts block renaming", async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem("test:fail", "yes"));
  await page.getByLabel("Path within vault (including .md)").fill("renamed.md");
  await page.getByLabel("Markdown content").fill("# Pending draft");
  await expect(
    page.getByRole("button", { name: "Rename or move note", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Save failed");
  await expect(
    page.getByRole("button", { name: "Rename or move note", exact: true }),
  ).toBeDisabled();
});

test("collisions and destination drafts prevent renaming without losing the note", async ({
  page,
}) => {
  await page
    .getByLabel("Path within vault (including .md)")
    .fill("occupied.md");
  await page
    .getByRole("button", { name: "Rename or move note", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("already exists");
  await page.evaluate(() =>
    localStorage.setItem(
      'notes:draft:["/test/vault","Recovery.md"]',
      JSON.stringify({ expected: "old", savedBody: "old", body: "draft" }),
    ),
  );
  await page
    .getByLabel("Path within vault (including .md)")
    .fill("recovery.md");
  await page
    .getByRole("button", { name: "Rename or move note", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("recovery drafts");
  await expect(
    page.getByRole("heading", { name: "study.md", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Markdown content")).toHaveValue("# Original\n");
});

test("moving into a folder updates listing, selection, and subsequent saves", async ({
  page,
}) => {
  const destination = "course/week1/study.md";
  await page.getByLabel("Path within vault (including .md)").fill(destination);
  await page
    .getByRole("button", { name: "Rename or move note", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: destination, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Markdown content").fill("# Nested edit");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await page
    .getByRole("button", { name: "Folder course", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Folder course/week1", exact: true })
    .click();
  await page.getByRole("button", { name: destination, exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveValue(
    "# Nested edit",
  );
});

test("a draft at the destination path blocks a move", async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'notes:draft:["/test/vault","folder/study.md"]',
      JSON.stringify({ expected: "old", savedBody: "old", body: "unsaved" }),
    ),
  );
  await page
    .getByLabel("Path within vault (including .md)")
    .fill("folder/study.md");
  await page
    .getByRole("button", { name: "Rename or move note", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("recovery drafts");
  await expect(
    page.getByRole("heading", { name: "study.md", exact: true }),
  ).toBeVisible();
});

test("creates empty folders, navigates a nested tree, and creates a note there", async ({
  page,
}) => {
  await page.getByLabel("New folder name").fill("Courses");
  await page
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  const courses = page.getByRole("button", {
    name: "Folder Courses",
    exact: true,
  });
  await expect(courses).toHaveAttribute("aria-expanded", "false");
  await courses.click();
  await page.getByLabel("New folder name").fill("Week1");
  await page
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  const week = page.getByRole("button", {
    name: "Folder Courses/Week1",
    exact: true,
  });
  await week.click();
  await page.getByLabel("New note title").fill("Lecture");
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Courses/Week1/new.md", exact: true }),
  ).toBeVisible();
  await courses.click();
  await expect(week).toBeHidden();
  await courses.click();
  await page
    .getByRole("button", { name: "Courses/Week1/new.md", exact: true })
    .click();
  await expect(page.getByLabel("Markdown content")).toHaveValue("# Lecture\n");
  await page.reload();
  await page
    .getByRole("button", { name: "Folder Courses", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Folder Courses/Week1", exact: true }),
  ).toBeVisible();
});

test("folder errors retain input and navigating the tree preserves recovery drafts", async ({
  page,
}) => {
  await page.getByLabel("New folder name").fill("Empty");
  await page
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  await page.getByLabel("New folder name").fill("Empty");
  await page
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("already exists");
  await expect(page.getByLabel("New folder name")).toHaveValue("Empty");
  await page.evaluate(() => sessionStorage.setItem("test:fail", "yes"));
  await page.getByLabel("Markdown content").fill("# Draft before navigation");
  await page.getByRole("button", { name: "Folder Empty", exact: true }).click();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveValue(
    "# Draft before navigation",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toContain("Draft before navigation");
});

test("tree exposes a recovery draft after its containing folder disappears", async ({
  page,
}) => {
  await page.evaluate(() => {
    sessionStorage.setItem("test:missing", "yes");
    localStorage.setItem(
      'notes:draft:["/test/vault","Missing/Sub/recover.md"]',
      JSON.stringify({
        expected: "# Original",
        savedBody: "# Original",
        body: "# Recover nested draft",
      }),
    );
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Folder Missing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Folder Missing/Sub", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Missing/Sub/recover.md", exact: true })
    .click();
  await expect(page.getByLabel("Markdown content")).toHaveValue(
    "# Recover nested draft",
  );
  await expect(
    page.getByText(
      "The disk file is unavailable. Showing its recovery draft so you can copy it.",
    ),
  ).toBeVisible();
});
