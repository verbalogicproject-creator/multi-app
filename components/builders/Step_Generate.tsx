import React from 'react';
import { useAppContext } from '../../context/AppContext';
import LoadingIndicator from '../LoadingIndicator';

const Step_Generate: React.FC = () => {
    const { builderState } = useAppContext();
    const { status, generatedFiles } = builderState;

    const fileList = Object.keys(generatedFiles || {});

    return (
        <div className="w-full max-w-4xl mx-auto text-center">
            <h2 className="text-2xl font-bold text-white">{status.message}</h2>
            
            <div className="mt-8 flex justify-center">
                <LoadingIndicator />
            </div>

            <div className="mt-8 w-full max-w-md mx-auto text-left h-48 bg-gray-900/50 border border-gray-700 rounded-lg p-4 overflow-y-auto font-mono text-sm">
                <p className="text-sky-400 animate-pulse">AI is building...</p>
                {fileList.length > 0 ? (
                    fileList.map((file, index) => (
                        <p key={index} className="text-gray-300">
                            <span className="text-green-500">✓</span> Created {file}
                        </p>
                    ))
                ) : (
                    <p className="text-gray-500">Waiting for file generation to start...</p>
                )}
            </div>

            {/* In a real implementation, a sandboxed iframe would go here to show a live preview */}
            <div className="mt-6 text-xs text-gray-500">
                Live preview would appear here.
            </div>
        </div>
    );
};

export default Step_Generate;
