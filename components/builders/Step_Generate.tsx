import React from 'react';
import { useAppContext } from '../../context/AppContext';
import LoadingIndicator from '../LoadingIndicator';

const button =
    "tap px-6 rounded-lg text-sm font-medium " +
    "transition-[background-color,transform] duration-200 ease-fluid active:scale-[0.98]";
const solidButton = `${button} bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] md:hover:bg-[#33333a]`;
const quietButton = `${button} bg-transparent text-metal-300 hairline md:hover:text-metal-100`;

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
                {/* A build that failed its own check is the definition of something
                    that needs you, so this is one of the few screens allowed an
                    accent. Errors carry it; warnings do not, because a warning is
                    a note and not a demand. */}
                {/* The dot is inline, not a flex sibling: `items-center` against a
                    heading that wraps parks it beside the whole block instead of
                    the first line, and it reads as an orphan. */}
                <h2 className="font-display text-2xl md:text-3xl tracking-[-0.03em] text-metal-100 text-center">
                    <span aria-hidden className="inline-block align-middle w-2 h-2 rounded-full bg-accent mr-2" />
                    Generated, but it didn't pass validation
                </h2>
                <p className="mt-2 text-center text-metal-300 text-sm">
                    {validation.checked} files were generated and checked without asking the model whether it succeeded.
                    Nothing has overwritten your saved builds.
                </p>

                <div className="mt-6 max-h-72 overflow-y-auto space-y-2">
                    {errors.map((issue, index) => (
                        <div key={`e${index}`} className="p-3 bg-raised rounded-card hairline text-sm">
                            <span className="text-accent-soft text-xs font-medium uppercase tracking-[0.12em]">Error</span>
                            {issue.file && <span className="meta ml-2 text-xs">{issue.file}</span>}
                            <p className="text-metal-200 mt-1">{issue.message}</p>
                        </div>
                    ))}
                    {warnings.map((issue, index) => (
                        <div key={`w${index}`} className="p-3 bg-white/[0.04] rounded-card text-sm">
                            <span className="text-metal-300 text-xs font-medium uppercase tracking-[0.12em]">Warning</span>
                            {issue.file && <span className="meta ml-2 text-xs">{issue.file}</span>}
                            <p className="text-metal-200 mt-1">{issue.message}</p>
                        </div>
                    ))}
                </div>

                <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
                    <button onClick={generateWebAppCode} className={solidButton}>Generate again</button>
                    <button onClick={promoteCandidate} className={solidButton}>Keep it anyway</button>
                    <button onClick={discardCandidate} className={quietButton}>Back to style</button>
                </div>
                <p className="mt-4 text-center text-xs text-metal-300">
                    “Generate again” costs another model request. “Keep it anyway” opens the export screen so you can inspect or fix the files.
                </p>
            </div>
        );
    }

    return (
        <div className="w-full max-w-4xl mx-auto text-center">
            <h2 className="font-display text-xl md:text-2xl tracking-[-0.02em] text-metal-100">{status.message}</h2>

            <div className="mt-8 flex justify-center">
                <LoadingIndicator />
            </div>

            {/* A build running quietly shows no orange at all, and that is the
                feature. Progress is metal. */}
            <div className="mt-8 w-full max-w-md mx-auto text-left h-48 bg-raised rounded-card hairline
                            p-4 overflow-y-auto meta text-xs md:text-sm" aria-live="polite">
                {fileList.length > 0 ? (
                    <>
                        {fileList.map((file, index) => (
                            <p key={index} className="text-metal-200">
                                <span aria-hidden className="text-metal-400">✓</span> {file}
                            </p>
                        ))}
                        <p className="text-metal-300 animate-pulse">writing…</p>
                    </>
                ) : (
                    <p className="text-metal-300 animate-pulse">{status.message || 'Waiting for the model…'}</p>
                )}
            </div>

            <div className="mt-6 text-xs text-metal-300">
                Files are checked automatically before the build is accepted.
            </div>
        </div>
    );
};

export default Step_Generate;
