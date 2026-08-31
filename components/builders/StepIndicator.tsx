import React from 'react';

interface StepIndicatorProps {
    currentStep: number;
}

const steps = ["Idea", "Plan", "Theme", "Generate", "Export"];

const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep }) => {
    return (
        <div className="w-full">
            <div className="flex items-center justify-center">
                {steps.map((step, index) => {
                    const stepNumber = index + 1;
                    const isCompleted = currentStep > stepNumber;
                    const isActive = currentStep === stepNumber;
                    return (
                        <React.Fragment key={step}>
                            <div className="flex flex-col items-center">
                                <div
                                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg transition-all duration-300
                                        ${isCompleted ? 'bg-green-500 text-white' : ''}
                                        ${isActive ? 'bg-sky-500 text-white ring-4 ring-sky-500/50' : ''}
                                        ${!isCompleted && !isActive ? 'bg-gray-700 text-gray-400' : ''}
                                    `}
                                >
                                    {isCompleted ? '✔' : stepNumber}
                                </div>
                                <p className={`mt-2 text-xs font-semibold transition-colors duration-300 ${isActive || isCompleted ? 'text-white' : 'text-gray-500'}`}>{step}</p>
                            </div>
                            {index < steps.length - 1 && (
                                <div className={`flex-1 h-1 mx-2 transition-colors duration-500 ${currentStep > stepNumber ? 'bg-green-500' : 'bg-gray-700'}`}></div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
};

export default StepIndicator;
