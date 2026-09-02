import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import * as memoryService from '../../services/memoryService';
import type { Episode, Lesson, MemoryStateResponse } from '../../services/memoryService';

/** While the drawer is open the build may still be running. While it is shut, the dot is all that matters. */
const POLL_OPEN_MS = 10_000;
const POLL_SHUT_MS = 30_000;

const shortId = (id: string) => `${id.slice(0, 12)}…`;

/* ------------------------------------------------------------------ ladder -- */

const RUNGS = ['proposed', 'qualified', 'approved'] as const;

/**
 * Where a lesson stands. The reached rungs are filled; the one it is waiting on is
 * the only thing here allowed to be orange, because waiting on you is exactly what
 * the accent means.
 */
const Ladder: React.FC<{ status: Lesson['status'] }> = ({ status }) => {
    const at = RUNGS.indexOf(status as (typeof RUNGS)[number]);
    return (
        <div className="flex items-center gap-1.5 text-[11px] text-metal-400">
            {RUNGS.map((rung, i) => {
                const reached = at >= 0 && i <= at;
                const waiting = i === at && status === 'qualified';
                return (
                    <React.Fragment key={rung}>
                        {i > 0 && <span aria-hidden className="text-metal-500">→</span>}
                        <span className={waiting ? 'text-accent' : reached ? 'text-metal-200' : 'text-metal-500'}>
                            <span aria-hidden>{reached ? '●' : '○'}</span> {rung}
                        </span>
                    </React.Fragment>
                );
            })}
        </div>
    );
};

/* ------------------------------------------------------------------ lesson -- */

const outcomeGlyph = (outcome?: string) =>
    outcome === 'verified' ? '✓' : outcome === 'failed' ? '✕' : '○';

const LessonCard: React.FC<{
    lesson: Lesson;
    episodes: Episode[];
    approver: string;
    onApprove: (lesson: Lesson) => void;
    busy: boolean;
    refusal?: string;
}> = ({ lesson, episodes, approver, onApprove, busy, refusal }) => {
    const [open, setOpen] = useState(false);
    const byId = (id?: string) => episodes.find(e => e.id === id);
    const source = byId(lesson.sourceEpisodeIds[0]);
    const reuse = byId(lesson.reuseEpisodeId);

    return (
        <div className="rounded-card bg-raised p-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
            <p className="text-sm text-metal-100 leading-snug">{lesson.trigger}</p>
            <p className="mt-2 text-xs text-metal-300 leading-relaxed">{lesson.recommendation}</p>

            <div className="mt-3">
                <Ladder status={lesson.status} />
            </div>
            <p className="mt-1.5 text-[11px] text-metal-400">
                {lesson.reuseCount > 0
                    ? `reused ${lesson.reuseCount === 1 ? 'once' : `${lesson.reuseCount} times`}, in a later attempt`
                    : 'not yet reused'}
                {' · '}
                <span className="font-mono">{lesson.domain}</span>
            </p>

            {/* Approving is a judgement. This is what makes the judgement possible. */}
            <button
                onClick={() => setOpen(v => !v)}
                aria-expanded={open}
                className="tap mt-3 -ml-1 flex items-center gap-1.5 px-1 text-xs text-metal-300
                           transition-colors duration-200 ease-fluid md:hover:text-metal-100"
            >
                <span aria-hidden className={`transition-transform duration-200 ease-fluid ${open ? 'rotate-90' : ''}`}>▸</span>
                evidence
            </button>

            <div className={`grid transition-[grid-template-rows,opacity] duration-240 ease-fluid
                             ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden">
                    <dl className="pt-1 pb-1 space-y-1.5 text-[11px]">
                        <div className="flex gap-2">
                            <dt className="w-16 shrink-0 text-metal-400">proposed</dt>
                            <dd className="text-metal-200 font-mono">
                                {source ? shortId(source.id) : '—'}
                                {source && (
                                    <span className="ml-2 font-sans text-metal-300">
                                        {outcomeGlyph(source.outcome)} {source.outcome ?? 'open'}
                                    </span>
                                )}
                            </dd>
                        </div>
                        <div className="flex gap-2">
                            <dt className="w-16 shrink-0 text-metal-400">reused</dt>
                            <dd className="text-metal-200 font-mono">
                                {reuse ? shortId(reuse.id) : '—'}
                                {reuse && (
                                    <span className="ml-2 font-sans text-metal-300">
                                        {outcomeGlyph(reuse.outcome)} {reuse.outcome ?? 'open'}
                                    </span>
                                )}
                            </dd>
                        </div>
                        <div className="flex gap-2">
                            <dt className="w-16 shrink-0 text-metal-400">evidence</dt>
                            <dd className="text-metal-200">{lesson.evidenceIds.length} record{lesson.evidenceIds.length === 1 ? '' : 's'}</dd>
                        </div>
                        {lesson.limits.length > 0 && (
                            <div className="flex gap-2">
                                <dt className="w-16 shrink-0 text-metal-400">limits</dt>
                                <dd className="text-metal-300 leading-snug">{lesson.limits.join(' ')}</dd>
                            </div>
                        )}
                    </dl>
                </div>
            </div>

            {lesson.status === 'qualified' && (
                <div className="mt-3 flex items-center gap-3">
                    <span className="text-xs text-metal-400 truncate">{approver || 'unnamed'}</span>
                    <button
                        onClick={() => onApprove(lesson)}
                        disabled={!open || busy || !approver}
                        title={!open ? 'Open the evidence first' : undefined}
                        className="tap ml-auto px-4 rounded-lg text-sm font-medium
                                   bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                                   transition-[background-color,transform,opacity] duration-200 ease-fluid
                                   md:hover:bg-[#33333a] active:scale-[0.98]
                                   disabled:opacity-35 disabled:active:scale-100 disabled:md:hover:bg-metal-700"
                    >
                        {busy ? 'Approving…' : 'Approve'}
                    </button>
                </div>
            )}

            {lesson.status === 'approved' && (
                <p className="mt-3 text-[11px] text-metal-400">
                    approved by {lesson.approvedBy ?? 'someone'}
                    {lesson.approvedByHumanAt ? ` · ${new Date(lesson.approvedByHumanAt).toLocaleDateString()}` : ''}
                </p>
            )}

            {/* A refusal is a legitimate answer to a legitimate question, not a fault. */}
            {refusal && <p className="mt-3 text-xs text-accent-soft leading-snug">{refusal}</p>}
        </div>
    );
};

/* ------------------------------------------------------------------- empty -- */

/** The emptiest screen has the most room, and arrives when there is time to read. */
const EmptyLadder: React.FC<{ episodes: number }> = ({ episodes }) => (
    <div className="py-8 text-center">
        <p className="text-sm text-metal-200">nothing learned yet</p>
        <p className="mt-4 mx-auto max-w-[15rem] text-xs text-metal-400 leading-relaxed">
            A failed build proposes a note. The next attempt tries it. If that one passes,
            the note reaches you for approval.
        </p>
        <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-metal-500">
            <span aria-hidden>○</span> proposed
            <span aria-hidden>→</span>
            <span aria-hidden>○</span> qualified
            <span aria-hidden>→</span>
            <span aria-hidden>○</span> approved
        </div>
        <p className="mt-5 text-[11px] text-metal-400">
            {episodes === 0 ? 'this build has not generated yet.' : `${episodes} episode${episodes === 1 ? '' : 's'} recorded so far.`}
        </p>
    </div>
);

/* ------------------------------------------------------------------- panel -- */

/**
 * On a phone the drawer is driven by the tab bar, which also needs to know
 * whether anything is waiting so it can show the dot. So the panel accepts an
 * optional controlled `open` and reports `needsYou` upward — rather than the
 * bar polling memory a second time for an answer this component already has.
 * With no props it stays exactly as it was: its own state, its own trigger.
 */
interface MemoryPanelProps {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onNeedsYouChange?: (needsYou: boolean) => void;
}

const MemoryPanel: React.FC<MemoryPanelProps> = ({ open: openProp, onOpenChange, onNeedsYouChange }) => {
    const { builderState } = useAppContext();
    const buildId = builderState.memory.buildId;

    const [openState, setOpenState] = useState(false);
    const open = openProp ?? openState;
    const setOpen = useCallback((next: boolean) => {
        setOpenState(next);
        onOpenChange?.(next);
    }, [onOpenChange]);
    const [state, setState] = useState<MemoryStateResponse | null>(null);
    const [approver, setApproverState] = useState(memoryService.getApprover);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [refusals, setRefusals] = useState<Record<string, string>>({});
    const closeRef = useRef<HTMLButtonElement>(null);

    const refresh = useCallback(async () => {
        setState(await memoryService.getState(buildId));
    }, [buildId]);

    useEffect(() => { void refresh(); }, [refresh]);

    // Polls slowly when shut — the dot is the only thing that matters then — and
    // not at all when the tab is hidden, because nobody is looking.
    useEffect(() => {
        const tick = () => { if (!document.hidden) void refresh(); };
        const id = window.setInterval(tick, open ? POLL_OPEN_MS : POLL_SHUT_MS);
        return () => window.clearInterval(id);
    }, [open, refresh]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        closeRef.current?.focus();
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    const lessons = state?.build?.lessons ?? [];
    const episodes = state?.build?.episodes ?? [];
    const awaiting = lessons.filter(l => l.status === 'qualified');
    const approved = lessons.filter(l => l.status === 'approved');
    const proposed = lessons.filter(l => l.status === 'proposed');
    const degraded = state !== null && state.health.available === false;

    // The glance test, computed once: is there anything on this screen that needs you?
    const needsYou = awaiting.length > 0 || degraded;

    useEffect(() => { onNeedsYouChange?.(needsYou); }, [needsYou, onNeedsYouChange]);

    const approve = async (lesson: Lesson) => {
        setBusyId(lesson.id);
        setRefusals(r => ({ ...r, [lesson.id]: '' }));
        const result = await memoryService.approveLesson(buildId, lesson.id, approver);
        setBusyId(null);
        if (result.ok) await refresh();
        else setRefusals(r => ({ ...r, [lesson.id]: result.message ?? 'Memory refused, without saying why.' }));
    };

    return (
        <>
            {/* Trigger — desktop only. On a phone the tab bar is the way in, and two
                ways in at the same corner is one too many. */}
            <button
                onClick={() => setOpen(true)}
                aria-label={needsYou ? 'Memory — something needs you' : 'Memory'}
                className="tap fixed bottom-4 right-4 z-40 hidden md:flex items-center gap-2 px-4 rounded-full
                           bg-metal-700 text-metal-100 text-sm font-medium
                           shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]
                           transition-[background-color,transform] duration-200 ease-fluid
                           md:hover:bg-[#33333a] active:scale-[0.98]"
                style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
            >
                {needsYou && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent" />}
                Memory
            </button>

            {/* Backdrop */}
            <div
                onClick={() => setOpen(false)}
                aria-hidden
                className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-320 ease-fluid
                            ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            />

            {/* Drawer — full sheet on phone, panel on desktop */}
            <aside
                role="dialog"
                aria-modal="true"
                aria-label="Memory"
                aria-hidden={!open}
                className={`fixed inset-y-0 right-0 z-50 w-full md:w-[26rem] flex flex-col
                            bg-surface shadow-[inset_1px_0_0_rgb(255_255_255/0.08)]
                            transition-transform duration-320 ease-fluid
                            ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}
            >
                <header className="safe-t flex items-center gap-3 px-5 pb-3">
                    <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-metal-300">Memory</h2>
                    {needsYou && <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent" />}
                    <button
                        ref={closeRef}
                        onClick={() => setOpen(false)}
                        aria-label="Close memory"
                        className="tap ml-auto -mr-2 text-metal-300 text-lg
                                   transition-colors duration-200 ease-fluid md:hover:text-metal-100"
                    >
                        <span aria-hidden>✕</span>
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto px-5 pb-6 safe-b space-y-6">
                    {/* Degraded — say what broke, then immediately what it did not break. */}
                    {degraded && (
                        <div className="rounded-card bg-raised p-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
                            <p className="flex items-center gap-2 text-sm text-metal-100">
                                <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                                memory unavailable
                            </p>
                            <p className="mt-2 text-xs text-metal-300 leading-relaxed">
                                The builder is unaffected — it is running unadvised.
                            </p>
                            {state?.health.reason && (
                                <p className="mt-2 text-[11px] text-metal-400 font-mono leading-snug break-words">
                                    {state.health.reason}
                                </p>
                            )}
                        </div>
                    )}

                    {!degraded && (
                        <>
                            {awaiting.length > 0 && (
                                <section>
                                    <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-3">
                                        <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent" />
                                        Awaiting you
                                        <span className="ml-auto font-mono text-metal-200 normal-case tracking-normal">{awaiting.length}</span>
                                    </h3>

                                    {!approver && (
                                        <label className="block mb-3">
                                            <span className="block text-[11px] text-metal-400 mb-1.5">
                                                The record names who approved. Yours is required once.
                                            </span>
                                            <input
                                                value={approver}
                                                onChange={e => setApproverState(e.target.value)}
                                                onBlur={e => memoryService.setApprover(e.target.value)}
                                                placeholder="your name"
                                                className="tap w-full px-3 rounded-lg bg-raised text-sm text-metal-100
                                                           placeholder:text-metal-500
                                                           shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
                                            />
                                        </label>
                                    )}

                                    <div className="space-y-3">
                                        {awaiting.map(lesson => (
                                            <LessonCard
                                                key={lesson.id}
                                                lesson={lesson}
                                                episodes={episodes}
                                                approver={approver}
                                                onApprove={approve}
                                                busy={busyId === lesson.id}
                                                refusal={refusals[lesson.id] || undefined}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {lessons.length === 0 && <EmptyLadder episodes={episodes.length} />}

                            {approved.length > 0 && (
                                <section>
                                    <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-3">
                                        Learned
                                        <span className="ml-2 font-mono text-metal-400 normal-case tracking-normal">{approved.length}</span>
                                    </h3>
                                    <div className="space-y-3">
                                        {approved.map(lesson => (
                                            <LessonCard key={lesson.id} lesson={lesson} episodes={episodes}
                                                approver={approver} onApprove={approve} busy={false} />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {proposed.length > 0 && (
                                <section>
                                    <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-3">
                                        Unproven
                                        <span className="ml-2 font-mono text-metal-400 normal-case tracking-normal">{proposed.length}</span>
                                    </h3>
                                    <p className="text-[11px] text-metal-400 mb-3 leading-relaxed">
                                        Written from a failure, and offered to the next attempt that hits the same
                                        thing. They reach you only if one of those attempts then passes.
                                    </p>
                                    <ul className="space-y-2">
                                        {proposed.map(lesson => (
                                            <li key={lesson.id} className="rounded-card bg-white/[0.04] p-3 text-xs text-metal-300 leading-snug">
                                                {lesson.trigger}
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}

                            {state?.build && (
                                <section className="pt-1">
                                    <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-3">This build</h3>
                                    <dl className="grid grid-cols-3 gap-3 text-center">
                                        {[
                                            ['episodes', episodes.length],
                                            ['events', state.build.eventCount],
                                            ['evidence', state.build.evidenceCount],
                                        ].map(([label, n]) => (
                                            <div key={label as string} className="rounded-card bg-white/[0.04] py-3">
                                                <dd className="font-mono text-lg text-metal-100">{n as number}</dd>
                                                <dt className="text-[11px] text-metal-400">{label as string}</dt>
                                            </div>
                                        ))}
                                    </dl>
                                    <p className="mt-3 text-[11px] text-metal-500 font-mono break-all">{state.build.buildId}</p>
                                </section>
                            )}
                        </>
                    )}

                    {state === null && (
                        <p className="py-8 text-center text-xs text-metal-400">reading memory…</p>
                    )}
                </div>
            </aside>
        </>
    );
};

export default MemoryPanel;
