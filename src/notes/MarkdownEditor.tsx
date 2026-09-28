import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useLayoutEffect, useRef, useState } from "react";

import { liveMarkdownPreview } from "./liveMarkdownPreview";

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
  disabled: boolean;
  // Persistence must accept the text before it enters the editor's state/history.
  onEdit: (value: string) => boolean;
};

export function MarkdownEditor({ value, disabled, onEdit }: Props) {
  const [sourceMode, setSourceMode] = useState(false);
  const preview = useRef(new Compartment());
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const props = useRef({ value, disabled, onEdit });
  const editing = useRef(new Compartment());
  const extensions = useRef<Extension[]>([]);

  useLayoutEffect(() => {
    props.current = { value, disabled, onEdit };
  });

  useLayoutEffect(() => {
    if (!host.current) return;
    extensions.current = [
      markdown(),
      preview.current.of(liveMarkdownPreview),
      syntaxHighlighting(markdownHighlighting),
      history(),
      keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      // Tauri gives this marker a fresh style nonce in production. Dev has no CSP.
      EditorView.cspNonce.of(
        document.querySelector<HTMLStyleElement>("#editor-style-nonce")
          ?.nonce ?? "",
      ),
      editing.current.of([]),
    ];
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
    </>
  );
}
