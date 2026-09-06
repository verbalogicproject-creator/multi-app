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
 * **One linear scenario, not independent tests.** Memory is one shared store now, on
 * purpose — that is what lets a lesson outlive the build that proposed it, and every
 * later step here depends on state an earlier step left behind (the same episode ids,
 * the same proposed lesson ids). So the whole scenario runs once, in order, inside
 * `beforeAll`, with every intermediate value captured; each `it()` below only reads
 * from that captured state; splitting it into independently-runnable tests would be
 * dishonest about the dependency, not a cleanup of it. **Give each build/section a
 * validator code no other one uses** — a lesson id is a content hash of its trigger,
 * so two sections sharing a code would see each other's promotions and a broken
 * assertion could still read "qualified" for the wrong reason.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'memory-loop-'));
process.env.MEMORY_DB_DIR = scratch;

const bridge = await import('../memory/bridge.js');
const proposals = await import('../memory/proposals.js');

const s = {};

beforeAll(async () => {
    const buildId = `build-step5-${Date.now().toString(36)}`;
    const OBJECTIVE = 'generate Plant Tracker — style "Forest" / Sans-serif & Friendly';

    // ---- attempt 1: it fails --------------------------------------------------
    s.epi1 = await bridge.openEpisodeSafe({ buildId, objective: OBJECTIVE });

    const ev1 = await bridge.recordEvidenceSafe({
        buildId, kind: 'validation', ref: `build://${buildId}/episode/${s.epi1}/validation`,
        summary: 'Validation failed over 9 files: unresolved-import (src/App.tsx)',
    });
    const verdict1 = { ok: false, checked: 9, errors: 2, warnings: 1,
                       codes: { 'unresolved-import': 2, 'missing-src-main': 1 }, fileCount: 9 };
    await bridge.appendEventSafe({
        buildId, episodeId: s.epi1, kind: 'verification.completed', domain: 'build',
        surface: 'builder.generate', payload: verdict1, evidenceIds: [ev1.id],
    });

    s.proposed = await bridge.proposeLessonsSafe({
        buildId, episodeId: s.epi1, evidenceIds: [ev1.id], proposals: proposals.proposalsFor(verdict1),
    });
    s.warningOnlyProposals = proposals.proposalsFor(verdict1);

    // idempotency: the same failure again is the same lesson, not a second one
    s.again = await bridge.proposeLessonsSafe({
        buildId, episodeId: s.epi1, evidenceIds: [ev1.id], proposals: proposals.proposalsFor(verdict1),
    });

    await bridge.closeEpisodeSafe({ buildId, episodeId: s.epi1, outcome: 'failed' });

    // ---- the proposal must NOT be in the governed packet ----------------------
    s.governed = await bridge.recallBlock({ buildId, episodeId: s.epi1, task: 'generate a React application: Plant Tracker', domain: 'build' });

    // ---- attempt 2: the repair, which is where the proposal is tried ----------
    s.epi2 = await bridge.openEpisodeSafe({ buildId, objective: OBJECTIVE });
    s.buildId = buildId;

    s.trial = await bridge.trialBlock({ buildId, episodeId: s.epi2 });

    const ev2 = await bridge.recordEvidenceSafe({
        buildId, kind: 'validation', ref: `build://${buildId}/episode/${s.epi2}/validation`,
        summary: 'Validation passed over 11 files.',
    });
    await bridge.appendEventSafe({
        buildId, episodeId: s.epi2, kind: 'verification.completed', domain: 'build',
        surface: 'builder.generate', payload: { ok: true, checked: 11, errors: 0, warnings: 0, codes: {}, fileCount: 11 },
        evidenceIds: [ev2.id],
    });

    // ---- the ratchet only turns after the episode closes verified -------------
    s.tooEarly = await bridge.recordReuseSafe({ buildId, episodeId: s.epi2 });

    await bridge.closeEpisodeSafe({ buildId, episodeId: s.epi2, outcome: 'verified' });
    s.qualified = await bridge.recordReuseSafe({ buildId, episodeId: s.epi2 });

    // ---- and NOW it is injectable ----------------------------------------------
    s.after = await bridge.recallBlock({ buildId, episodeId: s.epi2, task: 'generate a React application: Plant Tracker', domain: 'build' });

    // ---- the gate the engine keeps, not us -------------------------------------
    const state = await bridge.listBuildState(buildId);
    s.lesson = state.lessons.find(l => l.id === s.proposed[0].lessonId);

    // ---- the trial is scoped to what actually broke, and self-limits ----------
    const epi3 = await bridge.openEpisodeSafe({ buildId, objective: 'generate Plant Tracker — a third attempt' });
    const ev3 = await bridge.recordEvidenceSafe({ buildId, kind: 'validation', ref: `build://${buildId}/e3/v`, summary: 'failed on something else' });
    const other = { ok: false, checked: 4, errors: 1, warnings: 0, codes: { 'invalid-json': 1 } };
    await bridge.appendEventSafe({ buildId, episodeId: epi3, kind: 'verification.completed', domain: 'build', payload: other, evidenceIds: [ev3.id] });
    await bridge.proposeLessonsSafe({ buildId, episodeId: epi3, evidenceIds: [ev3.id], proposals: proposals.proposalsFor(other) });
    await bridge.closeEpisodeSafe({ buildId, episodeId: epi3, outcome: 'failed' });

    const epi4 = await bridge.openEpisodeSafe({ buildId, objective: 'generate Plant Tracker — a fourth attempt' });
    s.scoped = await bridge.trialBlock({ buildId, episodeId: epi4 });

    // ---- the seam: a type error is a lesson like any other ---------------------
    // Stage 3's whole claim is that `tsc` is just another judge feeding the same
    // ladder. This proves it with the code the compiler actually produces, rather
    // than assuming the machinery generalises.
    const tsBuild = 'build-typeerror';
    const tsEpi1 = await bridge.openEpisodeSafe({ buildId: tsBuild, objective: 'generate Kanban — first attempt' });
    const tsEv1 = await bridge.recordEvidenceSafe({ buildId: tsBuild, kind: 'validation', ref: `build://${tsBuild}/e1/v`, summary: 'TS2322 in src/App.tsx' });
    const tsVerdict = { ok: false, checked: 6, errors: 1, warnings: 0, codes: { 'type-error': 1 } };
    s.tsProposals = proposals.proposalsFor(tsVerdict);
    s.tsProposed = await bridge.proposeLessonsSafe({
        buildId: tsBuild, episodeId: tsEpi1, evidenceIds: [tsEv1.id], proposals: s.tsProposals,
    });

    await bridge.appendEventSafe({ buildId: tsBuild, episodeId: tsEpi1, kind: 'verification.completed', domain: 'build', payload: tsVerdict, evidenceIds: [tsEv1.id] });
    await bridge.closeEpisodeSafe({ buildId: tsBuild, episodeId: tsEpi1, outcome: 'failed' });

    // The next attempt is told about it, in the block reserved for the unproven.
    const tsEpi2 = await bridge.openEpisodeSafe({ buildId: tsBuild, objective: 'generate Kanban — second attempt' });
    s.tsTrial = await bridge.trialBlock({ buildId: tsBuild, episodeId: tsEpi2 });

    // And a passing attempt promotes it — the ratchet is on the close, not the verdict.
    const tsEv2 = await bridge.recordEvidenceSafe({ buildId: tsBuild, kind: 'validation', ref: `build://${tsBuild}/e2/v`, summary: 'types clean over 6 files' });
    await bridge.appendEventSafe({ buildId: tsBuild, episodeId: tsEpi2, kind: 'verification.completed', domain: 'build', payload: { ok: true, checked: 6, errors: 0, warnings: 0, codes: {} }, evidenceIds: [tsEv2.id] });
    await bridge.closeEpisodeSafe({ buildId: tsBuild, episodeId: tsEpi2, outcome: 'verified' });
    await bridge.recordReuseSafe({ buildId: tsBuild, episodeId: tsEpi2 });

    const tsState = await bridge.listBuildState(tsBuild);
    s.tsLesson = tsState.lessons.find(l => l.id === s.tsProposed[0].lessonId);

    // ---- the ladder learns from behaviour, not only from text ------------------
    // Every earlier judge reads the code. These two come from running it, and were
    // impossible to observe before the preview could execute a build at all: an app
    // that type-checks, bundles, and mounts a blank page passed every check there was.
    const behaveBuild = 'build-behaviour';
    const behaveEpi = await bridge.openEpisodeSafe({ buildId: behaveBuild, objective: 'generate Tide Clock' });
    const behaveEv = await bridge.recordEvidenceSafe({
        buildId: behaveBuild, kind: 'validation', ref: `build://${behaveBuild}/e1/v`,
        summary: 'built and ran; mounted nothing',
    });
    const behaveVerdict = { ok: false, checked: 12, errors: 1, warnings: 0, codes: { 'renders-nothing': 1 } };
    s.behaveProposals = proposals.proposalsFor(behaveVerdict);
    s.threwProposals = proposals.proposalsFor({ ok: false, checked: 12, errors: 1, warnings: 0, codes: { 'runtime-error': 1 } });

    await bridge.appendEventSafe({
        buildId: behaveBuild, episodeId: behaveEpi, kind: 'verification.completed', domain: 'build',
        surface: 'builder.generate', payload: behaveVerdict, evidenceIds: [behaveEv.id],
    });
    const behaveProposed = await bridge.proposeLessonsSafe({
        buildId: behaveBuild, episodeId: behaveEpi, evidenceIds: [behaveEv.id], proposals: s.behaveProposals,
    });
    await bridge.closeEpisodeSafe({ buildId: behaveBuild, episodeId: behaveEpi, outcome: 'failed' });

    const behaveEpi2 = await bridge.openEpisodeSafe({ buildId: behaveBuild, objective: 'generate Tide Clock — again' });
    s.behaveTrial = await bridge.trialBlock({ buildId: behaveBuild, episodeId: behaveEpi2 });

    const behaveEv2 = await bridge.recordEvidenceSafe({ buildId: behaveBuild, kind: 'validation', ref: `build://${behaveBuild}/e2/v`, summary: 'renders' });
    await bridge.appendEventSafe({
        buildId: behaveBuild, episodeId: behaveEpi2, kind: 'verification.completed', domain: 'build',
        payload: { ok: true, checked: 12, errors: 0, warnings: 0, codes: {} }, evidenceIds: [behaveEv2.id],
    });
    await bridge.closeEpisodeSafe({ buildId: behaveBuild, episodeId: behaveEpi2, outcome: 'verified' });
    await bridge.recordReuseSafe({ buildId: behaveBuild, episodeId: behaveEpi2 });
    const behaveState = await bridge.listBuildState(behaveBuild);
    s.behaveLesson = behaveState.lessons.find(l => l.id === behaveProposed[0]?.lessonId);

    // ---- independence: the property the whole ladder rests on -----------------
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
    /* A code no other section uses, so this lesson is this section's alone. */
    const selfBad = { ok: false, checked: 3, errors: 1, warnings: 0, codes: { 'bundle-error': 1 } };
    await bridge.appendEventSafe({ buildId: selfBuild, episodeId: selfEpi, kind: 'verification.completed', domain: 'build', payload: selfBad, evidenceIds: [selfEv1.id] });
    s.selfProposed = await bridge.proposeLessonsSafe({
        buildId: selfBuild, episodeId: selfEpi, evidenceIds: [selfEv1.id], proposals: proposals.proposalsFor(selfBad),
    });

    // The same episode now succeeds and closes verified — the strongest case it has.
    const selfEv2 = await bridge.recordEvidenceSafe({ buildId: selfBuild, kind: 'validation', ref: `build://${selfBuild}/e1/v2`, summary: 'passed' });
    await bridge.appendEventSafe({ buildId: selfBuild, episodeId: selfEpi, kind: 'verification.completed', domain: 'build', payload: { ok: true, checked: 3, errors: 0, warnings: 0, codes: {} }, evidenceIds: [selfEv2.id] });
    await bridge.closeEpisodeSafe({ buildId: selfBuild, episodeId: selfEpi, outcome: 'verified' });
    s.selfQualified = await bridge.recordReuseSafe({ buildId: selfBuild, episodeId: selfEpi });

    const selfState = await bridge.listBuildState(selfBuild);
    s.selfLesson = selfState.lessons.find(l => l.id === s.selfProposed[0]?.lessonId);

    // ---- the loop crosses builds, or it is not a loop --------------------------
    // The property everything else rests on, and the one nothing ever asserted.
    //
    // The store used to be a file per build, with the engine's `projectId` set to the
    // build id — and every read in the engine filters on `project_id`. So a lesson
    // learned in one build was invisible to the next, and the ladder was wired to a
    // store that was discarded after every build. Nothing here failed, because every
    // section above uses a single build id: the loop closed perfectly inside one
    // build and could not reach the next one.
    //
    // Presence before absence. First that a lesson from an *earlier* build is visible
    // while a later one runs, then that a build's own episodes and events stay
    // attributable to it — otherwise "memory is shared" and "memory has stopped
    // distinguishing builds" look identical from here.
    const buildA = `build-cross-a-${Date.now().toString(36)}`;
    const buildB = `build-cross-b-${Date.now().toString(36)}`;

    const aEpi = await bridge.openEpisodeSafe({ buildId: buildA, objective: 'first build, which fails' });
    const aEv = await bridge.recordEvidenceSafe({ buildId: buildA, kind: 'validation', ref: `build://${buildA}/v`, summary: 'failed' });
    /* Likewise unique: if another section had already proposed this lesson, "build B
       can see it" would pass without anything having crossed a build at all. */
    const aBad = { ok: false, checked: 4, errors: 1, warnings: 0, codes: { 'unresolved-html-ref': 1 } };
    await bridge.appendEventSafe({ buildId: buildA, episodeId: aEpi, kind: 'verification.completed', domain: 'build', payload: aBad, evidenceIds: [aEv.id] });
    s.aProposed = await bridge.proposeLessonsSafe({
        buildId: buildA, episodeId: aEpi, evidenceIds: [aEv.id], proposals: proposals.proposalsFor(aBad),
    });

    s.bState = await bridge.listBuildState(buildB);
    s.carried = s.bState?.lessons?.some(l => l.id === s.aProposed[0]?.lessonId);

    // The other half: sharing lessons must not mean losing track of whose build is whose.
    const bEpi = await bridge.openEpisodeSafe({ buildId: buildB, objective: 'second build' });
    s.bEpi = bEpi;
    s.aEpi = aEpi;
    s.bAfter = await bridge.listBuildState(buildB);
    s.aAfter = await bridge.listBuildState(buildA);
});

afterAll(() => {
    bridge.closeAll();
    rmSync(scratch, { recursive: true, force: true });
});

describe('attempt 1: it fails', () => {
    it('attempt 1 opens', () => { expect(Boolean(s.epi1)).toBe(true); });
    it('a failed verdict proposes exactly the mapped lesson', () => {
        expect(s.proposed.length, s.proposed.map(p => p.code).join(', ')).toBe(1);
    });
    it('and it starts at the bottom of the ladder', () => { expect(s.proposed[0]?.status, s.proposed[0]?.status).toBe('proposed'); });
    it('a warning-only code proposes nothing', () => {
        expect(s.warningOnlyProposals.some(p => p.code === 'missing-src-main')).toBe(false);
    });
    it('proposing the same failure again returns the same lesson', () => {
        expect(s.again[0]?.lessonId).toBe(s.proposed[0]?.lessonId);
    });
});

describe('the proposal must NOT be in the governed packet', () => {
    it("a proposed lesson is NOT in the engine's governed recall", () => {
        expect(!s.governed.includes('re-read every relative import'), s.governed ? `${s.governed.length} chars recalled` : 'nothing recalled').toBe(true);
    });
});

describe('attempt 2: the repair, which is where the proposal is tried', () => {
    it('attempt 2 is a distinct episode', () => { expect(Boolean(s.epi2) && s.epi2 !== s.epi1).toBe(true); });
    it('the trial block carries the proposal', () => { expect(s.trial.includes('re-read every relative import'), `${s.trial.length} chars`).toBe(true); });
    it('and says plainly that it is unproven', () => { expect(/have not yet been shown to help/.test(s.trial)).toBe(true); });
    it('and is separate from the governed block', () => { expect(!s.trial.includes('Memory from earlier builds')).toBe(true); });
});

describe('the ratchet only turns after the episode closes verified', () => {
    it('reuse is refused while the episode is still open', () => { expect(s.tooEarly.length).toBe(0); });
    it('a verified episode that applied it promotes it', () => { expect(s.qualified.length, JSON.stringify(s.qualified)).toBe(1); });
    it('to QUALIFIED', () => { expect(s.qualified[0]?.status, s.qualified[0]?.status).toBe('qualified'); });
    it('with the reuse counted once', () => { expect(String(s.qualified[0]?.reuseCount)).toBe('1'); });
});

describe('and NOW it is injectable', () => {
    it('a qualified lesson IS in the governed recall', () => {
        expect(s.after.includes('re-read every relative import'), `${s.after.length} chars`).toBe(true);
    });
});

describe('the gate the engine keeps, not us', () => {
    it('it is still not approved — that stays human-only', () => { expect(s.lesson?.status, s.lesson?.status).toBe('qualified'); });
    it('and it carries the limits it was proposed with', () => {
        expect(s.lesson?.limits?.[0]?.startsWith('Observed on Vite + React'), s.lesson?.limits?.[0]).toBe(true);
    });
    it('and cites the evidence from both attempts', () => { expect(String(s.lesson?.evidenceIds?.length)).toBe('2'); });
});

describe('the trial is scoped to what actually broke, and self-limits', () => {
    it('the trial carries the note about what just broke', () => { expect(s.scoped.includes('Emit JSON strictly')).toBe(true); });
    it('and not the unrelated one from an older failure', () => {
        expect(!s.scoped.includes('re-read every relative import'), 'a note that stopped being relevant stops being injected').toBe(true);
    });
});

describe('the seam: a type error is a lesson like any other', () => {
    it('a type error proposes a lesson', () => { expect(s.tsProposed?.length, JSON.stringify(s.tsProposed?.map(p => p.code))).toBe(1); });
    it('and it is guidance a model can act on', () => {
        expect(s.tsProposals[0]?.recommendation?.includes('type-check'), s.tsProposals[0]?.recommendation?.slice(0, 60)).toBe(true);
    });
    it('the next attempt trials it', () => { expect(s.tsTrial.includes('type-check'), s.tsTrial.slice(0, 80)).toBe(true); });
    it('a passing attempt qualifies it', () => { expect(s.tsLesson?.status, s.tsLesson?.status).toBe('qualified'); });
});

describe('the ladder learns from behaviour, not only from text', () => {
    it('an app that renders nothing proposes a lesson', () => {
        expect(s.behaveProposals.length, JSON.stringify(s.behaveProposals.map(p => p.code))).toBe(1);
    });
    it('and it is about mounting, not about types', () => {
        expect(/mount|createRoot|route/i.test(s.behaveProposals[0]?.recommendation ?? ''), s.behaveProposals[0]?.recommendation?.slice(0, 60)).toBe(true);
    });
    it('an app that threw proposes a different lesson', () => { expect(s.threwProposals[0]?.code).toBe('runtime-error'); });
    it('and it is about guarding values a render can meet', () => {
        expect(/guard|absent|initial value|undefined/i.test(s.threwProposals[0]?.recommendation ?? ''), s.threwProposals[0]?.recommendation?.slice(0, 60)).toBe(true);
    });
    it('the next attempt is told about it', () => { expect(/mount|createRoot/i.test(s.behaveTrial), s.behaveTrial.slice(0, 70)).toBe(true); });
    it('and an app that renders promotes it', () => { expect(s.behaveLesson?.status, s.behaveLesson?.status).toBe('qualified'); });
});

describe('independence: the property the whole ladder rests on', () => {
    it('an episode proposes a lesson', () => { expect(s.selfProposed.length).toBe(1); });
    it('and cannot promote it by passing itself', () => { expect(s.selfQualified.length, JSON.stringify(s.selfQualified)).toBe(0); });
    it('so it is still only proposed', () => { expect(s.selfLesson?.status, s.selfLesson?.status).toBe('proposed'); });
});

describe('the loop crosses builds, or it is not a loop', () => {
    it('an earlier build proposes a lesson', () => { expect(s.aProposed.length >= 1).toBe(true); });
    it('and a later build can see it', () => {
        expect(s.carried, `build B sees ${s.bState?.lessons?.length ?? 0} lesson(s)`).toBe(true);
    });
    it('a build sees its own episode', () => { expect(s.bAfter.episodes.some(e => e.id === s.bEpi)).toBe(true); });
    it("and not the other build's", () => {
        expect(!s.bAfter.episodes.some(e => e.id === s.aEpi), `build B lists ${s.bAfter.episodes.length} episode(s)`).toBe(true);
    });
    it('which still belongs to the build that opened it', () => { expect(s.aAfter.episodes.some(e => e.id === s.aEpi)).toBe(true); });
});
