import React, { useState, useEffect, useRef, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import {
    EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
    drawSelection, dropCursor, rectangularSelection, highlightSpecialChars,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { setDiagnostics, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { ProjectFile } from '../types/index';
import type { TscDiagnostic } from '../types/diagnostics';
import { editorTheme, editorHighlight } from './editor/theme';
import { languageFor } from './editor/language';

interface CodeEditorProps {
    file: ProjectFile;
    onSave: (newContent: string) => void;
    /** Type errors for this file. Empty while a check is in flight — see `useDiagnostics`. */
    diagnostics?: TscDiagnostic[];
    /**
     * Where to put the cursor, when something outside asked. The `nonce` is what makes
     * clicking the same problem twice work: without it the second click is the same
     * object and the effect never fires.
     */
    revealAt?: { line: number; col: number; nonce: number };
}

/**
 * tsc's line/column into CodeMirror's absolute document offsets.
 *
 * This conversion is where diagnostics go wrong. tsc counts from 1 and speaks in
 * lines; `@codemirror/lint` counts from 0 and speaks in offsets into the whole
 * document. A diagnostic naming a line the document no longer has is dropped rather
 * than clamped — an underline in the wrong place is worse than no underline.
 */
const toCmDiagnostics = (state: EditorState, parsed: TscDiagnostic[]): Diagnostic[] =>
    parsed.flatMap(d => {
        if (d.line < 1 || d.line > state.doc.lines) return [];
        const line = state.doc.line(d.line);
        const from = Math.min(line.from + d.col - 1, line.to);
        /* Underline the token, not the rest of the line. Falls back to the line when
           the column does not land on a word — a squiggle to the margin reads as a
           parser that gave up. */
        const rest = state.doc.sliceString(from, line.to);
        const word = /^\w+/.exec(rest);
        const to = word ? from + word[0].length : line.to;
        return [{
            from,
            to: Math.max(to, from + 1),
            severity: d.severity,
            source: d.code,
            message: `${d.code}: ${d.message}`,
        }];
    });

const CodeEditor: React.FC<CodeEditorProps> = ({ file, onSave, diagnostics, revealAt }) => {
    const [isSaved, setIsSaved] = useState(true);

    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    /* The content the store and the editor last agreed on. Distinguishes our own
       save echoing back through props from a file the model rewrote underneath us. */
    const syncedRef = useRef(file.content);
    /* Mirrors `isSaved` so the per-keystroke listener can decide whether a React
       render is even needed. Without it every character re-renders the pane. */
    const savedRef = useRef(true);
    /* Latest callbacks, so the view is never rebuilt just because a parent re-rendered. */
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    /* Whether any diagnostic is currently drawn, so the update listener knows if it
       has anything to retract without reaching into editor state on every keystroke. */
    const shownRef = useRef(false);

    const save = useCallback(() => {
        const view = viewRef.current;
        if (!view) return;
        const content = view.state.doc.toString();
        syncedRef.current = content;
        savedRef.current = true;
        setIsSaved(true);
        onSaveRef.current(content);
    }, []);
    const saveRef = useRef(save);
    saveRef.current = save;

    /**
     * Keyed on `file.id`, not on `file`.
     *
     * That is the whole trick. The object identity changes on every save, and
     * rebuilding the view there would silently throw away undo history and the
     * cursor on each Ctrl-S — a bug you cannot see until you press undo. Keying
     * on the id rebuilds exactly when the document genuinely changes, which is
     * also when history *should* reset: undo must not walk you into the previous
     * file's edits.
     */
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        const view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: file.content,
                extensions: [
                    lineNumbers(),
                    highlightActiveLineGutter(),
                    highlightActiveLine(),
                    highlightSpecialChars(),
                    foldGutter(),
                    history(),
                    drawSelection(),
                    dropCursor(),
                    rectangularSelection(),
                    indentOnInput(),
                    indentUnit.of('  '),
                    bracketMatching(),
                    closeBrackets(),
                    highlightSelectionMatches(),
                    /* Wrapping, not horizontal scroll: on a 390px viewport a long
                       line that scrolls sideways is a line you never read. */
                    EditorView.lineWrapping,
                    editorTheme,
                    syntaxHighlighting(editorHighlight),
                    languageFor(file.path),
                    /* Markers in the margin. The squiggles themselves arrive by
                       dispatch, not through a `linter()` source: this extension array
                       is built once per file, so a source closing over React state
                       would answer with whatever it captured on the day it was made. */
                    lintGutter(),
                    /* `indentWithTab` is deliberately absent. It traps keyboard
                       focus in the editor with no way out, and CodeMirror ships no
                       escape hatch for it. `indentOnInput` covers the common case. */
                    keymap.of([
                        { key: 'Mod-s', preventDefault: true, run: () => { saveRef.current(); return true; } },
                        ...closeBracketsKeymap,
                        ...searchKeymap,
                        ...historyKeymap,
                        ...foldKeymap,
                        /* Ahead of `defaultKeymap`, which is last and binds greedily. */
                        ...lintKeymap,
                        ...defaultKeymap,
                    ]),
                    EditorView.updateListener.of(update => {
                        if (!update.docChanged) return;

                        /* Diagnostics describe the text that was sent to the compiler.
                           The moment you type, they describe something that no longer
                           exists — and CodeMirror will faithfully *map* them through
                           the edit, so they do not go wrong loudly, they go wrong
                           quietly, still underlining while meaning nothing. Retract
                           them here rather than waiting for the next answer.

                           Deferred, because a transaction cannot be dispatched from
                           inside an update listener. */
                        if (shownRef.current) {
                            shownRef.current = false;
                            setTimeout(() => {
                                const view = viewRef.current;
                                if (view) view.dispatch(setDiagnostics(view.state, []));
                            }, 0);
                        }

                        const clean = update.state.doc.toString() === syncedRef.current;
                        if (clean === savedRef.current) return;
                        savedRef.current = clean;
                        setIsSaved(clean);
                    }),
                ],
            }),
        });

        viewRef.current = view;
        syncedRef.current = file.content;
        savedRef.current = true;
        setIsSaved(true);

        return () => {
            view.destroy();
            viewRef.current = null;
        };
        // `file.content` is read once, on purpose — see the note above and the
        // effect below, which is what keeps a live document in sync.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file.id]);

    /* The model can rewrite the open file. Replace the document when that
       happens, and ignore the echo of our own save. */
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        if (file.content === syncedRef.current) return;
        const current = view.state.doc.toString();
        syncedRef.current = file.content;
        if (file.content === current) return;
        view.dispatch({ changes: { from: 0, to: current.length, insert: file.content } });
        savedRef.current = true;
        setIsSaved(true);
    }, [file.content]);

    /**
     * Diagnostics arrive by dispatch, from their own effect.
     *
     * Deliberately *not* part of the `[file.id]` dependency list above: rebuilding the
     * view to change an underline would throw away undo history and the cursor, which
     * is the exact bug `scripts/check-editor.mjs` exists to catch. This is the same
     * shape as the `[file.content]` effect — reach into the live view and dispatch.
     *
     * An empty array is a real instruction, not a no-op. `useDiagnostics` empties it
     * the moment the text changes, and that dispatch is what retracts a squiggle
     * rather than leaving it to slide onto whatever now sits at those coordinates.
     */
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const next = toCmDiagnostics(view.state, diagnostics ?? []);
        shownRef.current = next.length > 0;
        view.dispatch(setDiagnostics(view.state, next));
    }, [diagnostics]);

    /* Someone clicked a problem. Put the cursor on it and scroll it into view. */
    useEffect(() => {
        const view = viewRef.current;
        if (!view || !revealAt) return;
        if (revealAt.line < 1 || revealAt.line > view.state.doc.lines) return;
        const line = view.state.doc.line(revealAt.line);
        const pos = Math.min(line.from + Math.max(revealAt.col - 1, 0), line.to);
        view.dispatch({
            selection: { anchor: pos },
            effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
        view.focus();
    }, [revealAt]);

    return (
        <div className="relative flex-1 flex flex-col min-w-0 min-h-0 bg-ground">
            {/* Desktop keeps a persistent header. A phone does not: the switcher
                above already carries the path, and a second 44px row of chrome
                costs more than it returns on a 390px screen. */}
            <div className="hidden md:flex shrink-0 justify-between items-center gap-2 px-4
                            bg-surface shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]">
                <h3 className="meta text-xs truncate flex items-center gap-2">
                    {/* Unsaved work is the one thing in this pane that needs you. */}
                    {!isSaved && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                    {file.path}
                </h3>
                <button
                    onClick={save}
                    disabled={isSaved}
                    className="tap shrink-0 px-4 rounded-lg text-sm font-medium
                               bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                               transition-[background-color,transform] duration-200 ease-fluid
                               md:hover:bg-[#33333a] active:scale-[0.98]
                               disabled:opacity-35 disabled:active:scale-100 disabled:md:hover:bg-metal-700"
                >
                    Save
                </button>
            </div>
            <div
                ref={hostRef}
                role="textbox"
                aria-multiline="true"
                aria-label={`Contents of ${file.path}`}
                className="flex-1 min-h-0 min-w-0 overflow-hidden"
            />
            {/* Absolutely positioned so that appearing mid-keystroke cannot push the
                text you are typing. Present only while there is something to save,
                which is exactly what the accent is for. */}
            {!isSaved && (
                <button
                    onClick={save}
                    className="tap md:hidden absolute bottom-3 right-3 z-10 flex items-center gap-2 px-4 rounded-full
                               bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.10)]
                               transition-transform duration-200 ease-fluid active:scale-[0.98]"
                >
                    <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                    Save
                </button>
            )}
        </div>
    );
};

export default CodeEditor;
