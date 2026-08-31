import React from 'react';
import { useAppContext } from '../../context/AppContext';
import LoadingIndicator from '../LoadingIndicator';

const Step_Idea: React.FC = () => {
    const { builderState, setBuilderState, generateWebAppPlan } = useAppContext();
    const { idea, status } = builderState;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setBuilderState(prev => ({ ...prev, idea: e.target.value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (idea.trim()) {
            generateWebAppPlan();
        }
    };
    
    return (
        <div className="w-full max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-white">Let's start with your big idea.</h2>
            <p className="mt-2 text-gray-400">Describe the web app you want to build. What is its main purpose? Who is it for?</p>
            <form onSubmit={handleSubmit} className="mt-6">
                <textarea
                    value={idea}
                    onChange={handleChange}
                    placeholder="e.g., A simple website for a local bakery that shows their menu, location, and a contact form."
                    className="w-full h-40 p-4 bg-gray-800 border-2 border-gray-700 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors"
                    disabled={status.isLoading}
                />
                <button
                    type="submit"
                    disabled={!idea.trim() || status.isLoading}
                    className="mt-6 px-10 py-3 bg-sky-600 text-white font-semibold rounded-lg shadow-md hover:bg-sky-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all transform hover:scale-105 w-full md:w-auto"
                >
                    {status.isLoading ? <LoadingIndicator text="Analyzing Idea..." /> : "Create Project Blueprint"}
                </button>
            </form>
        </div>
    );
};

export default Step_Idea;
