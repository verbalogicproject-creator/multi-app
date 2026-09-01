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
        <div className="flex-1 flex flex-col bg-gray-900 h-full p-6 md:p-10 justify-center items-center relative overflow-y-auto">
            {isActive && (
                <button onClick={resetWebAppBuild} className="absolute top-4 right-4 text-gray-500 hover:text-white">&times; Reset</button>
            )}
            <div className="w-full max-w-4xl mx-auto my-auto">
                {isActive && <StepIndicator currentStep={currentStep} />}
                <div className={`mt-8 transition-opacity duration-500 ${builderState.status.isLoading ? 'opacity-50' : 'opacity-100'}`}>
                    {renderCurrentStep()}
                </div>
            </div>
        </div>
    );
};

export default WebAppBuilder;
