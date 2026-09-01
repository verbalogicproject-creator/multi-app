import React from 'react';
import { useAppContext } from '../../context/AppContext';
import LoadingIndicator from '../LoadingIndicator';

const Step_Generate: React.FC = () => {
    const { builderState, promoteCandidate, discardCandidate, generateWebAppCode } = useAppContext();
    const { status, candidateFiles, validation } = builderState;

    const fileList = status.log;

    // A candidate that failed validation waits here for a decision — the previously
    // saved build is untouched until the user promotes this one.
    if (!status.isLoading && candidateFiles && validation && !validation.ok) {
        const errors = validation.issues.filter(i => i.severity === 'error');
        const warnings = validation.issues.filter(i => i.severity === 'warning');

        return (
            <div className="w-full max-w-2xl mx-auto">
                <h2 className="text-2xl font-bold text-amber-400 text-center">Generated, but it didn't pass validation</h2>
                <p className="mt-2 text-center text-gray-400 text-sm">
                    {validation.checked} files were generated and checked without asking the model whether it succeeded.
                    Nothing has overwritten your saved builds.
                </p>

                <div className="mt-6 max-h-72 overflow-y-auto space-y-2">
                    {errors.map((issue, index) => (
                        <div key={`e${index}`} className="p-3 bg-red-950/40 border border-red-800/60 rounded-md text-sm">
                            <span className="text-red-400 font-semibold">Error</span>
                            {issue.file && <span className="ml-2 font-mono text-xs text-gray-400">{issue.file}</span>}
                            <p className="text-gray-300 mt-1">{issue.message}</p>
                        </div>
                    ))}
                    {warnings.map((issue, index) => (
                        <div key={`w${index}`} className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-md text-sm">
                            <span className="text-amber-400 font-semibold">Warning</span>
                            {issue.file && <span className="ml-2 font-mono text-xs text-gray-400">{issue.file}</span>}
                            <p className="text-gray-300 mt-1">{issue.message}</p>
                        </div>
                    ))}
                </div>

                <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
                    <button onClick={generateWebAppCode}
                        className="px-6 py-2.5 bg-sky-600 text-white text-sm font-semibold rounded-lg hover:bg-sky-500">
                        Generate again
                    </button>
                    <button onClick={promoteCandidate}
                        className="px-6 py-2.5 bg-gray-700 text-white text-sm font-semibold rounded-lg hover:bg-gray-600">
                        Keep it anyway
                    </button>
                    <button onClick={discardCandidate}
                        className="px-6 py-2.5 bg-gray-800 text-gray-300 text-sm font-semibold rounded-lg hover:bg-gray-700">
                        Back to style
                    </button>
                </div>
                <p className="mt-4 text-center text-xs text-gray-500">
                    "Generate again" costs another model request. "Keep it anyway" opens the export screen so you can inspect or fix the files.
                </p>
            </div>
        );
    }

    return (
        <div className="w-full max-w-4xl mx-auto text-center">
            <h2 className="text-2xl font-bold text-white">{status.message}</h2>

            <div className="mt-8 flex justify-center">
                <LoadingIndicator />
            </div>

            <div className="mt-8 w-full max-w-md mx-auto text-left h-48 bg-gray-900/50 border border-gray-700 rounded-lg p-4 overflow-y-auto font-mono text-sm">
                {fileList.length > 0 ? (
                    <>
                        {fileList.map((file, index) => (
                            <p key={index} className="text-gray-300">
                                <span className="text-green-500">✓</span> {file}
                            </p>
                        ))}
                        <p className="text-sky-400 animate-pulse">writing…</p>
                    </>
                ) : (
                    <p className="text-sky-400 animate-pulse">{status.message || 'Waiting for Gemini…'}</p>
                )}
            </div>

            <div className="mt-6 text-xs text-gray-500">
                Files are checked automatically before the build is accepted.
            </div>
        </div>
    );
};

export default Step_Generate;
