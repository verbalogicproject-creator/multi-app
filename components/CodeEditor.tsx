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
import { ProjectFile } from '../types/index';
import { editorTheme, editorHighlight } from './editor/theme';
import { languageFor } from './editor/language';

interface CodeEditorProps {
    file: ProjectFile;
    onSave: (newContent: string) => void;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ file, onSave }) => {
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
                    /* `indentWithTab` is deliberately absent. It traps keyboard
                       focus in the editor with no way out, and CodeMirror ships no
                       escape hatch for it. `indentOnInput` covers the common case. */
                    keymap.of([
                        { key: 'Mod-s', preventDefault: true, run: () => { saveRef.current(); return true; } },
                        ...closeBracketsKeymap,
                        ...searchKeymap,
                        ...historyKeymap,
                        ...foldKeymap,
                        ...defaultKeymap,
                    ]),
                    EditorView.updateListener.of(update => {
                        if (!update.docChanged) return;
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
