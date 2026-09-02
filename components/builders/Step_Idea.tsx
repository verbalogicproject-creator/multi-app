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
            <h2 className="font-display text-2xl md:text-3xl tracking-[-0.03em] text-metal-100">
                Let's start with your big idea.
            </h2>
            <p className="mt-2 text-sm text-metal-300">
                Describe the web app you want to build. What is its main purpose? Who is it for?
            </p>
            <form onSubmit={handleSubmit} className="mt-6">
                <textarea
                    value={idea}
                    onChange={handleChange}
                    aria-label="Your idea"
                    placeholder="e.g. a simple site for a local bakery — menu, location, contact form"
                    className="w-full h-40 p-4 bg-raised rounded-card text-base md:text-lg text-metal-100
                               placeholder:text-metal-400 hairline focus:outline-none
                               disabled:opacity-40 transition-colors duration-200 ease-fluid"
                    disabled={status.isLoading}
                />
                <button
                    type="submit"
                    disabled={!idea.trim() || status.isLoading}
                    className="tap mt-6 w-full md:w-auto px-10 rounded-xl bg-metal-700 text-metal-100 font-medium
                               shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]
                               transition-[background-color,transform] duration-200 ease-fluid
                               md:hover:bg-[#33333a] active:scale-[0.98]
                               disabled:opacity-40 disabled:active:scale-100"
                >
                    {status.isLoading ? <LoadingIndicator text="Analysing idea…" /> : "Create project blueprint"}
                </button>
            </form>
        </div>
    );
};

export default Step_Idea;
