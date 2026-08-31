import React from 'react';
import { useAppContext } from '../../context/AppContext';

const Step_Export: React.FC = () => {
    const { builderState, loadGeneratedProjectIntoIDE, exportGeneratedProject, resetWebAppBuild } = useAppContext();
    const { plan, generatedFiles } = builderState;

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
