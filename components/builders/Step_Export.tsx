import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext';

const button =
    "tap px-6 md:px-8 rounded-xl font-medium " +
    "transition-[background-color,transform] duration-200 ease-fluid active:scale-[0.98]";
const solid = `${button} bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] md:hover:bg-[#33333a]`;
const quiet = `${button} bg-transparent text-metal-300 hairline md:hover:text-metal-100`;
const field = "tap flex-1 min-w-0 px-3 bg-raised rounded-lg text-sm text-metal-100 placeholder:text-metal-400 hairline focus:outline-none";

const Step_Export: React.FC = () => {
    const { builderState, loadGeneratedProjectIntoIDE, exportGeneratedProject, resetWebAppBuild, saveCurrentBuild, savedBuilds } = useAppContext();
    const { plan, generatedFiles, savedBuildId, status, validation, evidence } = builderState;
    const [buildName, setBuildName] = useState<string>(
        () => savedBuilds.find(b => b.id === savedBuildId)?.name || plan?.projectName || 'Untitled build'
    );

    if (!plan || !generatedFiles) {
        return (
            <p className="flex items-center justify-center gap-2 text-center text-sm text-metal-100">
                <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                Something went wrong. Please start over.
            </p>
        );
    }

    const fileCount = Object.keys(generatedFiles).length;

    return (
        <div className="w-full max-w-2xl mx-auto text-center">
            {/* Success is not attention. A build that worked needs nothing from
                you, so it gets no orange — only the unsaved warning below does. */}
            <div aria-hidden className="w-16 h-16 md:w-20 md:h-20 mx-auto bg-raised rounded-full flex items-center justify-center
                                        shadow-[inset_0_0_0_1px_rgb(255_255_255/0.10)]">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-9 md:h-11 md:w-11 text-metal-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            </div>
            <h2 className="mt-4 font-display text-2xl md:text-3xl tracking-[-0.03em] text-metal-100">
                “{plan.projectName}” is ready
            </h2>
            <p className="mt-2 text-sm text-metal-300">{fileCount} files were generated for your new project.</p>

            <div className="mt-6 p-4 md:p-5 bg-surface rounded-card hairline text-left">
                <p className="text-sm text-metal-300 flex items-start gap-2">
                    {savedBuildId
                        ? <><span aria-hidden className="text-metal-400">✓</span><span><span className="text-metal-100">Saved to your library.</span> It will survive a page reload.</span></>
                        /* Unsaved work is exactly what the accent is for. */
                        : <><span aria-hidden className="w-1.5 h-1.5 mt-1.5 rounded-full bg-accent shrink-0" /><span className="text-metal-100">Not saved yet — save it so a reload cannot lose it.</span></>}
                </p>
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                    <input
                        type="text"
                        value={buildName}
                        onChange={e => setBuildName(e.target.value)}
                        placeholder="Build name"
                        aria-label="Build name"
                        className={field}
                    />
                    <button onClick={() => saveCurrentBuild(buildName)}
                        className="tap shrink-0 px-4 rounded-lg bg-metal-700 text-metal-100 text-sm font-medium
                                   shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                                   transition-[background-color,transform] duration-200 ease-fluid
                                   md:hover:bg-[#33333a] active:scale-[0.98]">
                        {savedBuildId ? 'Update saved build' : 'Save build'}
                    </button>
                    {savedBuildId && (
                        <button onClick={() => saveCurrentBuild(buildName, true)}
                            className="tap shrink-0 px-4 rounded-lg bg-transparent text-metal-300 text-sm font-medium hairline
                                       transition-colors duration-200 ease-fluid md:hover:text-metal-100">
                            Save as copy
                        </button>
                    )}
                </div>
                {status.message && <p className="mt-2 text-xs text-metal-300">{status.message}</p>}
            </div>

            {validation && (
                <div className="mt-4 text-left text-sm">
                    {validation.issues.length === 0 ? (
                        <p className="text-metal-300">
                            <span aria-hidden className="text-metal-400">✓</span> Passed all {validation.checked} file checks — imports resolve, nothing truncated or left as a placeholder.
                        </p>
                    ) : (
                        <details className="p-3 bg-surface rounded-card hairline">
                            <summary className="tap cursor-pointer flex items-center gap-2 text-metal-100">
                                {!validation.ok && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                                {validation.ok ? 'Passed with' : 'Kept despite'} {validation.issues.length} note{validation.issues.length === 1 ? '' : 's'} — tap to review
                            </summary>
                            <ul className="mt-2 space-y-1 text-xs">
                                {validation.issues.map((issue, index) => (
                                    <li key={index} className={issue.severity === 'error' ? 'text-accent-soft' : 'text-metal-300'}>
                                        <span className="uppercase text-[10px] mr-1 tracking-[0.12em]">{issue.severity}</span>
                                        {issue.file && <span className="meta mr-1">{issue.file}</span>}
                                        <span className="text-metal-200">{issue.message}</span>
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                </div>
            )}

            {generatedFiles['preview.html'] && (
                <div className="mt-8 text-left">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-3">
                        Visual preview <span className="normal-case tracking-normal text-metal-400">— static snapshot of the home page</span>
                    </p>
                    {/* The preview seam. `sandbox=""` grants nothing: no scripts, no
                        same-origin, no forms. When the preview becomes a real React
                        runtime it replaces the srcDoc here and nowhere else. */}
                    <div className="bezel-shell">
                        <div className="bezel-core overflow-hidden">
                            <iframe
                                sandbox=""
                                srcDoc={generatedFiles['preview.html']}
                                title={`${plan.projectName} preview`}
                                className="w-full h-[22rem] md:h-[28rem] bg-white block rounded-core"
                            />
                        </div>
                    </div>
                </div>
            )}

            <div className="mt-8 flex flex-col md:flex-row justify-center gap-3 md:gap-4">
                <button onClick={exportGeneratedProject} className={solid}>Download project (.zip)</button>
                <button onClick={loadGeneratedProjectIntoIDE} className={quiet}>Open in IDE</button>
            </div>
            
            {evidence.length > 0 && (
                <details className="mt-8 text-left p-3 bg-surface rounded-card hairline">
                    <summary className="tap cursor-pointer flex items-center text-sm text-metal-300">Build record ({evidence.length} steps)</summary>
                    <ol className="mt-3 space-y-1.5">
                        {evidence.map((entry, index) => (
                            <li key={index} className="text-xs text-metal-200 flex gap-2">
                                <span className="meta shrink-0">
                                    {new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span>{entry.event}</span>
                            </li>
                        ))}
                    </ol>
                </details>
            )}

            <button onClick={resetWebAppBuild}
                className="tap mt-8 px-4 rounded-lg text-sm text-metal-300
                           transition-colors duration-200 ease-fluid md:hover:text-metal-100 md:hover:bg-metal-700">
                Start a new build
            </button>
        </div>
    );
};

export default Step_Export;
