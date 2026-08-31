'use client';

import * as React from 'react';
import {
  Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, ListChecks, Quote, Minus, Link as LinkIcon,
  Image as ImageIcon, Table as TableIcon, Underline as UnderlineIcon,
  Undo2, Redo2, SquareCode,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ToolButton, ToolDivider } from './ui';

/**
 * ===========================================================================
 *  The document editor
 * ===========================================================================
 *
 *  -- What this replaces ---------------------------------------------------
 *
 *  A `<Textarea className="font-mono">` behind an Edit button, with a Save
 *  button beside it and a three-item Template menu that overwrote whatever was
 *  already in the box. No toolbar, no shortcuts, no autosave, and the document
 *  was monospaced while it was being written and proportional once it was
 *  saved, so nothing looked like what it was going to be.
 *
 *  -- Why the source is still markdown -------------------------------------
 *
 *  `workspace_pages.content` is a text column holding markdown. Every existing
 *  document in every existing workspace is markdown, the version history is
 *  markdown, the search matches markdown, and the brief for this phase says
 *  the architecture is not to be replaced. Swapping in a JSON document model
 *  would mean migrating every stored page and rewriting version history in a
 *  format the old rows are not in.
 *
 *  So the file format stays and the *experience* changes: a real toolbar, real
 *  shortcuts, a proportional typeface at a document size, a live preview, and
 *  autosave. Somebody writing a policy here never needs to know the file is
 *  markdown, and somebody who does know can still type `##` and have it work.
 *
 *  -- Why edits go through `execCommand` -----------------------------------
 *
 *  Setting `value` from React destroys the browser's native undo stack for the
 *  textarea, so Ctrl+Z after clicking Bold would undo the last *typed* run and
 *  not the bold. `document.execCommand('insertText')` is deprecated and is
 *  still the only way to write into a textarea as though a person had typed
 *  it, which is what keeps undo, redo and the operating system's own
 *  dictation and autocorrect working. There is a `setState` fallback for
 *  anything that refuses it.
 *
 *  -- What is deliberately absent ------------------------------------------
 *
 *  **Paragraph alignment.** Markdown has no representation for a centred
 *  paragraph. Inventing one would produce documents that only this product can
 *  read, and the day somebody exports one it would be gone. Table columns
 *  *can* be aligned, because GFM has a syntax for it, and the table inserter
 *  below writes one.
 */

/* -------------------------------------------------------------------------- */
/*  Editing primitives                                                        */
/* -------------------------------------------------------------------------- */

type Area = HTMLTextAreaElement;

/**
 * Write into the textarea as though it had been typed.
 *
 * Returns false when the browser refuses, so the caller can fall back to a
 * controlled update and lose only the undo entry rather than the edit.
 */
function typeInto(area: Area, text: string): boolean {
  area.focus();
  try {
    // `insertText` respects the current selection: with a range selected it
    // replaces it, with a caret it inserts. That is exactly the semantics
    // every command below wants.
    return document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}

function selectionOf(area: Area) {
  return {
    start: area.selectionStart,
    end: area.selectionEnd,
    text: area.value.slice(area.selectionStart, area.selectionEnd),
  };
}

/** The whole lines the selection touches, and where they begin and end. */
function linesAround(value: string, start: number, end: number) {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const toIndex = value.indexOf('\n', end);
  const to = toIndex === -1 ? value.length : toIndex;
  return { from, to, text: value.slice(from, to) };
}

/* -------------------------------------------------------------------------- */
/*  Commands                                                                  */
/* -------------------------------------------------------------------------- */

export interface EditorApi {
  wrap: (before: string, after?: string, placeholder?: string) => void;
  prefixLines: (make: (line: string, index: number) => string, strip: RegExp) => void;
  insertBlock: (text: string) => void;
  focus: () => void;
}

/**
 * The commands, over a lazily-resolved textarea.
 *
 * `getArea` rather than the ref itself: React's rules-of-hooks lint treats a
 * ref passed into a function during render as a read of `.current` during
 * render, which it is not - every one of these runs from an event handler. A
 * getter says the same thing and is checkable.
 */
function buildApi(
  getArea: () => Area | null,
  commit: (next: string, caret?: [number, number]) => void,
): EditorApi {
  const apply = (next: string, from: number, to: number, caret: [number, number]) => {
    const area = getArea();
    if (!area) return;
    area.focus();
    area.setSelectionRange(from, to);
    if (!typeInto(area, next)) {
      const value = area.value.slice(0, from) + next + area.value.slice(to);
      commit(value, caret);
      return;
    }
    area.setSelectionRange(caret[0], caret[1]);
    // execCommand fires `input`, so React's onChange has already run with the
    // new value; nothing further to commit.
  };

  return {
    /**
     * Emphasis, and the toggle nobody notices until it is missing.
     *
     * Selecting already-bold text and pressing Bold removes the marks rather
     * than nesting a second pair, which is what every editor does and what a
     * person expects. With no selection it inserts the marks and leaves the
     * caret between them, so typing continues in the new style.
     */
    wrap(before, after = before, placeholder = '') {
      const area = getArea();
      if (!area) return;
      const { start, end, text } = selectionOf(area);
      const value = area.value;

      const outsideBefore = value.slice(Math.max(0, start - before.length), start);
      const outsideAfter = value.slice(end, end + after.length);

      if (text && outsideBefore === before && outsideAfter === after) {
        apply(text, start - before.length, end + after.length,
          [start - before.length, end - before.length]);
        return;
      }
      if (text.startsWith(before) && text.endsWith(after) && text.length > before.length + after.length) {
        const inner = text.slice(before.length, text.length - after.length);
        apply(inner, start, end, [start, start + inner.length]);
        return;
      }

      const body = text || placeholder;
      apply(before + body + after, start, end,
        text
          ? [start + before.length, start + before.length + body.length]
          : [start + before.length, start + before.length + body.length]);
    },

    /**
     * Line-level marks: headings, lists, quotes.
     *
     * Applied across every line the selection touches, and removed again if
     * every one of them already carries the mark. A partial selection - two
     * bulleted lines and one plain one - gets the mark applied to all three,
     * because that is the intent somebody has when they select a block and
     * press the button.
     */
    prefixLines(make, strip) {
      const area = getArea();
      if (!area) return;
      const { start, end } = selectionOf(area);
      const block = linesAround(area.value, start, end);
      const lines = block.text.split('\n');

      const allMarked = lines.every(line => strip.test(line));
      const next = lines
        .map((line, index) => (allMarked ? line.replace(strip, '') : make(line.replace(strip, ''), index)))
        .join('\n');

      apply(next, block.from, block.to, [block.from, block.from + next.length]);
    },

    /**
     * A block inserted on its own lines.
     *
     * The blank line before matters: a table or a code fence written directly
     * under a paragraph is parsed as part of that paragraph, and the writer
     * sees their table render as a row of pipes.
     */
    insertBlock(text) {
      const area = getArea();
      if (!area) return;
      const { start, end } = selectionOf(area);
      const before = area.value.slice(0, start);
      const lead = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const body = `${lead}${text}\n`;
      apply(body, start, end, [start + body.length, start + body.length]);
    },

    focus() {
      getArea()?.focus();
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  The toolbar                                                               */
/* -------------------------------------------------------------------------- */

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export function EditorToolbar({
  api, onLink, onImage, disabled, className,
}: {
  api: EditorApi;
  onLink: () => void;
  onImage: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className={cn(
        'flex flex-wrap items-center gap-0.5 border-b border-border bg-card/95 px-2 py-1.5 backdrop-blur',
        'supports-[backdrop-filter]:bg-card/80',
        className,
      )}
    >
      <ToolButton icon={Bold} label="Bold" shortcut={`${MOD}B`} disabled={disabled}
        onAction={() => api.wrap('**', '**', 'bold text')} />
      <ToolButton icon={Italic} label="Italic" shortcut={`${MOD}I`} disabled={disabled}
        onAction={() => api.wrap('*', '*', 'italic text')} />
      <ToolButton icon={UnderlineIcon} label="Underline" shortcut={`${MOD}U`} disabled={disabled}
        onAction={() => api.wrap('++', '++', 'underlined text')} />
      <ToolButton icon={Strikethrough} label="Strikethrough" disabled={disabled}
        onAction={() => api.wrap('~~', '~~', 'struck through')} />
      <ToolButton icon={Code} label="Inline code" disabled={disabled}
        onAction={() => api.wrap('`', '`', 'code')} />

      <ToolDivider />

      <ToolButton icon={Heading1} label="Heading" disabled={disabled}
        onAction={() => api.prefixLines(line => `# ${line}`, /^#{1,6}\s+/)} />
      <ToolButton icon={Heading2} label="Subheading" disabled={disabled}
        onAction={() => api.prefixLines(line => `## ${line}`, /^#{1,6}\s+/)} />
      <ToolButton icon={Heading3} label="Small heading" disabled={disabled}
        onAction={() => api.prefixLines(line => `### ${line}`, /^#{1,6}\s+/)} />

      <ToolDivider />

      <ToolButton icon={List} label="Bulleted list" disabled={disabled}
        onAction={() => api.prefixLines(line => `- ${line}`, /^[-*+]\s+(\[[ x]\]\s+)?|^\d+\.\s+/)} />
      <ToolButton icon={ListOrdered} label="Numbered list" disabled={disabled}
        onAction={() => api.prefixLines((line, i) => `${i + 1}. ${line}`, /^[-*+]\s+(\[[ x]\]\s+)?|^\d+\.\s+/)} />
      <ToolButton icon={ListChecks} label="Task list" disabled={disabled}
        onAction={() => api.prefixLines(line => `- [ ] ${line}`, /^[-*+]\s+(\[[ x]\]\s+)?|^\d+\.\s+/)} />
      <ToolButton icon={Quote} label="Quote" disabled={disabled}
        onAction={() => api.prefixLines(line => `> ${line}`, /^>\s?/)} />

      <ToolDivider />

      <ToolButton icon={LinkIcon} label="Link" shortcut={`${MOD}K`} disabled={disabled} onAction={onLink} />
      <ToolButton icon={ImageIcon} label="Image" disabled={disabled} onAction={onImage} />
      <ToolButton icon={TableIcon} label="Table" disabled={disabled}
        onAction={() => api.insertBlock(
          '| Column | Column | Column |\n| --- | --- | ---: |\n|  |  |  |\n|  |  |  |',
        )} />
      <ToolButton icon={SquareCode} label="Code block" disabled={disabled}
        onAction={() => api.insertBlock('```\n\n```')} />
      <ToolButton icon={Minus} label="Divider" disabled={disabled}
        onAction={() => api.insertBlock('---')} />

      <ToolDivider />

      <ToolButton icon={Undo2} label="Undo" shortcut={`${MOD}Z`} disabled={disabled}
        onAction={() => { api.focus(); document.execCommand('undo'); }} />
      <ToolButton icon={Redo2} label="Redo" shortcut={`${MOD}⇧Z`} disabled={disabled}
        onAction={() => { api.focus(); document.execCommand('redo'); }} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The writing surface                                                       */
/* -------------------------------------------------------------------------- */

export interface MarkdownEditorHandle {
  api: EditorApi;
  /** Everything currently in the box, whether React has seen it or not. */
  value: () => string;
}

export const MarkdownEditor = React.forwardRef<MarkdownEditorHandle, {
  value: string;
  onChange: (next: string) => void;
  onTyping?: () => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
}>(function MarkdownEditor(
  { value, onChange, onTyping, placeholder, className, readOnly },
  ref,
) {
  const areaRef = React.useRef<Area | null>(null);

  /**
   * `onChange` in a ref, so the command API can be built once.
   *
   * Rebuilding the API whenever the parent re-renders would hand the toolbar a
   * new object on every keystroke, and the toolbar holds it in state.
   */
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => { onChangeRef.current = onChange; });

  /**
   * The command API, created on first use rather than during render.
   *
   * Every command reads the textarea, and React's rules-of-hooks lint treats a
   * ref reaching a function during render as a read during render even when
   * the read happens later. Building it inside a callback moves the whole
   * question outside render: `getApi()` is only ever called from an event
   * handler or from `useImperativeHandle`, both of which run after commit.
   */
  const apiRef = React.useRef<EditorApi | null>(null);
  const getApi = React.useCallback((): EditorApi => {
    if (!apiRef.current) {
      apiRef.current = buildApi(
        () => areaRef.current,
        (next, caret) => {
          onChangeRef.current(next);
          if (caret) {
            // After a controlled update the DOM value is written on the next
            // commit, so the caret has to be restored after it.
            requestAnimationFrame(() => areaRef.current?.setSelectionRange(caret[0], caret[1]));
          }
        },
      );
    }
    return apiRef.current;
  }, []);

  React.useImperativeHandle(ref, () => ({
    api: getApi(),
    value: () => areaRef.current?.value ?? '',
  }), [getApi]);

  /**
   * A controlled update that puts the caret back.
   *
   * Used only where `execCommand` was refused: React writes the new value on
   * the next commit, so the selection has to be restored after it or the caret
   * jumps to the end of the document.
   */
  const commitWithCaret = React.useCallback((next: string, caret: number) => {
    onChangeRef.current(next);
    requestAnimationFrame(() => areaRef.current?.setSelectionRange(caret, caret));
  }, []);

  /**
   * The textarea grows with its content.
   *
   * A document editor that scrolls inside a fixed box while the page scrolls
   * around it is two scrollbars for one document, and the inner one always
   * ends up in the wrong place. Measured after every change rather than with
   * CSS, because a textarea has no intrinsic height.
   */
  React.useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.max(area.scrollHeight, 420)}px`;
  }, [value]);

  /**
   * Shortcuts, and the two list behaviours that make a list usable.
   *
   * Enter inside a list continues it, and Enter on an empty list item ends it -
   * without both, writing a list means typing "- " forty times and then
   * deleting the last one. Tab indents rather than leaving the field, which is
   * the one place overriding Tab is right: inside a multi-line text editor
   * there is nowhere else for it to go, and Escape still releases focus.
   */
  const onKeyDown = React.useCallback((e: React.KeyboardEvent<Area>) => {
    const area = e.currentTarget;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'b') { e.preventDefault(); getApi().wrap('**', '**', 'bold text'); return; }
      if (key === 'i') { e.preventDefault(); getApi().wrap('*', '*', 'italic text'); return; }
      if (key === 'u') { e.preventDefault(); getApi().wrap('++', '++', 'underlined text'); return; }
      if (key === 'e') { e.preventDefault(); getApi().wrap('`', '`', 'code'); return; }
    }

    if (e.key === 'Escape') {
      area.blur();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      getApi().prefixLines(line => `  ${line}`, e.shiftKey ? /^ {1,2}/ : /^ $/);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      const { start } = selectionOf(area);
      const lineStart = area.value.lastIndexOf('\n', start - 1) + 1;
      const line = area.value.slice(lineStart, start);

      const bullet = /^(\s*)([-*+])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
      const numbered = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);

      if (bullet) {
        const [, indent, mark, task, body] = bullet;
        if (!body.trim()) {
          // An empty item: end the list rather than adding another empty one.
          e.preventDefault();
          area.setSelectionRange(lineStart, start);
          if (!typeInto(area, '')) commitWithCaret(area.value.slice(0, lineStart) + area.value.slice(start), lineStart);
          return;
        }
        e.preventDefault();
        typeInto(area, `\n${indent}${mark} ${task ? '[ ] ' : ''}`);
        return;
      }

      if (numbered) {
        const [, indent, n, body] = numbered;
        if (!body.trim()) {
          e.preventDefault();
          area.setSelectionRange(lineStart, start);
          if (!typeInto(area, '')) commitWithCaret(area.value.slice(0, lineStart) + area.value.slice(start), lineStart);
          return;
        }
        e.preventDefault();
        typeInto(area, `\n${indent}${Number(n) + 1}. `);
      }
    }
  }, [getApi, commitWithCaret]);

  return (
    <textarea
      ref={areaRef}
      value={value}
      readOnly={readOnly}
      spellCheck
      placeholder={placeholder}
      onChange={(e) => { onChange(e.target.value); onTyping?.(); }}
      onKeyDown={onKeyDown}
      className={cn(
        /*
          The writing surface reads as the document.

          A monospaced box in a border is a code editor, and a business
          document written in one looks wrong the whole time it is being
          written. Same measure, same size and same leading as the reading
          view, so nothing shifts when the preview is opened.
        */
        'w-full resize-none bg-transparent text-[15.5px] leading-[1.72] text-foreground',
        'outline-none placeholder:text-muted-foreground/60',
        'selection:bg-[--ring]/25',
        className,
      )}
    />
  );
});
