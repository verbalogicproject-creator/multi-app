import React, { useState, useEffect, Suspense, lazy } from 'react';
import FileExplorer from './FileExplorer';
import Terminal from './Terminal';

/* CodeMirror is 182 KB gzip — more than the rest of the app put together. Held
   in its own chunk so it streams in behind a usable screen instead of standing
   in front of one; nothing else on first paint needs it. */
const CodeEditor = lazy(() => import('./CodeEditor'));
import { useAppContext } from '../context/AppContext';

interface IdeViewProps {
    projectId: string;
}

/**
 * One component, two layouts.
 *
 * From `md:` up it is the three-part IDE it has always been: tree, editor, and
 * a terminal holding the bottom third.
 *
 * On a phone that arrangement is three scroll regions inside a viewport that
 * has room for one, so the tree becomes a sheet you summon from the file name,
 * and the terminal becomes a disclosure that is shut until you ask for it. The
 * editor gets everything that is left, because editing is why you opened this.
 *
 * The editor is CodeMirror 6 and it lands inside here, once, so both layouts
 * get it together. Type diagnostics arrive the same way.
 */
const IdeView: React.FC<IdeViewProps> = ({ projectId }) => {
    const { filesByProject, aiDeleteFile, handleSaveFileContent, aiCreateFile, ensureProjectFiles } = useAppContext();
    const [activeFileId, setActiveFileId] = useState<string | null>(null);
    const [treeOpen, setTreeOpen] = useState(false);
    const [terminalOpen, setTerminalOpen] = useState(false);

    // Without this the IDE opens on an empty tree for a project that has files:
    // the map is filled lazily and nothing else fills it for this route.
    useEffect(() => { void ensureProjectFiles(projectId); }, [projectId, ensureProjectFiles]);

    const files = filesByProject.get(projectId) || [];
    const activeFile = files.find(f => f.id === activeFileId);

    useEffect(() => {
        // If the active file is deleted or project changes, deselect.
        if (activeFileId && !files.some(f => f.id === activeFileId)) {
            setActiveFileId(null);
        }
        // If there's no selection but there are files, select the first one.
        if (!activeFileId && files.length > 0) {
            setActiveFileId(files[0].id);
        }
    }, [files, activeFileId]);

    useEffect(() => {
        if (!treeOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTreeOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [treeOpen]);

    const handleSave = (newContent: string) => {
        if (activeFile) {
            handleSaveFileContent(projectId, activeFile.id, newContent);
        }
    };

    return (
        <div className="flex-1 flex bg-ground min-w-0 h-full overflow-hidden">
            {/* The tree: a column at md:, a sheet on a phone. */}
            {treeOpen && (
                <div
                    aria-hidden
                    onClick={() => setTreeOpen(false)}
                    className="md:hidden fixed inset-0 z-40 bg-black/60"
                />
            )}
            <div className={`md:flex md:static md:z-auto md:w-64 md:shrink-0
                             ${treeOpen ? 'flex fixed inset-y-0 left-0 z-50 w-[80%] max-w-xs' : 'hidden'}`}>
                <FileExplorer
                    files={files}
                    activeFileId={activeFileId}
                    onFileSelect={(id) => { setActiveFileId(id); setTreeOpen(false); }}
                    onCreateFile={(path) => aiCreateFile(projectId, path, '')}
                    onDeleteFile={(path) => aiDeleteFile(projectId, path)}
                    onClose={() => setTreeOpen(false)}
                />
            </div>

            <div className="flex-1 flex flex-col min-w-0 min-h-0">
                {/* The phone's way into the tree: the file you are in, and a way out of it. */}
                <button
                    type="button"
                    onClick={() => setTreeOpen(true)}
                    aria-expanded={treeOpen}
                    aria-label={activeFile ? `Choose file — currently ${activeFile.path}` : 'Choose file'}
                    className="tap md:hidden shrink-0 flex items-center gap-2 px-4 text-left
                               bg-surface shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]"
                >
                    <svg className="h-4 w-4 shrink-0 text-metal-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h3.6l1.8 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                    </svg>
                    <span className="meta text-xs truncate flex-1">{activeFile?.path ?? 'No file selected'}</span>
                    <span aria-hidden className="text-metal-300">▾</span>
                </button>

                <div className="flex-1 min-h-0 flex">
                    {activeFile ? (
                        <Suspense fallback={
                            <div className="flex-1 flex items-center justify-center bg-ground">
                                <span className="meta text-xs">Loading editor…</span>
                            </div>
                        }>
                            <CodeEditor file={activeFile} onSave={handleSave} />
                        </Suspense>
                    ) : (
                        <div className="flex-1 flex items-center justify-center p-6 text-sm text-metal-300 text-center">
                            <p>Select a file to view, or create one.</p>
                        </div>
                    )}
                </div>

                {/* The terminal holds a third of a desktop. On a phone it is shut
                    until asked for — a third of 780px is not a terminal, it is a
                    tax on the editor. */}
                <div className={`shrink-0 flex flex-col min-h-0
                                 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                                 ${terminalOpen ? 'h-2/5' : 'h-11'} md:h-1/3`}>
                    <button
                        type="button"
                        onClick={() => setTerminalOpen(o => !o)}
                        aria-expanded={terminalOpen}
                        className="tap md:hidden shrink-0 flex items-center gap-2 px-4 text-left
                                   text-xs font-medium uppercase tracking-[0.12em] text-metal-300"
                    >
                        <span aria-hidden className={`transition-transform duration-200 ease-fluid ${terminalOpen ? 'rotate-90' : ''}`}>▸</span>
                        Terminal
                    </button>
                    <div className={`flex-1 min-h-0 ${terminalOpen ? 'flex' : 'hidden'} md:flex`}>
                        <Terminal projectId={projectId} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default IdeView;
