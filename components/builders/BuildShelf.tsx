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

/** The builder's home: start a new build, or reopen one you already made. */
const BuildShelf: React.FC = () => {
    const {
        startWebAppBuild, savedBuilds, loadSavedBuild, removeSavedBuild, exportSavedBuild,
        projects, setActiveTab,
    } = useAppContext();

    return (
        <div className="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 mx-auto text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
            </svg>
            <h2 className="mt-4 text-2xl font-bold text-white">Build a Web App with AI</h2>
            <p className="mt-2 text-gray-400">Go from an idea to a complete, downloadable React project.</p>
            <button
                onClick={startWebAppBuild}
                className="mt-6 px-8 py-3 bg-sky-600 text-white font-semibold rounded-lg shadow-lg hover:bg-sky-500 transition-transform transform hover:scale-105"
            >
                Start a new build
            </button>

            {savedBuilds.length > 0 && (
                <div className="mt-12 text-left">
                    <h3 className="text-sm font-semibold text-gray-300 mb-3">
                        Saved builds <span className="text-gray-500 font-normal">({savedBuilds.length})</span>
                    </h3>
                    <ul className="space-y-2">
                        {savedBuilds.map(build => {
                            const fileCount = Object.keys(build.generatedFiles ?? {}).length;
                            const verdict = build.validation;
                            const errors = verdict?.issues?.filter(i => i.severity === 'error').length ?? 0;
                            return (
                                <li key={build.id} className="p-3 bg-gray-800/60 border border-gray-700 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-gray-100 truncate">{build.name}</p>
                                            <p className="text-xs text-gray-500">
                                                {fileCount} files · {relativeTime(build.savedAt)}
                                                {verdict && (
                                                    <span className={errors > 0 ? 'text-amber-500' : 'text-green-500'}>
                                                        {' · '}{errors > 0 ? `kept with ${errors} issue${errors === 1 ? '' : 's'}` : 'validated'}
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                        <button onClick={() => loadSavedBuild(build.id)}
                                            className="px-3 py-1.5 bg-sky-700 text-white text-xs font-semibold rounded-md hover:bg-sky-600">Open</button>
                                        <button onClick={() => exportSavedBuild(build.id)}
                                            className="px-3 py-1.5 bg-gray-600 text-gray-100 text-xs font-semibold rounded-md hover:bg-gray-500">ZIP</button>
                                        <button
                                            onClick={() => { if (confirm(`Delete saved build "${build.name}"? This cannot be undone.`)) removeSavedBuild(build.id); }}
                                            className="px-2 py-1.5 text-gray-500 hover:text-red-400 text-lg leading-none"
                                            title="Delete build"
                                        >&times;</button>
                                    </div>
                                    {build.idea && <p className="mt-1.5 text-xs text-gray-500 italic truncate">“{build.idea}”</p>}
                                </li>
                            );
                        })}
                    </ul>
                    <p className="mt-2 text-xs text-gray-600">The 10 most recent builds are kept in this browser.</p>
                </div>
            )}

            {projects.length > 0 && (
                <div className="mt-8 text-left">
                    <p className="text-xs text-gray-500">
                        You also have {projects.length} project{projects.length === 1 ? '' : 's'} in the IDE.{' '}
                        <button onClick={() => setActiveTab('projects')} className="text-sky-500 hover:text-sky-400 underline">Open Projects</button>
                    </p>
                </div>
            )}
        </div>
    );
};

export default BuildShelf;
