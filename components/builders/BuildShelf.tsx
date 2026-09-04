import React from 'react';
import { useAppContext } from '../../context/AppContext';

const relativeTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff)) return '';
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString();
};

const chip =
    "tap px-4 shrink-0 rounded-lg text-xs font-medium " +
    "transition-[background-color,transform] duration-200 ease-fluid active:scale-[0.98]";

/** The builder's home: start a new build, or reopen one you already made. */
const BuildShelf: React.FC = () => {
    const {
        startWebAppBuild, savedBuilds, loadSavedBuild, removeSavedBuild, exportSavedBuild,
        projects, setSurface,
    } = useAppContext();

    return (
        <div className="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" aria-hidden className="h-16 w-16 md:h-20 md:w-20 mx-auto text-metal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
            </svg>
            <h2 className="mt-4 font-display text-2xl md:text-3xl tracking-[-0.03em] text-metal-100">
                Build a web app with AI
            </h2>
            <p className="mt-2 text-sm text-metal-300">Go from an idea to a complete, downloadable React project.</p>
            <button
                onClick={startWebAppBuild}
                className="tap mt-6 w-full sm:w-auto px-8 rounded-xl bg-metal-700 text-metal-100 font-medium
                           shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]
                           transition-[background-color,transform] duration-200 ease-fluid
                           md:hover:bg-[#33333a] active:scale-[0.98]"
            >
                Start a new build
            </button>

            {savedBuilds.length > 0 && (
                <div className="mt-12 text-left">
                    <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-3">
                        Saved builds <span className="meta normal-case tracking-normal">({savedBuilds.length})</span>
                    </h3>
                    <ul className="space-y-2">
                        {savedBuilds.map(build => {
                            const fileCount = Object.keys(build.generatedFiles ?? {}).length;
                            const verdict = build.validation;
                            const errors = verdict?.issues?.filter(i => i.severity === 'error').length ?? 0;
                            return (
                                <li key={build.id} className="p-3 bg-raised rounded-card hairline">
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-metal-100 truncate">{build.name}</p>
                                            <p className="text-xs text-metal-300 flex items-center gap-1 flex-wrap">
                                                <span className="meta">{fileCount} files</span>
                                                <span aria-hidden>·</span>
                                                <span className="meta">{relativeTime(build.savedAt)}</span>
                                                {verdict && (
                                                    <>
                                                        <span aria-hidden>·</span>
                                                        {/* Kept despite issues is a thing you should know about. */}
                                                        {errors > 0 && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                                                        <span>{errors > 0 ? `kept with ${errors} issue${errors === 1 ? '' : 's'}` : 'validated'}</span>
                                                    </>
                                                )}
                                            </p>
                                        </div>
                                        <button onClick={() => loadSavedBuild(build.id)}
                                            className={`${chip} bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] md:hover:bg-[#33333a]`}>Open</button>
                                        <button onClick={() => exportSavedBuild(build.id)}
                                            className={`${chip} bg-transparent text-metal-300 hairline md:hover:text-metal-100`}>ZIP</button>
                                        <button
                                            onClick={() => { if (confirm(`Delete saved build "${build.name}"? This cannot be undone.`)) removeSavedBuild(build.id); }}
                                            className="tap flex items-center justify-center shrink-0 rounded-lg text-metal-300 text-lg leading-none
                                                       transition-colors duration-200 ease-fluid md:hover:text-accent md:hover:bg-metal-700"
                                            aria-label={`Delete build ${build.name}`}
                                        ><span aria-hidden>&times;</span></button>
                                    </div>
                                    {build.idea && <p className="mt-1.5 text-xs text-metal-400 truncate">“{build.idea}”</p>}
                                </li>
                            );
                        })}
                    </ul>
                    <p className="mt-2 text-xs text-metal-400">The 10 most recent builds are kept in this browser.</p>
                </div>
            )}

            {projects.length > 0 && (
                <div className="mt-8 text-left flex flex-wrap items-center gap-x-1 gap-y-1">
                    <p className="text-xs text-metal-300">
                        You also have {projects.length} project{projects.length === 1 ? '' : 's'} in the IDE.
                    </p>
                    {/* Sends you to the Projects destination. It used to set a rail tab,
                        which after the dock landed meant the one control on this screen
                        that promised to take you somewhere took you nowhere. */}
                    <button onClick={() => setSurface('projects')}
                        className="tap px-2 -mx-1 rounded-lg text-xs text-metal-200 underline underline-offset-2
                                   transition-colors duration-200 ease-fluid md:hover:text-metal-100 md:hover:bg-metal-700">
                        Open projects
                    </button>
                </div>
            )}
        </div>
    );
};

export default BuildShelf;
