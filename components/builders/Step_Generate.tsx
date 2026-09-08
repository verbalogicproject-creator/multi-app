import React from 'react';
import { useAppContext } from '../../context/AppContext';
import LoadingIndicator from '../LoadingIndicator';

const button =
    "tap px-6 rounded-lg text-sm font-medium " +
    "transition-[background-color,transform] duration-200 ease-fluid active:scale-[0.98]";
const solidButton = `${button} bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] md:hover:bg-[#33333a]`;
const quietButton = `${button} bg-transparent text-metal-300 hairline md:hover:text-metal-100`;

const Step_Generate: React.FC = () => {
    const { builderState, promoteCandidate, discardCandidate, generateWebAppCode, globalError, setBuilderState, catalog } = useAppContext();
    const { status, candidateFiles, validation } = builderState;

    const fileList = status.log;

    // A human-readable name where the catalog has one, the raw id otherwise —
    // matches how QuotaBadge labels a model rather than inventing a second style.
    const modelLabel = (id: string | null | undefined): string =>
        id ? (catalog.find(m => m.id === id)?.label ?? id) : 'a different model';

    /* A silent quota/overload downgrade is exactly the kind of thing that needs
       the user's attention — the model the request asked for was not the one
       that actually wrote the code. Persistent rather than auto-dismissing: it
       stays visible through validation failure, success and export alike,
       since "which model actually wrote this" stays relevant the whole time. */
    const fallbackNotice = status.fellBack ? (
        <div className="mt-4 w-full max-w-md mx-auto text-left p-3 bg-raised rounded-card hairline text-xs flex items-start gap-2">
            <span aria-hidden className="mt-1 inline-block w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
            <p className="text-metal-200">
                Continued on <span className="text-accent-soft">{modelLabel(status.servedModel)}</span> — {modelLabel(status.requestedModel)} was temporarily unavailable (quota or overload).
            </p>
        </div>
    ) : null;

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
                {fallbackNotice}

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

    /**
     * The attempt ended and produced nothing.
     *
     * There was no branch for this. The render below mounts a spinner
     * unconditionally and pulses "writing…", so a failed generation showed a
     * stopped build as a running one — the error banner, a spinning indicator and a
     * list of filenames that no longer existed, all at once. Observed on a real
     * device before it was described here.
     *
     * `currentStep: 4` and `isLoading: true` are set in the same update, so reaching
     * this branch means the run is genuinely over rather than not yet begun.
     */
    if (!status.isLoading && !candidateFiles) {
        return (
            <div className="w-full max-w-2xl mx-auto text-center">
                <h2 className="font-display text-xl md:text-2xl tracking-[-0.02em] text-metal-100">
                    {/* A stopped build is the definition of something that needs you. */}
                    <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-accent align-middle mr-2" />
                    Generation stopped before it finished
                </h2>
                <p className="mt-3 text-sm text-metal-300">
                    {globalError || status.message || 'The model did not return a usable result.'}
                </p>
                {fallbackNotice}

                {fileList.length > 0 && (
                    <div className="mt-6 w-full max-w-md mx-auto text-left bg-raised rounded-card hairline
                                    p-4 max-h-48 overflow-y-auto meta text-xs">
                        {/* Named as what arrived, not as progress. The same list under a
                            spinner is what made a finished failure look like work in
                            flight. */}
                        <p className="text-metal-300 mb-2">Reached before it stopped:</p>
                        {fileList.map((file, index) => (
                            <p key={index} className="text-metal-200">
                                <span aria-hidden className="text-metal-400">✓</span> {file}
                            </p>
                        ))}
                    </div>
                )}

                <div className="mt-8 flex flex-col sm:flex-row justify-center gap-3">
                    <button onClick={generateWebAppCode} className={solidButton}>Generate again</button>
                    <button
                        onClick={() => setBuilderState(prev => ({ ...prev, currentStep: 3 }))}
                        className={quietButton}
                    >
                        Back to style
                    </button>
                </div>
                <p className="mt-4 text-xs text-metal-400">
                    Nothing has overwritten your saved builds.
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
            {fallbackNotice}

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
