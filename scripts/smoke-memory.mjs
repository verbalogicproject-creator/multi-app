/**
 * The memory loop end to end, over HTTP, against a real server process.
 *
 * `check:memory-loop` proves the ladder against the bridge in one process. This
 * proves the parts that only exist when there IS a process: the engine's dist
 * build being importable by plain JavaScript, the routes, recall actually reaching
 * an outgoing prompt, the direction bar, survival across a restart, and the CLI
 * reading the same databases the server just wrote.
 *
 * **It spends nothing.** The server is started with a deliberately invalid
 * provider key, so every builder call fails at the model — which is exactly the
 * proof wanted, because recall runs *before* the model and leaves its receipt
 * behind either way. A builder route that succeeded here would prove less.
 *
 *   npm run smoke:memory
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = resolve(APP, '..', 'multi-graph-memory');

let failures = 0;
const pass = (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const fail = (m) => { console.log(`  \x1b[31m✘\x1b[0m ${m}`); failures++; };
const check = (m, ok, detail = '') => (ok ? pass(detail ? `${m} — ${detail}` : m) : fail(detail ? `${m} — ${detail}` : m));

const scratch = mkdtempSync(join(tmpdir(), 'smoke-memory-'));
const BUILD = 'build-smoke-0001';
let server = null;

const freePort = () => new Promise((done) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => done(port));
    });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(port) {
    const child = spawn('node', ['server.js'], {
        cwd: APP,
        env: {
            ...process.env,
            PORT: String(port),
            MEMORY_DB_DIR: scratch,
            // Present so the server boots, invalid so nothing can be spent. dotenv
            // does not override an env var that is already set, so .env.local
            // cannot quietly put a real key back.
            GEMINI_API_KEY: 'smoke-memory-deliberately-invalid',
            ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', NVIDIA_API_KEY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });

    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/healthz`);
            if (r.ok) return { child, log: () => log };
        } catch { /* not up yet */ }
        await wait(500);
    }
    throw new Error(`server did not come up in 30s:\n${log}`);
}

const stopServer = async (handle) => {
    if (!handle) return;
    handle.child.kill('SIGTERM');
    await wait(500);
};

try {
    // ---- 1. the engine must be buildable, because a host cannot strip types ----
    console.log('\n=== engine dist ===');
    execFileSync('npm', ['run', 'build'], { cwd: ENGINE, stdio: 'pipe' });
    pass('engine dist built');

    // ---- 2. seed, in-process, before anything else holds the databases --------
    // Two qualified lessons: one about building, one about taste. The taste one is
    // the whole point of the direction-bar assertion further down — without it,
    // "no taste lesson was injected" would pass by there being none to inject.
    console.log('\n=== seed ===');
    process.env.MEMORY_DB_DIR = scratch;
    const bridge = await import(join(APP, 'memory/bridge.js'));

    const seedLesson = async ({ trigger, recommendation, domain, scope }) => {
        const a = await bridge.openEpisodeSafe({ buildId: BUILD, objective: `seed ${domain} failure` });
        const ea = await bridge.recordEvidenceSafe({ buildId: BUILD, kind: 'validation', ref: `seed://${domain}/a` });
        const [proposed] = await bridge.proposeLessonsSafe({
            buildId: BUILD, episodeId: a, evidenceIds: [ea.id],
            proposals: [{ trigger, recommendation, scope, domain, limits: ['Seeded by the smoke test.'], triggerTags: ['smoke'] }],
        });
        await bridge.closeEpisodeSafe({ buildId: BUILD, episodeId: a, outcome: 'failed' });

        const b = await bridge.openEpisodeSafe({ buildId: BUILD, objective: `seed ${domain} repair` });
        await bridge.recordAppliedLessonSafe({ buildId: BUILD, episodeId: b, lessonId: proposed.lessonId });
        const eb = await bridge.recordEvidenceSafe({ buildId: BUILD, kind: 'validation', ref: `seed://${domain}/b` });
        await bridge.appendEventSafe({
            buildId: BUILD, episodeId: b, kind: 'verification.completed', domain: 'build',
            payload: { ok: true, checked: 3, errors: 0, warnings: 0, codes: {} }, evidenceIds: [eb.id],
        });
        await bridge.closeEpisodeSafe({ buildId: BUILD, episodeId: b, outcome: 'verified' });
        const [qualified] = await bridge.recordReuseSafe({ buildId: BUILD, episodeId: b });
        return { lessonId: proposed.lessonId, status: qualified?.status };
    };

    const buildLesson = await seedLesson({
        trigger: 'SMOKE-BUILD-TRIGGER: a generated file imports something that was never emitted',
        recommendation: 'SMOKE-BUILD-RECOMMENDATION: check every relative import resolves.',
        domain: 'build',
        scope: ['build', 'generate', 'imports', 'plant tracker'],
    });
    const tasteLesson = await seedLesson({
        trigger: 'SMOKE-TASTE-TRIGGER: the last three builds all chose the same palette',
        recommendation: 'SMOKE-TASTE-RECOMMENDATION: vary the palette between builds.',
        domain: 'art-direction',
        // Deliberately worded to match an art-directions task. The bar has to
        // exclude a lesson that would otherwise have been recalled -- excluding one
        // that would never have ranked proves nothing.
        scope: ['art directions', 'palette', 'plant tracker', 'visual'],
    });
    check('a build lesson reached qualified', buildLesson.status === 'qualified', buildLesson.status);
    check('a taste lesson reached qualified', tasteLesson.status === 'qualified', tasteLesson.status);
    bridge.closeAll();

    // ---- 3. the server, on a free port, over a scratch database ---------------
    console.log('\n=== server ===');
    const port = await freePort();
    const BASE = `http://127.0.0.1:${port}`;
    server = await startServer(port);
    pass(`server up on ${port}`);
    check('and it says which databases it will write to', server.log().includes(scratch),
        server.log().split('\n').find((l) => l.startsWith('Memory databases')) ?? '(not printed)');

    const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
    const state = async () => (await fetch(`${BASE}/api/memory/state?buildId=${BUILD}`)).json();

    const health = await state();
    check('memory reports itself available', health.health?.available === true, health.health?.reason ?? '');
    check('over the dist build, from plain JavaScript', health.health?.databaseDir === scratch);

    // ---- 4. the loop, over HTTP ----------------------------------------------
    console.log('\n=== loop ===');
    const e1 = (await post('/api/memory/episodes/open', { buildId: BUILD, objective: 'smoke attempt 1' })).episodeId;
    check('an episode opens', Boolean(e1));

    const failed = await post('/api/memory/events', {
        buildId: BUILD, episodeId: e1,
        events: [{
            kind: 'verification.completed', domain: 'build', surface: 'builder.generate',
            provider: 'google', model: 'gemini-3.7-flash',
            payload: { ok: false, checked: 9, errors: 1, warnings: 0, codes: { 'invalid-json': 1 } },
            evidenceKeys: ['v'],
        }],
        evidence: [{ key: 'v', kind: 'validation', ref: `build://${BUILD}/e1/validation`, summary: 'package.json does not parse' }],
    });
    check('a failing verdict is recorded', failed.accepted === 1, JSON.stringify(failed.rejected ?? []));
    check('and proposes the lesson its issue code maps to', failed.proposed?.length === 1,
        failed.proposed?.[0]?.code ?? 'none');

    const bad = await post('/api/memory/events', { buildId: BUILD, events: [{ kind: 'verification.completed', domain: 'not-a-domain', payload: {} }] });
    check('an undeclared domain is refused with the engine\'s own reason',
        /domain/.test(bad.rejected?.[0]?.reason ?? ''), (bad.rejected?.[0]?.reason ?? '').slice(0, 80));

    await post('/api/memory/episodes/close', { buildId: BUILD, episodeId: e1, outcome: 'failed', provider: 'google', model: 'gemini-3.7-flash' });

    // ---- 5. recall reached the outgoing prompt --------------------------------
    // The call fails at the model, deliberately. Recall runs first and leaves a
    // receipt, which is what is being proven: memory is upstream of the provider.
    console.log('\n=== injection ===');
    const plan = await post('/api/builder/plan', { idea: 'a plant tracker', buildId: BUILD, episodeId: e1 });
    check('the builder call failed at the model, as intended', Boolean(plan?.message),
        String(plan?.message ?? '(it succeeded — a real key leaked into the smoke)').slice(0, 60));

    const afterPlan = (await state()).health?.lastInjection;
    check('recall ran before the model and left a receipt', Boolean(afterPlan), JSON.stringify(afterPlan?.itemCount));
    check('it injected something, not nothing', (afterPlan?.itemCount ?? 0) > 0, String(afterPlan?.itemCount));
    check('including the taste lesson, since planning is not direction generation',
        (afterPlan?.domains ?? []).includes('art-direction'), (afterPlan?.domains ?? []).join(', '));

    // ---- 6. the direction bar -------------------------------------------------
    // A controlled comparison: the same task and the same corpus, differing only in
    // the flag. Asserting "no taste lesson was recalled" on its own would pass just
    // as happily when nothing was recalled at all -- and it did, the first time this
    // was written, because a packet with no items leaves no receipt behind.
    console.log('\n=== direction bar ===');
    await post('/api/builder/directions', { idea: 'a plant tracker', plan: { projectName: 'Plant Tracker' }, buildId: BUILD, episodeId: e1 });
    const afterDirections = (await state()).health?.lastInjection;
    check('a directions turn injected no taste lesson',
        !(afterDirections?.surface === 'builder.directions' && (afterDirections?.domains ?? []).includes('art-direction')),
        `${afterDirections?.surface}: ${(afterDirections?.domains ?? []).join(', ')}`);

    const reader = await import(`${join(APP, 'memory/bridge.js')}?direction-bar`);
    const TASK = 'propose art directions for: a plant tracker';
    const unbarred = await reader.recallBlock({ buildId: BUILD, episodeId: e1, task: TASK });
    const barred = await reader.recallBlock({ buildId: BUILD, episodeId: e1, task: TASK, directionGeneration: true });
    reader.closeAll();
    check('the taste lesson is exactly what that task WOULD otherwise recall',
        unbarred.includes('SMOKE-TASTE-RECOMMENDATION'), `${unbarred.length} chars unbarred`);
    check('and the bar removes it', !barred.includes('SMOKE-TASTE-RECOMMENDATION'), `${barred.length} chars barred`);
    check('while leaving the correctness lesson in place',
        barred.includes('SMOKE-BUILD-RECOMMENDATION'), 'the bar is about taste, not about recall');

    // ---- 7. it survives a restart --------------------------------------------
    console.log('\n=== restart ===');
    const before = (await state()).build;
    await stopServer(server);
    server = await startServer(port);
    const after = (await state()).build;
    check('episodes survive a restart', after?.episodes?.length === before?.episodes?.length, `${after?.episodes?.length}`);
    check('events survive', after?.eventCount === before?.eventCount, `${after?.eventCount}`);
    check('lessons survive', after?.lessons?.length === before?.lessons?.length, `${after?.lessons?.length}`);

    // ---- 8. the CLI reads the very same databases -----------------------------
    console.log('\n=== cli parity ===');
    const cli = (args) => JSON.parse(execFileSync('node', [join(ENGINE, 'dist/bin/multi-memory.js'), '--build', BUILD, ...args], {
        env: { ...process.env, MULTI_MEMORY_BUILDS: scratch },
        encoding: 'utf8',
    }));
    const cliLessons = cli(['lesson', 'list', '--json']);
    check('the CLI sees exactly the lessons the server reports',
        cliLessons.length === after.lessons.length, `${cliLessons.length} vs ${after.lessons.length}`);
    check('including the one the HTTP loop proposed a moment ago',
        cliLessons.some((l) => l.id === failed.proposed?.[0]?.lessonId));

    try {
        execFileSync('node', [join(ENGINE, 'dist/bin/multi-memory.js'), '--build', 'no-such-build', 'lesson', 'list'], {
            env: { ...process.env, MULTI_MEMORY_BUILDS: scratch }, encoding: 'utf8', stdio: 'pipe',
        });
        fail('an unknown build id should be refused, not answered with an empty list');
    } catch (e) {
        check('an unknown build id is refused rather than invented',
            /No database for build/.test(String(e.stderr ?? '')), String(e.stderr ?? '').split('\n')[0]);
    }
} catch (error) {
    fail(`smoke aborted: ${error.message}`);
    if (server) console.log(server.log().split('\n').slice(-15).join('\n'));
} finally {
    await stopServer(server);
    rmSync(scratch, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n\x1b[32mMEMORY SMOKE PASSED\x1b[0m' : `\n\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`);
process.exit(failures === 0 ? 0 : 1);
