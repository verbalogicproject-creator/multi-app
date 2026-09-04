import React, { useState } from 'react';
import AgentManager from './AgentManager';
import AiControls from './AiControls';

/**
 * The harness: who is working, and how they are configured.
 *
 * Agents and AI Settings were two tabs in a rail, which was two names for one subject.
 * An agent *is* a persona bound to a project; a persona is what an agent runs on. Asking
 * a person to hold that relationship across a tab switch is asking them to keep the
 * system's filing structure in their head instead of the thing they are configuring.
 *
 * So they are one destination with two parts. **Experts** defines who can work —
 * agents, each bound to a persona and a project. **Configuration** is what they run on
 * — the persona composer, the style blocks, and the model behaviour switches that were
 * already shared between them.
 *
 * The rail's disabled-while-an-agent-is-active rule went with the split. It existed to
 * stop you editing settings that the active agent had already claimed, which was a real
 * hazard when the two lived apart and a non-issue once they are on the same screen: the
 * relationship is now visible rather than something a tooltip has to warn you about.
 *
 * Not yet here, and named so it is not mistaken for done: editing the prompts and skills
 * that **this app itself** runs on — the main agent, the builder, the wizard. That is the
 * second half of "harness" and it needs the change-control the archives all designed and
 * never wired, which is its own commit rather than a text box.
 */

type Part = 'experts' | 'configuration';

const PARTS: { id: Part; label: string; hint: string }[] = [
    { id: 'experts', label: 'Experts', hint: 'Who can work, and on what' },
    { id: 'configuration', label: 'Configuration', hint: 'What they run on' },
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
                <div className={part === 'configuration' ? '' : 'hidden'}><AiControls /></div>
            </div>
        </div>
    );
};

export default Harness;
