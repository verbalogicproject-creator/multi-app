import React from 'react';
import { useAppContext } from '../../context/AppContext';
import LoadingIndicator from '../LoadingIndicator';

const Step_Generate: React.FC = () => {
    const { builderState } = useAppContext();
    const { status } = builderState;

    const fileList = status.log;

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
                A visual preview will appear on the next screen when generation finishes.
            </div>
        </div>
    );
};

export default Step_Generate;
