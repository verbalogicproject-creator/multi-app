import React from 'react';

interface StepIndicatorProps {
    currentStep: number;
}

const steps = ["Idea", "Plan", "Theme", "Generate", "Export"];

/**
 * Progress is state you caused, not something that needs you — so it is carried
 * by value and weight, never by the accent. It used to be green for done and
 * sky for here, which is two hues doing a job that brightness does better and
 * that survives greyscale.
 *
 * Done is a bright rule and a check; here is a raised disc; ahead is dim. On a
 * phone the labels stay because five unlabelled discs say nothing.
 */
const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep }) => {
    return (
        <div className="w-full">
            <ol className="flex items-start justify-center">
                {steps.map((step, index) => {
                    const stepNumber = index + 1;
                    const isCompleted = currentStep > stepNumber;
                    const isActive = currentStep === stepNumber;
                    return (
                        <React.Fragment key={step}>
                            <li className="flex flex-col items-center shrink-0"
                                aria-current={isActive ? 'step' : undefined}>
                                <div
                                    className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center
                                                text-sm md:text-base font-medium
                                                transition-[background-color,box-shadow,color] duration-300 ease-fluid
                                        ${isCompleted ? 'bg-metal-700 text-metal-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]' : ''}
                                        ${isActive ? 'bg-raised text-metal-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)]' : ''}
                                        ${!isCompleted && !isActive ? 'bg-white/[0.04] text-metal-400' : ''}
                                    `}
                                >
                                    <span aria-hidden>{isCompleted ? '✓' : stepNumber}</span>
                                    <span className="sr-only">
                                        {isCompleted ? `${step}, done` : isActive ? `${step}, current step` : step}
                                    </span>
                                </div>
                                <p aria-hidden className={`mt-2 text-[10px] md:text-xs font-medium transition-colors duration-300 ease-fluid
                                    ${isActive ? 'text-metal-100' : isCompleted ? 'text-metal-200' : 'text-metal-400'}`}>
                                    {step}
                                </p>
                            </li>
                            {index < steps.length - 1 && (
                                <div aria-hidden className={`flex-1 h-px mx-1.5 md:mx-2 mt-4 md:mt-5
                                    transition-colors duration-500 ease-fluid
                                    ${currentStep > stepNumber ? 'bg-metal-300' : 'bg-metal-700'}`} />
                            )}
                        </React.Fragment>
                    );
                })}
            </ol>
        </div>
    );
};

export default StepIndicator;
