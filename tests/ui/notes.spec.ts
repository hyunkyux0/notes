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
          case "import_note_image":
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                Number(sessionStorage.getItem("test:image-delay")),
              ),
            );
            if (sessionStorage.getItem("test:image-fail"))
              throw "Invalid image";
            return ".attachments/12345678-1234-4234-8234-123456789abc.png";
          case "read_note_image":
            sessionStorage.setItem(
              "test:image-reads",
              String(Number(sessionStorage.getItem("test:image-reads")) + 1),
            );
            if (sessionStorage.getItem("test:image-missing"))
              throw "Image missing";
            return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
          case "acquire_note":
            return !sessionStorage.getItem("test:note-owned");
          case "release_note":
            return null;
          case "new_window":
            sessionStorage.setItem("test:new-window", "yes");
            return null;
          case "get_vault":
            return sessionStorage.getItem("test:no-vault")
              ? null
              : { path: "/test/vault" };
          case "choose_vault":
            if (sessionStorage.getItem("test:vault-error"))
              throw "Vault unavailable";
            return sessionStorage.getItem("test:choose-vault")
              ? { path: sessionStorage.getItem("test:choose-vault") }
              : null;
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
  await expect(page.getByLabel("Markdown content")).toHaveText("# Recover me");
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
  await expect(page.getByLabel("Markdown content")).toHaveText("# My draft");
  await page.getByRole("button", { name: "Reload disk version" }).click();
  await page.getByRole("button", { name: "Discard draft and reload" }).click();
  await expect(page.getByLabel("Markdown content")).toHaveText(
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
  await expect(page.getByLabel("Markdown content")).toHaveText("# Retained");
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
  await expect(page.getByLabel("Markdown content")).toHaveText(
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
  await expect(page.getByLabel("Markdown content")).toHaveText("# Original\n");
});

test("reopening during a save preserves a newer draft", async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem("test:delay", "1200"));
  await page.getByLabel("Markdown content").fill("# In flight");
  await expect(page.getByRole("status")).toHaveText("Saving…");
  await page.getByLabel("Markdown content").fill("# Original\n");
  await page.getByRole("button", { name: "Reviews", exact: true }).click();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveText("# Original\n");
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
  await expect(page.getByLabel("Markdown content")).toHaveText(
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
  await expect(page.getByLabel("Markdown content")).toHaveText("# Original\n");
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
    .getByRole("button", { name: "Expand folder course", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Expand folder course/week1", exact: true })
    .click();
  await page.getByRole("button", { name: destination, exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveText("# Nested edit");
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
  await page.getByText("New folder", { exact: true }).click();
  await page.getByLabel("New folder name").fill("Courses");
  await page
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  const courses = page.getByRole("button", {
    name: "Folder Courses",
    exact: true,
  });
  const expandCourses = page.getByRole("button", {
    name: "Expand folder Courses",
    exact: true,
  });
  await expect(expandCourses).toHaveAttribute("aria-expanded", "false");
  await courses.click();
  await expect(expandCourses).toHaveAttribute("aria-expanded", "false");
  await page.getByLabel("New folder name").fill("Week1");
  await page
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  const week = page.getByRole("button", {
    name: "Folder Courses/Week1",
    exact: true,
  });
  await week.click();
  await page.getByText("New note", { exact: true }).click();
  await page.getByLabel("New note title").fill("Lecture");
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Courses/Week1/new.md", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Collapse folder Courses", exact: true })
    .click();
  await expect(week).toBeHidden();
  await expandCourses.click();
  await page
    .getByRole("button", { name: "Courses/Week1/new.md", exact: true })
    .click();
  await expect(page.getByLabel("Markdown content")).toHaveText("# Lecture\n");
  await page.reload();
  await page
    .getByRole("button", { name: "Expand folder Courses", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Folder Courses/Week1", exact: true }),
  ).toBeVisible();
});

test("folder errors retain input and navigating the tree preserves recovery drafts", async ({
  page,
}) => {
  await page.getByText("New folder", { exact: true }).click();
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
  await expect(page.getByLabel("Markdown content")).toHaveText(
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
    .getByRole("button", { name: "Expand folder Missing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Expand folder Missing/Sub", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Missing/Sub/recover.md", exact: true })
    .click();
  await expect(page.getByLabel("Markdown content")).toHaveText(
    "# Recover nested draft",
  );
  await expect(
    page.getByText(
      "The disk file is unavailable. Showing its recovery draft so you can copy it.",
    ),
  ).toBeVisible();
});

test("sidebar layout resizes and collapses without losing the editor", async ({
  page,
}) => {
  const sidebar = page.getByRole("complementary", { name: "Vault sidebar" });
  const editor = page.getByRole("article", { name: "Note editor" });
  await expect(
    sidebar.getByRole("button", { name: "study.md", exact: true }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "Switch vault: vault" }),
  ).toBeVisible();
  const initial = await sidebar.boundingBox();
  const editorBox = await editor.boundingBox();
  if (!initial || !editorBox)
    throw new Error("Workspace panes are not visible");
  expect(editorBox.x).toBeGreaterThanOrEqual(initial.x + initial.width);
  const resize = page.getByRole("button", { name: "Resize sidebar" });
  await resize.focus();
  await page.keyboard.press("ArrowRight");
  await expect(sidebar).toHaveCSS("width", "300px");
  const handle = await resize.boundingBox();
  if (!handle) throw new Error("Sidebar resize control is not visible");
  await page.mouse.move(handle.x + 3, handle.y + 80);
  await page.mouse.down();
  await page.mouse.move(350, 80);
  await page.mouse.up();
  await expect(sidebar).toHaveCSS("width", "350px");
  await page.getByLabel("Markdown content").fill("# Layout draft");
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(sidebar).toBeHidden();
  await expect(page.getByLabel("Markdown content")).toHaveText(
    "# Layout draft",
  );
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "350px");
  await page.setViewportSize({ width: 600, height: 600 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    600,
  );
});

test("settings and cancelled or failed vault switches preserve the open draft", async ({
  page,
}) => {
  await page.evaluate(() => sessionStorage.setItem("test:delay", "1000"));
  await page.getByLabel("Markdown content").fill("# Continue saving");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Markdown content")).toBeHidden();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), diskKey))
    .toBe("# Continue saving");
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveText(
    "# Continue saving",
  );
  await page.getByRole("button", { name: "Switch vault: vault" }).click();
  await expect(page.getByLabel("Markdown content")).toHaveText(
    "# Continue saving",
  );
  await page.evaluate(() => sessionStorage.setItem("test:vault-error", "yes"));
  await page.getByRole("button", { name: "Switch vault: vault" }).click();
  await expect(page.getByRole("alert")).toContainText("Vault unavailable");
  await expect(page.getByLabel("Markdown content")).toHaveText(
    "# Continue saving",
  );
});

test("no selected vault exposes Open vault in the sidebar", async ({
  page,
}) => {
  await page.evaluate(() => sessionStorage.setItem("test:no-vault", "yes"));
  await page.reload();
  await expect(
    page
      .getByRole("complementary")
      .getByRole("button", { name: "Open vault", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Open a vault from the sidebar to start writing."),
  ).toBeVisible();
});

test("switching vaults isolates drafts and returning restores them", async ({
  page,
}) => {
  await page.evaluate(() => sessionStorage.setItem("test:fail", "yes"));
  await page.getByLabel("Markdown content").fill("# First vault draft");
  await page.evaluate(() =>
    sessionStorage.setItem("test:choose-vault", "/test/other"),
  );
  await page.getByRole("button", { name: "Switch vault: vault" }).click();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveText("# Original\n");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toContain("First vault draft");
  await page.evaluate(() =>
    sessionStorage.setItem("test:choose-vault", "/test/vault"),
  );
  await page.getByRole("button", { name: "Switch vault: other" }).click();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.getByLabel("Markdown content")).toHaveText(
    "# First vault draft",
  );
});

test("Markdown highlighting and list editing preserve exact saved source", async ({
  page,
}) => {
  const editor = page.getByLabel("Markdown content");
  const source = "# Heading\n\n**Bold** and *italic*\n\n- first";
  await editor.fill(source);
  await expect(
    editor.locator("span").filter({ hasText: "Bold" }).last(),
  ).toHaveCSS("font-weight", "700");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), diskKey))
    .toBe(source);
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await page.keyboard.type("second");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), diskKey))
    .toBe(`${source}\n- second`);
});

test("undo and redo survive autosave; disk reload clears previous history", async ({
  page,
}) => {
  const editor = page.getByLabel("Markdown content");
  await editor.fill("# Start");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await editor.press("End");
  await page.keyboard.type(" changed");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText("# Start");
  await editor.press("ControlOrMeta+Shift+z");
  await expect(editor).toHaveText("# Start changed");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.evaluate(
    (key) => localStorage.setItem(key, "# External"),
    diskKey,
  );
  await page.getByRole("button", { name: "Reload disk version" }).click();
  await expect(editor).toHaveText("# External");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText("# External");
});

test("editor styles use the provided nonce under a restrictive style policy", async ({
  page,
}) => {
  await page.route(page.url(), async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace(
        '<style id="editor-style-nonce">',
        '<style id="editor-style-nonce" nonce="test-editor-nonce">',
      )
      .replace(
        "<head>",
        '<head><meta property="csp-nonce" nonce="test-editor-nonce">',
      );
    await route.fulfill({
      response,
      body: html,
      headers: {
        ...response.headers(),
        "Content-Security-Policy":
          "style-src 'self' 'nonce-test-editor-nonce'; img-src 'self' data:",
      },
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  const editor = page.getByLabel("Markdown content");
  await editor.fill("**Bold**");
  await expect(
    editor.locator("span").filter({ hasText: "Bold" }).last(),
  ).toHaveCSS("font-weight", "700");
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll("style")].some(
        (style) =>
          style.nonce === "test-editor-nonce" &&
          [...(style.sheet?.cssRules ?? [])].some((rule) =>
            rule.cssText.includes(".cm-editor"),
          ),
      ),
    ),
  ).toBe(true);
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.evaluate(() => {
    const violations: string[] = [];
    document.documentElement.dataset.equationPolicyViolations = "[]";
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(
        `${event.effectiveDirective}: ${event.blockedURI} at ${event.sourceFile}:${event.lineNumber}`,
      );
      document.documentElement.dataset.equationPolicyViolations =
        JSON.stringify(violations);
    });
  });
  await page.evaluate(() =>
    localStorage.setItem(
      "test:disk",
      "Intro\n\n$\\frac{a}{b}$\n\n![Image](.attachments/12345678-1234-4234-8234-123456789abc.png)\n\nend",
    ),
  );
  await page.getByRole("button", { name: "Refresh notes" }).click();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.locator(".equation-preview .mfrac")).toBeVisible();
  await expect(page.locator(".note-image img")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.dataset.equationPolicyViolations,
    ),
  ).toBe("[]");
});

test("live preview formats inactive Markdown and reveals the line being edited", async ({
  page,
}) => {
  const source =
    'Intro\n\n# Heading\n\n**bold** and *italic* and `code`\n\n- item\n\n[label](javascript:alert(1) "title")\n\n```js\nconst x = 1\n```\n\n<img src=x onerror=alert(1)>\n\nend';
  await page.evaluate(
    (source) => localStorage.setItem("test:disk", source),
    source,
  );
  await page.reload();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  const editor = page.getByLabel("Markdown content");
  await expect(
    page.getByRole("button", { name: "Source mode" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(editor.locator(".preview-h1")).toHaveText("Heading");
  await expect(editor).toContainText("bold and italic and code");
  await expect(editor).toContainText("• item");
  await expect(editor).not.toContainText("javascript:");
  await expect(editor).not.toContainText("```");
  await expect(
    editor.locator(".preview-code-block").filter({ hasText: "const" }),
  ).toBeVisible();
  await expect(
    editor.locator("img:not(.cm-widgetBuffer), a[href], script"),
  ).toHaveCount(0);
  await editor.getByText("bold", { exact: true }).click();
  await expect(editor).toContainText("**bold** and *italic* and `code`");
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(await page.evaluate((key) => localStorage.getItem(key), diskKey)).toBe(
    source,
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toBeNull();
});

test("mode switches preserve selection, undo history, and unsaved drafts", async ({
  page,
}) => {
  const editor = page.getByLabel("Markdown content");
  await editor.fill("# Title\n\n**bold**\n\nend");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.evaluate(() => sessionStorage.setItem("test:fail", "yes"));
  await editor.press("ControlOrMeta+End");
  await page.keyboard.type("!");
  await expect(page.getByRole("alert")).toContainText("Save failed");
  const draft = await page.evaluate(
    (key) => localStorage.getItem(key),
    draftKey,
  );
  const toggle = page.getByRole("button", { name: "Source mode" });
  await toggle.click();
  await expect(editor).toContainText("**bold**");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toBe(draft);
  await toggle.click();
  await expect(editor).not.toContainText("**bold**");
  await editor.focus();
  await page.keyboard.type("?");
  await page.evaluate(() => sessionStorage.removeItem("test:fail"));
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), diskKey))
    .toBe("# Title\n\n**bold**\n\nend!?");
  await editor.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("?");
  await editor.press("ControlOrMeta+Shift+z");
  await expect(editor).toContainText("end!?");
});

test("reference links, multiline syntax, and images retain their Markdown source", async ({
  page,
}) => {
  const source =
    "Intro\n\n[one][ref] and [short]\n\n[ref]: https://example.com\n\n![alt](image.png)\n\n**multiple\nlines**\n\nend";
  await page.evaluate(
    (source) => localStorage.setItem("test:disk", source),
    source,
  );
  await page.reload();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  const editor = page.getByLabel("Markdown content");
  await expect(editor).toContainText("one and short");
  await expect(editor).toContainText("![alt](image.png)");
  await page.getByRole("button", { name: "Source mode" }).click();
  await expect(editor).toContainText("[one][ref] and [short]");
  expect(await page.evaluate((key) => localStorage.getItem(key), diskKey)).toBe(
    source,
  );
});

test("inline and display equations render, reveal source, and save exact LaTeX", async ({
  page,
}) => {
  const source = String.raw`Intro

Energy $E=mc^2$.

$$
\frac{a}{b} = \sqrt{x}
$$

end`;
  await page.evaluate(
    (source) => localStorage.setItem("test:disk", source),
    source,
  );
  await page.reload();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.locator(".equation-preview .katex")).toHaveCount(2);
  await expect(page.locator(".equation-display .katex-display")).toBeVisible();
  await page.getByRole("button", { name: "Edit equation" }).first().click();
  await expect(page.getByLabel("Markdown content")).toContainText("$E=mc^2$");
  await expect(page.locator(".equation-preview .katex")).toHaveCount(1);
  await page.getByRole("button", { name: "Source mode" }).click();
  await expect(page.locator(".katex")).toHaveCount(0);
  const edited = source.replace("mc^2", "mc^3");
  await page.getByLabel("Markdown content").fill(edited);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), diskKey))
    .toBe(edited);
  await page.getByRole("button", { name: "Source mode" }).click();
  await expect(page.locator(".equation-preview .katex")).toHaveCount(2);
  await page.locator(".equation-display").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Markdown content")).toContainText(
    String.raw`\frac{a}{b}`,
  );
  await expect(page.locator(".equation-display")).toHaveCount(0);
});

test("invalid and untrusted equations preserve source without active HTML or URLs", async ({
  page,
}) => {
  const source = String.raw`Intro

$\frac{1}{$

$\href{javascript:alert(1)}{click}$

$\includegraphics{https://example.com/tracker.png}$

$\def\loop{\loop}\loop$

end`;
  await page.evaluate(
    (source) => localStorage.setItem("test:disk", source),
    source,
  );
  await page.reload();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.locator(".equation-error")).toHaveCount(2);
  await expect(
    page.locator(
      ".equation-preview a, .equation-preview img, .equation-preview script",
    ),
  ).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), diskKey)).toBe(
    source,
  );
  await page.locator(".equation-error").first().click();
  await expect(page.getByLabel("Markdown content")).toContainText(
    String.raw`$\frac{1}{$`,
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toBeNull();
});

test("code, escaped dollars, currency, and unmatched math stay literal", async ({
  page,
}) => {
  const document = [
    "Intro",
    String.raw`\$literal\$ and $5 and $10`,
    "`$x$`",
    "```\n$$\nx\n$$\n```",
    "> $$x$$",
    "- $$x$$",
    "$$\nunclosed",
  ].join("\n\n");
  await page.evaluate(
    (source) => localStorage.setItem("test:disk", source),
    document,
  );
  await page.reload();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await expect(page.locator(".equation-preview")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), diskKey)).toBe(
    document,
  );
});

async function transferImage(
  page: import("@playwright/test").Page,
  action: "paste" | "drop",
) {
  await page.getByLabel("Markdown content").evaluate((element, action) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "picture.png", {
        type: "image/png",
      }),
    );
    element.dispatchEvent(
      action === "paste"
        ? new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          })
        : new DragEvent("drop", {
            dataTransfer: data,
            bubbles: true,
            cancelable: true,
          }),
    );
  }, action);
}

const imageMarkdown =
  "![Image](.attachments/12345678-1234-4234-8234-123456789abc.png)";

test("pasted image keeps Markdown, undo history, preview and autosave", async ({
  page,
}) => {
  const editor = page.getByLabel("Markdown content");
  await editor.fill("Before\n\n");
  await editor.press("ControlOrMeta+End");
  await transferImage(page, "paste");
  await expect(editor).toContainText(imageMarkdown);
  await editor.press("ControlOrMeta+z");
  await expect(editor).not.toContainText(imageMarkdown);
  await expect(editor).toContainText("Before");
  await editor.press("ControlOrMeta+Shift+z");
  await expect(editor).toContainText(imageMarkdown);
  await editor.press("ControlOrMeta+Home");
  await expect(page.locator(".note-image img")).toBeVisible();
  await page.getByRole("button", { name: "Source mode" }).click();
  await expect(page.locator(".note-image")).toHaveCount(0);
  await expect(editor).toContainText(imageMarkdown);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("test:disk")))
    .toBe(`Before\n\n${imageMarkdown}`);
  await page.getByRole("button", { name: "Source mode" }).click();
  await page.getByRole("button", { name: "Edit image Markdown" }).click();
  await expect(editor).toContainText(imageMarkdown);
});

test("dropped image retains a draft on save conflict; invalid import leaves text intact", async ({
  page,
}) => {
  await page.evaluate(() => sessionStorage.setItem("test:image-fail", "yes"));
  await transferImage(page, "drop");
  await expect(page.getByRole("alert")).toContainText("Invalid image");
  await expect(page.getByLabel("Markdown content")).toContainText("Original");
  await page.evaluate(() => {
    sessionStorage.removeItem("test:image-fail");
    localStorage.setItem("test:disk", "External version");
  });
  await transferImage(page, "drop");
  await expect(page.getByRole("alert")).toContainText("Conflict");
  expect(await page.evaluate(() => localStorage.getItem("test:disk"))).toBe(
    "External version",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toContain(imageMarkdown);
});

test("image imports cannot land in a different note after navigation", async ({
  page,
}) => {
  await page.evaluate(() => sessionStorage.setItem("test:image-delay", "800"));
  await transferImage(page, "paste");
  await expect(
    page.getByRole("button", { name: "Reload disk version" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Refresh notes" }).click();
  await page.getByRole("button", { name: "study.md", exact: true }).click();
  await page.waitForTimeout(1000);
  await expect(page.getByLabel("Markdown content")).not.toContainText(
    imageMarkdown,
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toBeNull();
});

test("remote, SVG, HTML and path-escape image references remain inert", async ({
  page,
}) => {
  const editor = page.getByLabel("Markdown content");
  await editor.fill(
    "Active\n\n![remote](https://example.org/a.png)\n![svg](.attachments/test.svg)\n![escape](../outside.png)\n<img src='https://example.org/a.png'>",
  );
  await editor.press("ControlOrMeta+Home");
  await expect(page.locator(".markdown-editor img")).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("test:image-reads")),
  ).toBeNull();
});

test("missing attachment exposes editable source without losing text", async ({
  page,
}) => {
  await page.evaluate(() =>
    sessionStorage.setItem("test:image-missing", "yes"),
  );
  const editor = page.getByLabel("Markdown content");
  await editor.fill(`Active\n\n${imageMarkdown}`);
  await editor.press("ControlOrMeta+Home");
  await expect(
    page.getByRole("button", { name: "Edit image Markdown" }),
  ).toHaveText(imageMarkdown);
  await page.getByRole("button", { name: "Edit image Markdown" }).click();
  await expect(editor).toContainText(imageMarkdown);
});

test("file drops outside the editor cannot navigate the app", async ({
  page,
}) => {
  expect(
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["<html>untrusted</html>"], "page.html", {
          type: "text/html",
        }),
      );
      const event = new DragEvent("drop", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await expect(page.getByLabel("Markdown content")).toContainText("Original");
});

test("image drops on the editor's empty area are imported", async ({
  page,
}) => {
  await page.locator(".markdown-editor").evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = box.left + 30;
    const y = box.bottom - 20;
    const target = document.elementFromPoint(x, y);
    if (!target) throw new Error("Missing drop target");
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", {
        type: "image/png",
      }),
    );
    target.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: transfer,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByLabel("Markdown content")).toContainText(
    imageMarkdown,
  );
});

for (const destination of ["Before", "After"]) {
  test(`dragging a preview image to ${destination} moves its reference once`, async ({
    page,
  }) => {
    const editor = page.getByLabel("Markdown content");
    const original = `Before\n\n${imageMarkdown}\n\nAfter`;
    await editor.fill(original);
    await editor.press("ControlOrMeta+Home");
    await expect(page.locator(".note-image img")).toBeVisible();
    // A move must not call attachment import again.
    await page.evaluate(() => sessionStorage.setItem("test:image-fail", "yes"));
    const target = page
      .locator(".cm-line")
      .filter({ hasText: new RegExp(`^${destination}$`) });
    await page
      .locator(".note-image")
      .dragTo(target, { targetPosition: { x: 1, y: 8 } });
    const moved =
      destination === "Before"
        ? `${imageMarkdown}Before\n\n\n\nAfter`
        : `Before\n\n\n\n${imageMarkdown}After`;
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("test:disk")))
      .toBe(moved);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await editor.press("ControlOrMeta+z");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("test:disk")))
      .toBe(original);
    await editor.press("ControlOrMeta+Shift+z");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("test:disk")))
      .toBe(moved);
  });
}

test("an edit during an image drag prevents deleting stale source positions", async ({
  page,
}) => {
  const editor = page.getByLabel("Markdown content");
  await editor.fill(`Before\n\n${imageMarkdown}\n\nAfter`);
  await editor.press("ControlOrMeta+Home");
  await expect(page.locator(".note-image img")).toBeVisible();
  await page.locator(".note-image").evaluate((image) => {
    image.dispatchEvent(
      new DragEvent("dragstart", {
        dataTransfer: new DataTransfer(),
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await editor.fill("New content must survive");
  await editor.evaluate((element) => {
    element.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: new DataTransfer(),
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByRole("alert")).toContainText(
    "The note changed during the drag",
  );
  await expect(editor).toHaveText("New content must survive");
});
