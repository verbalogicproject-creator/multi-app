import React, { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import FileExplorer from './FileExplorer';
import Terminal from './Terminal';
import ProblemsPanel from './ProblemsPanel';
import { useDiagnostics, useErrorCounts } from '../hooks/useDiagnostics';
import type { TscDiagnostic } from '../types/diagnostics';

/* CodeMirror is 182 KB gzip — more than the rest of the app put together. Held
   in its own chunk so it streams in behind a usable screen instead of standing
   in front of one; nothing else on first paint needs it. */
const CodeEditor = lazy(() => import('./CodeEditor'));
import { useAppContext } from '../context/AppContext';

interface IdeViewProps {
    projectId: string;
}

/** Three panels, one row of chrome. Order is left-to-right in the strip. */
/* Preview was the third tab here until it became a destination of its own. Two doors
   to one room is the duplication the dock was built to remove, and the drawer is for
   what the *editor* has to say — what the compiler found, what the terminal printed. */
const DRAWER_TABS = ['terminal', 'problems'] as const;
type DrawerTab = (typeof DRAWER_TABS)[number];
const TAB_LABEL: Record<DrawerTab, string> = { terminal: 'Terminal', problems: 'Problems' };

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
 * get it together. Type diagnostics arrive the same way — the bottom block is a
 * tab strip rather than a second disclosure, so the phone still pays for exactly
 * one 44px row of chrome down there.
 */
const IdeView: React.FC<IdeViewProps> = ({ projectId }) => {
    const { filesByProject, aiDeleteFile, handleSaveFileContent, aiCreateFile, ensureProjectFiles } = useAppContext();
    const [activeFileId, setActiveFileId] = useState<string | null>(null);
    const [treeOpen, setTreeOpen] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerTab, setDrawerTab] = useState<DrawerTab>('terminal');
    const [revealAt, setRevealAt] = useState<{ line: number; col: number; nonce: number } | undefined>();

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

    const diagnostics = useDiagnostics(projectId, files);
    const errorCounts = useErrorCounts(diagnostics);
    const fileDiagnostics = useMemo(
        () => (activeFile ? diagnostics.byFile.get(activeFile.path) ?? [] : []),
        [diagnostics.byFile, activeFile],
    );

    /* A problem names a file and a place in it. Open the one, then go to the other —
       and only reveal once the right file is actually mounted, or the coordinates
       would be applied to whatever was open before. */
    const handleProblemSelect = useCallback((d: TscDiagnostic) => {
        const target = files.find(f => f.path === d.path);
        if (target) setActiveFileId(target.id);
        setRevealAt({ line: d.line, col: d.col, nonce: Date.now() });
    }, [files]);

    const openDrawerTab = (tab: DrawerTab) => {
        if (drawerOpen && drawerTab === tab) { setDrawerOpen(false); return; }
        setDrawerTab(tab);
        setDrawerOpen(true);
    };

    const problemCount = diagnostics.all.length;

    /* The bundler takes the project as the model wrote it, not as the tree holds it.
       Memoised on the files array so switching tabs does not rebuild. */
    const fileRecord = useMemo(() => {
        const record: Record<string, string> = {};
        for (const file of files) record[file.path] = file.content ?? '';
        return record;
    }, [files]);

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
                    errorCounts={errorCounts}
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
                            <CodeEditor
                                file={activeFile}
                                onSave={handleSave}
                                diagnostics={fileDiagnostics}
                                revealAt={revealAt}
                            />
                        </Suspense>
                    ) : (
                        <div className="flex-1 flex items-center justify-center p-6 text-sm text-metal-300 text-center">
                            <p>Select a file to view, or create one.</p>
                        </div>
                    )}
                </div>

                {/* The bottom block holds a third of a desktop. On a phone it is shut
                    until asked for — a third of 780px is not a terminal, it is a
                    tax on the editor. Two panels share it as tabs rather than
                    stacking two disclosures, so the phone still pays one row. */}
                <div className={`shrink-0 flex flex-col min-h-0
                                 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                                 ${drawerOpen ? 'h-2/5' : 'h-11'} md:h-1/3`}>
                    <div role="tablist" aria-label="Output" className="shrink-0 flex items-stretch">
                        {DRAWER_TABS.map(tab => {
                            const selected = drawerTab === tab;
                            return (
                                <button
                                    key={tab}
                                    type="button"
                                    role="tab"
                                    aria-selected={selected}
                                    aria-expanded={selected && drawerOpen}
                                    onClick={() => openDrawerTab(tab)}
                                    className={`tap flex items-center gap-2 px-4 text-left
                                                text-xs font-medium uppercase tracking-[0.12em]
                                                transition-colors duration-200 ease-fluid
                                                ${selected ? 'text-metal-100' : 'text-metal-400'}`}
                                >
                                    {/* The caret is the phone's affordance; on desktop the
                                        block is always open, so it would be a lie there. */}
                                    <span
                                        aria-hidden
                                        className={`md:hidden transition-transform duration-200 ease-fluid
                                                    ${selected && drawerOpen ? 'rotate-90' : ''}`}
                                    >▸</span>
                                    {TAB_LABEL[tab]}
                                    {tab === 'problems' && problemCount > 0 && (
                                        <span className="meta text-[0.6875rem] px-1.5 rounded-full bg-accent-strong text-white">
                                            {problemCount}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <div className={`flex-1 min-h-0 ${drawerOpen ? 'flex' : 'hidden'} md:flex`}>
                        {drawerTab === 'terminal' && <Terminal projectId={projectId} />}
                        {drawerTab === 'problems' && <ProblemsPanel state={diagnostics} onSelect={handleProblemSelect} />}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default IdeView;
