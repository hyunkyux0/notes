export type Draft = { expected: string; savedBody: string; body: string };

export const draftKey = (vaultPath: string, filename: string) =>
  `notes:draft:${JSON.stringify([vaultPath, filename])}`;

export function readDraft(key: string): Draft | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    !("expected" in value) ||
    typeof value.expected !== "string" ||
    !("savedBody" in value) ||
    typeof value.savedBody !== "string" ||
    !("body" in value) ||
    typeof value.body !== "string"
  ) {
    throw new Error("Invalid recovery draft");
  }
  return {
    expected: value.expected,
    savedBody: value.savedBody,
    body: value.body,
  };
}

export function draftFilenames(vaultPath: string): string[] {
  const filenames: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("notes:draft:")) continue;
    try {
      const parts: unknown = JSON.parse(key.slice("notes:draft:".length));
      if (
        Array.isArray(parts) &&
        parts.length === 2 &&
        parts[0] === vaultPath &&
        typeof parts[1] === "string"
      ) {
        filenames.push(parts[1]);
      }
    } catch {
      /* Unrecognized keys are not note drafts. */
    }
  }
  return filenames;
}
