import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

import { EquationWidget } from "./equations";
import { ImageWidget, imageReference } from "./noteImages";

class BulletMarker extends WidgetType {
  toDOM() {
    const marker = document.createElement("span");
    marker.textContent = "•";
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
  ignoreEvent() {
    return false;
  }
}

function previewDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const activeLines = state.selection.ranges.map(({ from, to }) => ({
    from: state.doc.lineAt(from).from,
    to: state.doc.lineAt(to).to,
  }));
  const active = (from: number, to: number) =>
    activeLines.some((range) => from <= range.to && to >= range.from);
  const hide = (from: number, to: number) => {
    // Keep line breaks intact so cursor navigation and CodeMirror layout stay native.
    if (
      from < to &&
      state.doc.lineAt(from).number === state.doc.lineAt(to).number
    )
      decorations.push(Decoration.replace({}).range(from, to));
  };
  syntaxTree(state).iterate({
    enter(node) {
      const { from, to, name } = node;
      if (name === "InlineMath" || name === "DisplayMath") {
        if (!active(from, to))
          decorations.push(
            Decoration.replace({
              widget: new EquationWidget(
                state.sliceDoc(from, to),
                name === "DisplayMath",
                from,
              ),
              block: name === "DisplayMath",
            }).range(from, to),
          );
        return false;
      }
      if (name === "UnclosedMath") return false;
      if (name === "Image") {
        const source = state.sliceDoc(from, to);
        const reference = imageReference(source);
        if (reference && !active(from, to))
          decorations.push(
            Decoration.replace({
              widget: new ImageWidget(source, reference, from),
            }).range(from, to),
          );
        return false;
      }
      const parent = node.node.parent;
      const region = parent ?? node.node;
      const editing = active(region.from, region.to);
      if (/^(ATX|Setext)Heading[1-6]$/.test(name)) {
        decorations.push(
          Decoration.line({
            class: `preview-heading preview-h${name.at(-1)}`,
          }).range(state.doc.lineAt(from).from),
        );
      }
      if (name === "InlineCode") {
        decorations.push(
          Decoration.mark({ class: "preview-code" }).range(from, to),
        );
      }
      if (name === "FencedCode" || name === "CodeBlock") {
        for (
          let line = state.doc.lineAt(from).number;
          line <= state.doc.lineAt(to).number;
          line++
        ) {
          decorations.push(
            Decoration.line({ class: "preview-code-block" }).range(
              state.doc.line(line).from,
            ),
          );
        }
      }
      if (name === "Link") {
        // Decoration only: note-controlled URLs/HTML never become executable DOM.
        decorations.push(
          Decoration.mark({ class: "preview-link" }).range(from, to),
        );
        if (
          !active(from, to) &&
          state.doc.lineAt(from).number === state.doc.lineAt(to).number
        ) {
          const marks = node.node.getChildren("LinkMark");
          if (marks.length >= 2) {
            hide(marks[0].from, marks[0].to);
            hide(marks[1].from, to);
          }
        }
      }
      if (editing) return;
      if (name === "HeaderMark") {
        const space =
          state.sliceDoc(to, to + 1) === " " && from === region.from ? 1 : 0;
        hide(from, to + space);
      } else if (
        name === "EmphasisMark" ||
        name === "CodeMark" ||
        name === "CodeInfo"
      ) {
        hide(from, to);
      } else if (name === "ListMark" && parent?.parent?.name === "BulletList") {
        decorations.push(
          Decoration.replace({ widget: new BulletMarker() }).range(from, to),
        );
      }
    },
  });
  return Decoration.set(decorations, true);
}

// Direct state decorations can change line height while leaving the Markdown document intact.
export const liveMarkdownPreview = StateField.define<DecorationSet>({
  create: previewDecorations,
  update(value, transaction) {
    return transaction.docChanged ||
      transaction.selection ||
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? previewDecorations(transaction.state)
      : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
