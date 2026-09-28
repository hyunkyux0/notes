import { Facet } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";

export const imageContext = Facet.define<
  { vaultPath: string; filename: string },
  { vaultPath: string; filename: string } | undefined
>({ combine: (values) => values[0] });

// Only managed, note-relative attachments can request bytes from the backend.
export function imageReference(markdown: string): string | undefined {
  return /^!\[[^\]\n]*\]\((\.attachments\/[a-f\d-]{36}\.(?:png|jpg|gif|webp))\)$/.exec(
    markdown,
  )?.[1];
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly reference: string,
    readonly from: number,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return this.source === other.source && this.from === other.from;
  }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "note-image";
    button.textContent = "Loading image…";
    button.setAttribute("aria-label", "Edit image Markdown");
    button.onclick = () => {
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    };
    const context = view.state.facet(imageContext);
    if (context) {
      void invoke<string>("read_note_image", {
        ...context,
        reference: this.reference,
      })
        .then((data) => {
          if (!button.isConnected) return;
          const image = document.createElement("img");
          image.alt = "Local attachment";
          image.src = data;
          image.onload = () => view.requestMeasure();
          image.onerror = () => {
            button.textContent = this.source;
            view.requestMeasure();
          };
          button.replaceChildren(image);
          view.requestMeasure();
        })
        .catch(() => {
          if (!button.isConnected) return;
          button.textContent = this.source;
          button.title =
            "Image unavailable. Click to edit its Markdown reference.";
          view.requestMeasure();
        });
    } else button.textContent = this.source;
    return button;
  }
}

export async function importImage(
  file: File,
  context: { vaultPath: string; filename: string },
) {
  if (file.size > 8 * 1024 * 1024)
    throw new Error("Images must be at most 8 MiB.");
  // The backend validates bytes independently; MIME and original filenames are untrusted.
  return invoke<string>("import_note_image", {
    vaultPath: context.vaultPath,
    filename: context.filename,
    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
  });
}
