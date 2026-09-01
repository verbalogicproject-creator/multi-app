import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext';

const Step_Export: React.FC = () => {
    const { builderState, loadGeneratedProjectIntoIDE, exportGeneratedProject, resetWebAppBuild, saveCurrentBuild, savedBuilds } = useAppContext();
    const { plan, generatedFiles, savedBuildId, status } = builderState;
    const [buildName, setBuildName] = useState<string>(
        () => savedBuilds.find(b => b.id === savedBuildId)?.name || plan?.projectName || 'Untitled build'
    );

    if (!plan || !generatedFiles) {
        return <div className="text-center text-red-400">Something went wrong. Please start over.</div>;
    }

    const fileCount = Object.keys(generatedFiles).length;

    return (
        <div className="w-full max-w-2xl mx-auto text-center">
            <div className="w-20 h-20 mx-auto bg-green-500/20 rounded-full flex items-center justify-center">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            </div>
            <h2 className="mt-4 text-3xl font-bold text-white">"{plan.projectName}" is ready!</h2>
            <p className="mt-2 text-gray-400">The AI successfully generated {fileCount} files for your new project.</p>

            <div className="mt-6 p-4 bg-gray-800/60 border border-gray-700 rounded-lg text-left">
                <p className="text-sm text-gray-300">
                    {savedBuildId
                        ? <><span className="text-green-400">✓ Saved to your library.</span> It will survive a page reload.</>
                        : <span className="text-amber-400">Not saved yet — save it so a reload cannot lose it.</span>}
                </p>
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                    <input
                        type="text"
                        value={buildName}
                        onChange={e => setBuildName(e.target.value)}
                        placeholder="Build name"
                        className="flex-1 p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                    <button
                        onClick={() => saveCurrentBuild(buildName)}
                        className="px-4 py-2 bg-sky-700 text-white text-sm font-semibold rounded-md hover:bg-sky-600"
                    >
                        {savedBuildId ? 'Update saved build' : 'Save build'}
                    </button>
                    {savedBuildId && (
                        <button
                            onClick={() => saveCurrentBuild(buildName, true)}
                            className="px-4 py-2 bg-gray-600 text-gray-100 text-sm font-semibold rounded-md hover:bg-gray-500"
                        >
                            Save as copy
                        </button>
                    )}
                </div>
                {status.message && <p className="mt-2 text-xs text-gray-400">{status.message}</p>}
            </div>

            {generatedFiles['preview.html'] && (
                <div className="mt-8 text-left">
                    <p className="text-sm font-semibold text-gray-300 mb-2">Visual preview (static snapshot of the home page)</p>
                    <iframe
                        sandbox=""
                        srcDoc={generatedFiles['preview.html']}
                        title={`${plan.projectName} preview`}
                        className="w-full h-[28rem] bg-white rounded-lg border border-gray-700"
                    />
                </div>
            )}

            <div className="mt-8 flex flex-col md:flex-row justify-center gap-4">
                <button
                    onClick={exportGeneratedProject}
                    className="px-8 py-3 bg-sky-600 text-white font-semibold rounded-lg shadow-md hover:bg-sky-500 transition-all transform hover:scale-105"
                >
                    Download Project (.zip)
                </button>
                <button
                    onClick={loadGeneratedProjectIntoIDE}
                    className="px-8 py-3 bg-gray-700 text-white font-semibold rounded-lg shadow-md hover:bg-gray-600 transition-all"
                >
                    Open in IDE
                </button>
            </div>
            
            <button onClick={resetWebAppBuild} className="mt-8 text-sm text-gray-500 hover:text-gray-300">
                Start a New Build
            </button>
        </div>
    );
};

export default Step_Export;
