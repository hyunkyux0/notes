import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
} from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useLayoutEffect, useRef, useState } from "react";

import { equationSyntax } from "./equations";
import { liveMarkdownPreview } from "./liveMarkdownPreview";
import { imageContext, importImage } from "./noteImages";

const markdownHighlighting = HighlightStyle.define([
  { tag: tags.heading, color: "var(--syntax)", fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "var(--syntax)", textDecoration: "underline" },
  { tag: tags.monospace, color: "var(--syntax-code)" },
  { tag: tags.processingInstruction, color: "var(--muted)" },
]);

type Props = {
  value: string;
  vaultPath: string;
  filename: string;
  onImportBusy: (busy: boolean) => void;
  disabled: boolean;
  // Persistence must accept the text before it enters the editor's state/history.
  onEdit: (value: string) => boolean;
};

export function MarkdownEditor({
  value,
  disabled,
  onEdit,
  vaultPath,
  filename,
  onImportBusy,
}: Props) {
  const [imageError, setImageError] = useState<string | null>(null);
  const importing = useRef(false);
  const [sourceMode, setSourceMode] = useState(false);
  const preview = useRef(new Compartment());
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const props = useRef({
    value,
    disabled,
    onEdit,
    vaultPath,
    filename,
    onImportBusy,
  });
  const editing = useRef(new Compartment());
  const extensions = useRef<Extension[]>([]);

  useLayoutEffect(() => {
    props.current = {
      value,
      disabled,
      onEdit,
      vaultPath,
      filename,
      onImportBusy,
    };
  });

  useLayoutEffect(() => {
    if (!host.current) return;
    extensions.current = [
      imageContext.of({
        vaultPath: props.current.vaultPath,
        filename: props.current.filename,
      }),
      markdown({ extensions: [equationSyntax] }),
      preview.current.of(liveMarkdownPreview),
      syntaxHighlighting(markdownHighlighting),
      history(),
      keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.domEventHandlers({
        paste(event, editor) {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!files.length) return false;
          event.preventDefault();
          void attach(
            files,
            editor,
            editor.state.selection.main.from,
            editor.state.selection.main.to,
          );
          return true;
        },
        dragover(event) {
          if (!event.dataTransfer?.types.includes("Files")) return false;
          event.preventDefault();
          return true;
        },
        drop(event, editor) {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (!files.length) return false;
          event.preventDefault();
          const position =
            editor.posAtCoords({ x: event.clientX, y: event.clientY }) ??
            editor.state.selection.main.from;
          void attach(files, editor, position);
          return true;
        },
      }),
      // Tauri gives this marker a fresh style nonce in production. Dev has no CSP.
      EditorView.cspNonce.of(
        document.querySelector<HTMLStyleElement>("#editor-style-nonce")
          ?.nonce ?? "",
      ),
      editing.current.of([]),
    ];
    async function attach(
      files: File[],
      editor: EditorView,
      position: number,
      end = position,
    ) {
      if (props.current.disabled || importing.current) return;
      if (files.length !== 1) {
        setImageError("Attach one image at a time.");
        return;
      }
      importing.current = true;
      props.current.onImportBusy(true);
      setImageError(null);
      const original = editor.state.doc;
      try {
        const reference = await importImage(files[0], props.current);
        if (view.current !== editor) return;
        if (!editor.state.doc.eq(original)) {
          throw new Error(
            "The note changed during import. The image is stored in .attachments; drop or paste again to insert it.",
          );
        }
        const markdown = `![Image](${reference})`;
        editor.dispatch({
          changes: { from: position, to: end, insert: markdown },
          selection: { anchor: position + markdown.length },
          annotations: isolateHistory.of("full"),
        });
      } catch (error) {
        if (view.current === editor) setImageError(String(error));
      } finally {
        importing.current = false;
        if (view.current === editor) props.current.onImportBusy(false);
      }
    }
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.current.value,
        extensions: extensions.current,
      }),
      dispatchTransactions(transactions, editor) {
        const next = transactions.at(-1)?.state;
        if (
          next &&
          !next.doc.eq(editor.state.doc) &&
          !props.current.onEdit(next.doc.toString())
        ) {
          // Restore the DOM after rejected input without admitting it to undo history.
          editor.setState(editor.state);
          return;
        }
        editor.update(transactions);
      },
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    if (editor.state.doc.toString() !== value) {
      // Disk reload/recovery replaces the document and clears stale undo history.
      // Ordinary typing and save acknowledgements keep the existing state/selection.
      editor.setState(
        EditorState.create({ doc: value, extensions: extensions.current }),
      );
    }
    editor.dispatch({
      effects: [
        preview.current.reconfigure(sourceMode ? [] : liveMarkdownPreview),
        editing.current.reconfigure([
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
          EditorView.contentAttributes.of({
            "aria-label": "Markdown content",
            "aria-multiline": "true",
            "aria-disabled": String(disabled),
            spellcheck: "false",
          }),
        ]),
      ],
    });
  }, [value, disabled, sourceMode]);

  return (
    <>
      <button
        type="button"
        aria-pressed={sourceMode}
        onClick={() => setSourceMode(!sourceMode)}
      >
        Source mode
      </button>
      <div className="markdown-editor" ref={host} />
      {imageError && <p role="alert">{imageError}</p>}
    </>
  );
}
