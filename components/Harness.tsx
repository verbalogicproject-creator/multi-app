import React, { useState } from 'react';
import AgentManager from './AgentManager';
import AiControls from './AiControls';
import PromptEngineeringStudio from './PromptEngineeringStudio';

/**
 * The harness: who is working, what they are told, and what they run on.
 *
 * Three parts, not two now — each answering a different question, deliberately
 * kept apart rather than merged further:
 *
 * **Experts** — who can work: agents, each bound to a persona and a project,
 * and the persona composer itself (model, skills, base instructions, composed
 * styles). A persona has no meaning apart from the agent(s) it drives, so it
 * lives where agents are defined, not in a separate settings screen — the
 * lesson the original two-tab merge already drew, extended rather than
 * abandoned now that a persona is more than a name and a style.
 *
 * **Prompts** (`PromptEngineeringStudio`) — what a chosen model is actually
 * told: the per-model foundation prompts a persona's `modelId` selects
 * (`providers/skillSource.js`'s `kind: 'model-prompt'` entries), editable
 * here; the additive `kind: 'skill'` entries, browsable but not editable
 * (third-party, MIT-licensed — see `skills/THIRD-PARTY-NOTICES.md`).
 *
 * This is only *half* of what this comment used to flag as "not yet here":
 * this app's own embedded generation prompts — the builder, the wizard,
 * `server.js`'s `/api/builder/*` routes, `HARNESS.md` — remain un-editable
 * through any UI. That is a separate, larger piece of work (the
 * change-control the archives all designed and never wired) this tab does
 * not attempt; naming it here so it is not mistaken for finished.
 *
 * **Configuration** — purely harness-wide runtime behaviour (Web Search, Low
 * Latency) — narrowed to exactly this once persona-authoring moved to
 * Experts. Nothing persona- or prompt-shaped belongs here.
 */

type Part = 'experts' | 'prompts' | 'configuration';

const PARTS: { id: Part; label: string; hint: string }[] = [
    { id: 'experts', label: 'Experts', hint: 'Who can work, and on what' },
    { id: 'prompts', label: 'Prompts', hint: 'What a chosen model is actually told' },
    { id: 'configuration', label: 'Configuration', hint: 'Harness-wide runtime behaviour' },
];

const Harness: React.FC = () => {
    const [part, setPart] = useState<Part>('experts');

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-ground">
            <div className="shrink-0 w-full max-w-4xl mx-auto px-4 md:px-6 pt-5 safe-t">
                <h1 className="font-display text-2xl md:text-3xl tracking-[-0.03em] text-metal-100">Harness</h1>
                <p className="mt-1 text-sm text-metal-300">
                    {PARTS.find(p => p.id === part)?.hint}
                </p>

                {/* Two parts of one subject, so a strip rather than two destinations —
                    the relationship between an expert and its configuration is the thing
                    worth seeing, and a second destination would hide it again. */}
                <div role="tablist" aria-label="Harness" className="mt-4 flex items-stretch gap-1">
                    {PARTS.map(({ id, label }) => {
                        const selected = part === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                onClick={() => setPart(id)}
                                className={`tap relative px-4 text-sm font-medium
                                            transition-colors duration-200 ease-fluid
                                            ${selected ? 'text-metal-100' : 'text-metal-300 md:hover:text-metal-100'}`}
                            >
                                {label}
                                <span
                                    aria-hidden
                                    className={`absolute bottom-0 inset-x-3 h-0.5 rounded-full
                                                transition-colors duration-200 ease-fluid
                                                ${selected ? 'bg-metal-300' : 'bg-transparent'}`}
                                />
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Hidden rather than unmounted, so a half-written persona survives a look at
                the expert it belongs to — the same rule the destinations follow. */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 w-full max-w-4xl mx-auto">
                <div className={part === 'experts' ? '' : 'hidden'}><AgentManager /></div>
                <div className={part === 'prompts' ? '' : 'hidden'}><PromptEngineeringStudio /></div>
                <div className={part === 'configuration' ? '' : 'hidden'}><AiControls /></div>
            </div>
        </div>
    );
};

export default Harness;
