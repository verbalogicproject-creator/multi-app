/**
 * The learning loop: fail -> propose -> trial -> pass -> QUALIFIED.
 *
 * Runs against the real bridge on a throwaway database, with no model and no HTTP
 * server, because none of the ladder needs either. It is the only proof that a
 * lesson can actually climb: every rung is enforced by the engine, and a change
 * that quietly breaks one would otherwise show up as memory simply never learning
 * anything -- which looks exactly like memory working and there being nothing to
 * learn.
 *
 *   npm run check:memory-loop
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'memory-loop-'));
process.env.MEMORY_DB_DIR = scratch;

const bridge = await import('../memory/bridge.js');
const proposals = await import('../memory/proposals.js');

let failures = 0;
const check = (label, ok, detail = '') => {
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};

const buildId = `build-step5-${Date.now().toString(36)}`;
const OBJECTIVE = 'generate Plant Tracker — style "Forest" / Sans-serif & Friendly';

// ---- attempt 1: it fails ------------------------------------------------------
const epi1 = await bridge.openEpisodeSafe({ buildId, objective: OBJECTIVE });
check('attempt 1 opens', Boolean(epi1));

const ev1 = await bridge.recordEvidenceSafe({
    buildId, kind: 'validation', ref: `build://${buildId}/episode/${epi1}/validation`,
    summary: 'Validation failed over 9 files: unresolved-import (src/App.tsx)',
});
const verdict1 = { ok: false, checked: 9, errors: 2, warnings: 1,
                   codes: { 'unresolved-import': 2, 'missing-src-main': 1 }, fileCount: 9 };
await bridge.appendEventSafe({
    buildId, episodeId: epi1, kind: 'verification.completed', domain: 'build',
    surface: 'builder.generate', payload: verdict1, evidenceIds: [ev1.id],
});

const proposed = await bridge.proposeLessonsSafe({
    buildId, episodeId: epi1, evidenceIds: [ev1.id], proposals: proposals.proposalsFor(verdict1),
});
check('a failed verdict proposes exactly the mapped lesson', proposed.length === 1, proposed.map(p => p.code).join(', '));
check('and it starts at the bottom of the ladder', proposed[0]?.status === 'proposed', proposed[0]?.status);
check('a warning-only code proposes nothing',
    !proposals.proposalsFor(verdict1).some(p => p.code === 'missing-src-main'));

// idempotency: the same failure again is the same lesson, not a second one
const again = await bridge.proposeLessonsSafe({
    buildId, episodeId: epi1, evidenceIds: [ev1.id], proposals: proposals.proposalsFor(verdict1),
});
check('proposing the same failure again returns the same lesson', again[0]?.lessonId === proposed[0]?.lessonId);

await bridge.closeEpisodeSafe({ buildId, episodeId: epi1, outcome: 'failed' });

// ---- the proposal must NOT be in the governed packet --------------------------
const governed = await bridge.recallBlock({ buildId, episodeId: epi1, task: 'generate a React application: Plant Tracker', domain: 'build' });
check('a proposed lesson is NOT in the engine\'s governed recall', !governed.includes('re-read every relative import'),
    governed ? `${governed.length} chars recalled` : 'nothing recalled');

// ---- attempt 2: the repair, which is where the proposal is tried --------------
const epi2 = await bridge.openEpisodeSafe({ buildId, objective: OBJECTIVE });
check('attempt 2 is a distinct episode', Boolean(epi2) && epi2 !== epi1);

const trial = await bridge.trialBlock({ buildId, episodeId: epi2 });
check('the trial block carries the proposal', trial.includes('re-read every relative import'), `${trial.length} chars`);
check('and says plainly that it is unproven', /have not yet been shown to help/.test(trial));
check('and is separate from the governed block', !trial.includes('Memory from earlier builds'));

const ev2 = await bridge.recordEvidenceSafe({
    buildId, kind: 'validation', ref: `build://${buildId}/episode/${epi2}/validation`,
    summary: 'Validation passed over 11 files.',
});
await bridge.appendEventSafe({
    buildId, episodeId: epi2, kind: 'verification.completed', domain: 'build',
    surface: 'builder.generate', payload: { ok: true, checked: 11, errors: 0, warnings: 0, codes: {}, fileCount: 11 },
    evidenceIds: [ev2.id],
});

// ---- the ratchet only turns after the episode closes verified -----------------
const tooEarly = await bridge.recordReuseSafe({ buildId, episodeId: epi2 });
check('reuse is refused while the episode is still open', tooEarly.length === 0);

await bridge.closeEpisodeSafe({ buildId, episodeId: epi2, outcome: 'verified' });
const qualified = await bridge.recordReuseSafe({ buildId, episodeId: epi2 });
check('a verified episode that applied it promotes it', qualified.length === 1, JSON.stringify(qualified));
check('to QUALIFIED', qualified[0]?.status === 'qualified', qualified[0]?.status);
check('with the reuse counted once', qualified[0]?.reuseCount === 1, String(qualified[0]?.reuseCount));

// ---- and NOW it is injectable -------------------------------------------------
const after = await bridge.recallBlock({ buildId, episodeId: epi2, task: 'generate a React application: Plant Tracker', domain: 'build' });
check('a qualified lesson IS in the governed recall', after.includes('re-read every relative import'), `${after.length} chars`);

// ---- the gate the engine keeps, not us ----------------------------------------
const state = await bridge.listBuildState(buildId);
const lesson = state.lessons.find(l => l.id === proposed[0].lessonId);
check('it is still not approved — that stays human-only', lesson?.status === 'qualified', lesson?.status);
check('and it carries the limits it was proposed with',
    lesson?.limits?.[0]?.startsWith('Observed on Vite + React'), lesson?.limits?.[0]);
check('and cites the evidence from both attempts', lesson?.evidenceIds?.length === 2, String(lesson?.evidenceIds?.length));

// ---- the trial is scoped to what actually broke, and self-limits --------------
const epi3 = await bridge.openEpisodeSafe({ buildId, objective: 'generate Plant Tracker — a third attempt' });
const ev3 = await bridge.recordEvidenceSafe({ buildId, kind: 'validation', ref: `build://${buildId}/e3/v`, summary: 'failed on something else' });
const other = { ok: false, checked: 4, errors: 1, warnings: 0, codes: { 'invalid-json': 1 } };
await bridge.appendEventSafe({ buildId, episodeId: epi3, kind: 'verification.completed', domain: 'build', payload: other, evidenceIds: [ev3.id] });
await bridge.proposeLessonsSafe({ buildId, episodeId: epi3, evidenceIds: [ev3.id], proposals: proposals.proposalsFor(other) });
await bridge.closeEpisodeSafe({ buildId, episodeId: epi3, outcome: 'failed' });

const epi4 = await bridge.openEpisodeSafe({ buildId, objective: 'generate Plant Tracker — a fourth attempt' });
const scoped = await bridge.trialBlock({ buildId, episodeId: epi4 });
check('the trial carries the note about what just broke', scoped.includes('Emit JSON strictly'));
check('and not the unrelated one from an older failure', !scoped.includes('re-read every relative import'),
    'a note that stopped being relevant stops being injected');

// ---- the seam: a type error is a lesson like any other ------------------------
// Stage 3's whole claim is that `tsc` is just another judge feeding the same
// ladder. This proves it with the code the compiler actually produces, rather
// than assuming the machinery generalises.
const tsBuild = 'build-typeerror';
const tsEpi1 = await bridge.openEpisodeSafe({ buildId: tsBuild, objective: 'generate Kanban — first attempt' });
const tsEv1 = await bridge.recordEvidenceSafe({ buildId: tsBuild, kind: 'validation', ref: `build://${tsBuild}/e1/v`, summary: 'TS2322 in src/App.tsx' });
const tsVerdict = { ok: false, checked: 6, errors: 1, warnings: 0, codes: { 'type-error': 1 } };
const tsProposals = proposals.proposalsFor(tsVerdict);
const tsProposed = await bridge.proposeLessonsSafe({
    buildId: tsBuild, episodeId: tsEpi1, evidenceIds: [tsEv1.id], proposals: tsProposals,
});
check('a type error proposes a lesson', tsProposed?.length === 1, JSON.stringify(tsProposed?.map(p => p.code)));
// The proposal, not the stored record: what a model is told is the recommendation
// text, and it has to say something actionable rather than name the failure again.
check('and it is guidance a model can act on', tsProposals[0]?.recommendation?.includes('type-check'),
    tsProposals[0]?.recommendation?.slice(0, 60));

await bridge.appendEventSafe({ buildId: tsBuild, episodeId: tsEpi1, kind: 'verification.completed', domain: 'build', payload: tsVerdict, evidenceIds: [tsEv1.id] });
await bridge.closeEpisodeSafe({ buildId: tsBuild, episodeId: tsEpi1, outcome: 'failed' });

// The next attempt is told about it, in the block reserved for the unproven.
const tsEpi2 = await bridge.openEpisodeSafe({ buildId: tsBuild, objective: 'generate Kanban — second attempt' });
const tsTrial = await bridge.trialBlock({ buildId: tsBuild, episodeId: tsEpi2 });
check('the next attempt trials it', tsTrial.includes('type-check'), tsTrial.slice(0, 80));

// And a passing attempt promotes it — the ratchet is on the close, not the verdict.
const tsEv2 = await bridge.recordEvidenceSafe({ buildId: tsBuild, kind: 'validation', ref: `build://${tsBuild}/e2/v`, summary: 'types clean over 6 files' });
await bridge.appendEventSafe({ buildId: tsBuild, episodeId: tsEpi2, kind: 'verification.completed', domain: 'build', payload: { ok: true, checked: 6, errors: 0, warnings: 0, codes: {} }, evidenceIds: [tsEv2.id] });
await bridge.closeEpisodeSafe({ buildId: tsBuild, episodeId: tsEpi2, outcome: 'verified' });
await bridge.recordReuseSafe({ buildId: tsBuild, episodeId: tsEpi2 });

const tsState = await bridge.listBuildState(tsBuild);
const tsLesson = tsState.lessons.find(l => l.id === tsProposed[0].lessonId);
check('a passing attempt qualifies it', tsLesson?.status === 'qualified', tsLesson?.status);

// ---- independence: the property the whole ladder rests on ---------------------
// A lesson may only be promoted by an episode that did NOT propose it. Without
// that, a single failing-then-passing attempt would certify its own guesses, and
// "qualified" would mean nothing more than "it was tried once".
//
// This was verified by hand and protected by nothing, which is the same as not
// being true: the engine enforces it today, and a change to the engine or to
// `recordReuseSafe` would retire the guarantee in silence.
const selfBuild = 'build-self-qualify';
const selfEpi = await bridge.openEpisodeSafe({ buildId: selfBuild, objective: 'one episode, fail then pass' });
const selfEv1 = await bridge.recordEvidenceSafe({ buildId: selfBuild, kind: 'validation', ref: `build://${selfBuild}/e1/v`, summary: 'failed' });
const selfBad = { ok: false, checked: 3, errors: 1, warnings: 0, codes: { 'unresolved-import': 1 } };
await bridge.appendEventSafe({ buildId: selfBuild, episodeId: selfEpi, kind: 'verification.completed', domain: 'build', payload: selfBad, evidenceIds: [selfEv1.id] });
const selfProposed = await bridge.proposeLessonsSafe({
    buildId: selfBuild, episodeId: selfEpi, evidenceIds: [selfEv1.id], proposals: proposals.proposalsFor(selfBad),
});
check('an episode proposes a lesson', selfProposed.length === 1);

// The same episode now succeeds and closes verified — the strongest case it has.
const selfEv2 = await bridge.recordEvidenceSafe({ buildId: selfBuild, kind: 'validation', ref: `build://${selfBuild}/e1/v2`, summary: 'passed' });
await bridge.appendEventSafe({ buildId: selfBuild, episodeId: selfEpi, kind: 'verification.completed', domain: 'build', payload: { ok: true, checked: 3, errors: 0, warnings: 0, codes: {} }, evidenceIds: [selfEv2.id] });
await bridge.closeEpisodeSafe({ buildId: selfBuild, episodeId: selfEpi, outcome: 'verified' });
const selfQualified = await bridge.recordReuseSafe({ buildId: selfBuild, episodeId: selfEpi });

const selfState = await bridge.listBuildState(selfBuild);
const selfLesson = selfState.lessons.find(l => l.id === selfProposed[0]?.lessonId);
check('and cannot promote it by passing itself', selfQualified.length === 0, JSON.stringify(selfQualified));
check('so it is still only proposed', selfLesson?.status === 'proposed', selfLesson?.status);

bridge.closeAll();
rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? '\nTHE LOOP CLOSES' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
