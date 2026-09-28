import { type EditorView, WidgetType } from "@codemirror/view";
import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";
import katex from "katex";
import "katex/dist/katex.min.css";

function startsDisplayMath(cx: BlockContext, line: Line) {
  const text = line.text.trim();
  return (
    cx.parentType().name === "Document" &&
    line.indent < 4 &&
    (text === "$$" ||
      (text.length > 4 && text.startsWith("$$") && text.endsWith("$$")))
  );
}

// Parsing math as Markdown nodes prevents emphasis/link parsing inside LaTeX and
// naturally excludes fenced/inline code, escaped dollars, and link destinations.
export const equationSyntax: MarkdownConfig = {
  defineNodes: [
    "InlineMath",
    { name: "DisplayMath", block: true },
    { name: "UnclosedMath", block: true },
  ],
  parseInline: [
    {
      name: "InlineMath",
      parse(cx, next, pos) {
        if (
          next !== 36 ||
          cx.char(pos - 1) === 36 ||
          cx.char(pos + 1) === 36 ||
          /\s/.test(cx.slice(pos + 1, pos + 2))
        )
          return -1;
        for (let end = pos + 1; end < cx.end; end++) {
          if (cx.char(end) === 10) return -1;
          if (cx.char(end) === 92) {
            end++;
            continue;
          }
          if (cx.char(end) === 36) {
            if (
              /\s/.test(cx.slice(end - 1, end)) ||
              /[\d$]/.test(cx.slice(end + 1, end + 2))
            )
              return -1;
            return cx.addElement(cx.elt("InlineMath", pos, end + 1));
          }
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: "DisplayMath",
      after: "FencedCode",
      parse(cx, line) {
        // Display delimiters occupy root-level lines; nested quotes/lists stay source.
        if (!startsDisplayMath(cx, line)) return false;
        const from = cx.lineStart;
        let to = from + line.text.length;
        let closed =
          line.text.trim().length > 4 && line.text.trim().endsWith("$$");
        if (!closed && line.text.trim() !== "$$") return false;
        while (!closed && cx.nextLine()) {
          to = cx.lineStart + line.text.length;
          closed = line.text.trim() === "$$";
        }
        cx.addElement(
          cx.elt(closed ? "DisplayMath" : "UnclosedMath", from, to),
        );
        if (closed) cx.nextLine();
        return true;
      },
      endLeaf: startsDisplayMath,
    },
  ],
};

export class EquationWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean,
    readonly from: number,
  ) {
    super();
  }
  eq(other: EquationWidget) {
    return (
      this.source === other.source &&
      this.display === other.display &&
      this.from === other.from
    );
  }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = this.display
      ? "equation-preview equation-display"
      : "equation-preview";
    button.setAttribute("aria-label", "Edit equation");
    button.title = "Click to edit LaTeX";
    const width = this.display ? 2 : 1;
    const latex = this.source.trim().slice(width, -width);
    try {
      if (latex.length > 4096) throw new Error("Equation too long");
      // DOM rendering avoids raw HTML insertion; each equation gets fresh macro state.
      katex.render(latex, button, {
        displayMode: this.display,
        trust: false,
        throwOnError: true,
        strict: "error",
        maxExpand: 500,
        maxSize: 20,
        macros: {},
      });
    } catch {
      button.textContent = this.source;
      button.classList.add("equation-error");
      button.title = "Cannot preview this equation. Click to edit its source.";
    }
    button.onmousedown = (event) => event.preventDefault();
    button.onclick = () => {
      view.dispatch({
        selection: { anchor: this.from + width },
        scrollIntoView: true,
      });
      view.focus();
    };
    return button;
  }
}
