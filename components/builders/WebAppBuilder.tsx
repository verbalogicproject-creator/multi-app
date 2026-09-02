import React from 'react';
import { useAppContext } from '../../context/AppContext';
import StepIndicator from './StepIndicator';
import BuildShelf from './BuildShelf';
import Step_Idea from './Step_Idea';
import Step_Plan from './Step_Plan';
import Step_Theme from './Step_Theme';
import Step_Generate from './Step_Generate';
import Step_Export from './Step_Export';

const WebAppBuilder: React.FC = () => {
    const { builderState, resetWebAppBuild } = useAppContext();
    const { isActive, currentStep } = builderState;

    const renderCurrentStep = () => {
        switch (currentStep) {
            case 1: return <Step_Idea />;
            case 2: return <Step_Plan />;
            case 3: return <Step_Theme />;
            case 4: return <Step_Generate />;
            case 5: return <Step_Export />;
            default: return <BuildShelf />;
        }
    };

    return (
        /* The scroll container does NOT centre. `justify-center` on a scrollable
           box pushes overflowing content above the scroll origin, where it
           cannot be reached — the export screen's heading was simply gone. The
           inner wrapper carries `min-h-full` and centres instead: it collapses
           to the viewport when content is short, and grows when it is not. */
        <div className="flex-1 flex flex-col bg-ground min-w-0 h-full relative overflow-y-auto">
            {isActive && (
                <button onClick={resetWebAppBuild}
                    className="tap sticky top-0 self-end z-10 mr-2 md:mr-4 flex items-center gap-1 px-3 rounded-lg
                               text-xs text-metal-300 bg-ground/85 backdrop-blur-sm
                               transition-colors duration-200 ease-fluid
                               md:hover:text-metal-100 md:hover:bg-metal-700">
                    <span aria-hidden>&times;</span> Reset
                </button>
            )}
            {/* shrink-0 is load-bearing. As a flex child this box was being
                compressed to its own min-height, and `justify-center` then
                overflowed it in BOTH directions — putting the step indicator at
                y = -191, above the scroll origin, where no gesture reaches it.
                With shrink-0 it takes its content height and the centring is a
                no-op whenever content is taller than the viewport. */}
            <div className={`min-h-full shrink-0 flex flex-col justify-center px-4 md:px-6 pb-10 md:pb-14 safe-t
                            ${isActive ? 'pt-2' : 'pt-10 md:pt-14'}`}>
                <div className="w-full max-w-4xl mx-auto">
                    {isActive && <StepIndicator currentStep={currentStep} />}
                    <div className={`${isActive ? 'mt-8' : ''} transition-opacity duration-500 ease-fluid ${builderState.status.isLoading ? 'opacity-50' : 'opacity-100'}`}>
                        {renderCurrentStep()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WebAppBuilder;
