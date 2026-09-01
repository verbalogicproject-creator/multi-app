import React from 'react';
import { useAppContext } from '../../context/AppContext';
import StepIndicator from './StepIndicator';
import Step_Idea from './Step_Idea';
import Step_Plan from './Step_Plan';
import Step_Theme from './Step_Theme';
import Step_Generate from './Step_Generate';
import Step_Export from './Step_Export';

const WebAppBuilder: React.FC = () => {
    const { builderState, startWebAppBuild, resetWebAppBuild, savedBuilds, loadSavedBuild, removeSavedBuild, exportSavedBuild } = useAppContext();
    const { isActive, currentStep } = builderState;

    const savedBuildList = savedBuilds.length > 0 && (
        <div className="mt-12 text-left">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Saved builds</h3>
            <ul className="space-y-2">
                {savedBuilds.map(build => (
                    <li key={build.id} className="flex items-center gap-3 p-3 bg-gray-800/60 border border-gray-700 rounded-lg">
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-100 truncate">{build.name}</p>
                            <p className="text-xs text-gray-500">
                                {Object.keys(build.generatedFiles).length} files · {new Date(build.savedAt).toLocaleString()}
                            </p>
                        </div>
                        <button onClick={() => loadSavedBuild(build.id)} className="px-3 py-1.5 bg-sky-700 text-white text-xs font-semibold rounded-md hover:bg-sky-600">Open</button>
                        <button onClick={() => exportSavedBuild(build.id)} className="px-3 py-1.5 bg-gray-600 text-gray-100 text-xs font-semibold rounded-md hover:bg-gray-500">ZIP</button>
                        <button
                            onClick={() => { if (confirm(`Delete saved build "${build.name}"? This cannot be undone.`)) removeSavedBuild(build.id); }}
                            className="px-2 py-1.5 text-gray-500 hover:text-red-400 text-lg leading-none"
                            title="Delete build"
                        >&times;</button>
                    </li>
                ))}
            </ul>
        </div>
    );

    const renderCurrentStep = () => {
        switch (currentStep) {
            case 1: return <Step_Idea />;
            case 2: return <Step_Plan />;
            case 3: return <Step_Theme />;
            case 4: return <Step_Generate />;
            case 5: return <Step_Export />;
            default:
                return (
                    <div className="text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 mx-auto text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                           <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
                        </svg>
                        <h2 className="mt-4 text-2xl font-bold text-white">Build a Web App with AI</h2>
                        <p className="mt-2 text-lg text-gray-400">Go from a simple idea to a complete, downloadable React project in minutes.</p>
                        <button
                            onClick={startWebAppBuild}
                            className="mt-8 px-8 py-3 bg-sky-600 text-white font-semibold rounded-lg shadow-lg hover:bg-sky-500 transition-transform transform hover:scale-105"
                        >
                            Get Started
                        </button>
                        {savedBuildList}
                    </div>
                );
        }
    };
    
    return (
        <div className="flex-1 flex flex-col bg-gray-900 h-full p-6 md:p-10 justify-center items-center relative">
            {isActive && (
                <button onClick={resetWebAppBuild} className="absolute top-4 right-4 text-gray-500 hover:text-white">&times; Reset</button>
            )}
            <div className="w-full max-w-4xl mx-auto">
                {isActive && <StepIndicator currentStep={currentStep} />}
                <div className={`mt-8 transition-opacity duration-500 ${builderState.status.isLoading ? 'opacity-50' : 'opacity-100'}`}>
                    {renderCurrentStep()}
                </div>
            </div>
        </div>
    );
};

export default WebAppBuilder;
