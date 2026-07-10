/** Caret utilities for the per-node contenteditable elements. */

export type CaretPosition = "start" | "end" | number;

export function placeCaret(el: HTMLElement, position: CaretPosition): void {
  el.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();

  if (typeof position === "number") {
    let remaining = position;
    let placed = false;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current !== null) {
      const text = current as Text;
      if (remaining <= text.length) {
        range.setStart(text, remaining);
        range.collapse(true);
        placed = true;
        break;
      }
      remaining -= text.length;
      current = walker.nextNode();
    }
    if (!placed) {
      range.selectNodeContents(el);
      range.collapse(false);
    }
  } else {
    range.selectNodeContents(el);
    range.collapse(position === "start");
  }

  selection.removeAllRanges();
  selection.addRange(range);
}

/** Character offset of the caret within `el`'s text. */
export function caretOffset(el: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.endContainer)) return 0;
  const probe = range.cloneRange();
  probe.selectNodeContents(el);
  probe.setEnd(range.endContainer, range.endOffset);
  return probe.toString().length;
}

function caretRect(el: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !el.contains(range.endContainer)) return null;
  const rect = range.cloneRange().getClientRects()[0];
  if (rect !== undefined && rect.height > 0) return rect;
  // Collapsed-range rects are unreliable; probe with a one-character range.
  if (range.endContainer.nodeType !== Node.TEXT_NODE) return null;
  const text = range.endContainer as Text;
  const probe = range.cloneRange();
  if (range.endOffset < text.length) {
    probe.setEnd(text, range.endOffset + 1);
    const r = probe.getBoundingClientRect();
    return r.height > 0 ? new DOMRect(r.left, r.top, 0, r.height) : null;
  }
  if (range.endOffset > 0) {
    probe.setStart(text, range.endOffset - 1);
    const r = probe.getBoundingClientRect();
    return r.height > 0 ? new DOMRect(r.right, r.top, 0, r.height) : null;
  }
  return null;
}

/** Screen x of the caret, for goal-column vertical navigation. */
export function caretScreenX(el: HTMLElement): number {
  return caretRect(el)?.left ?? el.getBoundingClientRect().left;
}

/**
 * Place the caret on the first/last rendered line of `el`, as close as
 * possible to screen column `x` (clamped to the line). Falls back to
 * start/end when hit-testing is unavailable.
 */
export function placeCaretAtX(el: HTMLElement, x: number, line: "first" | "last"): void {
  el.focus();
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  let lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight)) lineHeight = Number.parseFloat(style.fontSize) * 1.5 || 22;
  const y =
    line === "first"
      ? Math.min(rect.top + lineHeight / 2, rect.bottom - 1)
      : Math.max(rect.bottom - lineHeight / 2, rect.top + 1);
  const clampedX = Math.min(Math.max(x, rect.left + 1), rect.right - 1);

  const hit = caretHit(clampedX, y, el);
  if (!hit) {
    placeCaret(el, line === "first" ? "start" : "end");
    return;
  }
  selectAt(hit.node, hit.offset);
}

/** Place the caret at the text position nearest a screen point inside `el`. */
export function placeCaretAtPoint(el: HTMLElement, x: number, y: number): void {
  el.focus();
  const hit = caretHit(x, y, el);
  if (!hit) {
    placeCaret(el, "end");
    return;
  }
  selectAt(hit.node, hit.offset);
}

function selectAt(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Caret hit-test at a screen point, constrained to `el`'s contents. */
export function caretHit(x: number, y: number, el: HTMLElement): { node: Node; offset: number } | null {
  if (typeof document.caretPositionFromPoint === "function") {
    const position = document.caretPositionFromPoint(x, y);
    if (position && el.contains(position.offsetNode)) {
      return { node: position.offsetNode, offset: position.offset };
    }
    return null;
  }
  if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(x, y);
    if (range && el.contains(range.startContainer)) {
      return { node: range.startContainer, offset: range.startOffset };
    }
  }
  return null;
}

/** True when the caret sits on the first rendered line of `el` (or is indeterminate). */
export function caretOnFirstLine(el: HTMLElement): boolean {
  const rect = caretRect(el);
  if (!rect) return true;
  return rect.top - el.getBoundingClientRect().top < rect.height;
}

/** True when the caret sits on the last rendered line of `el` (or is indeterminate). */
export function caretOnLastLine(el: HTMLElement): boolean {
  const rect = caretRect(el);
  if (!rect) return true;
  return el.getBoundingClientRect().bottom - rect.bottom < rect.height;
}
