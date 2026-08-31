import React from 'react';
import { useAppContext } from '../../context/AppContext';

const Step_Plan: React.FC = () => {
    const { builderState, setBuilderState } = useAppContext();
    const { plan } = builderState;

    const handleApprove = () => {
        setBuilderState(prev => ({ ...prev, currentStep: 3 }));
    };

    if (!plan) {
        return <div className="text-center text-gray-400">Generating plan...</div>;
    }

    return (
        <div className="w-full max-w-3xl mx-auto bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <h2 className="text-2xl font-bold text-sky-400 text-center">Project Blueprint</h2>
            <p className="mt-1 text-center text-gray-400">The AI has created a plan for your app. Does this look right?</p>
            
            <div className="mt-6 p-4 bg-gray-900 rounded-md">
                <p className="text-lg font-semibold">{plan.projectName}</p>
                <p className="text-sm text-gray-400 italic">"{plan.projectDescription}"</p>
            </div>

            <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm">
                <div className="p-4 bg-gray-900 rounded-md">
                    <h3 className="font-semibold text-gray-200 mb-2 border-b border-gray-700 pb-2">Pages</h3>
                    <ul className="space-y-2">
                        {plan.pages.map((page: any, index: number) => (
                            <li key={index}>
                                <p className="font-bold">{page.name} <span className="text-gray-500 font-normal">({page.path})</span></p>
                                <p className="text-xs text-gray-400 pl-2">{page.description}</p>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="p-4 bg-gray-900 rounded-md">
                    <h3 className="font-semibold text-gray-200 mb-2 border-b border-gray-700 pb-2">Components</h3>
                     <ul className="space-y-2">
                        {plan.components.map((component: any, index: number) => (
                            <li key={index}>
                                <p className="font-bold">{component.name}</p>
                                <p className="text-xs text-gray-400 pl-2">{component.description}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <div className="mt-8 text-center">
                <button
                    onClick={handleApprove}
                    className="px-10 py-3 bg-sky-600 text-white font-semibold rounded-lg shadow-md hover:bg-sky-500 transition-all transform hover:scale-105"
                >
                    Looks Good, Let's Add Style!
                </button>
            </div>
        </div>
    );
};

export default Step_Plan;
