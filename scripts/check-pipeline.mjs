/**
 * Chat reaches the builder, and the hand-off is honest about what it is sending.
 *
 * Three properties, and they fail in three different places, so they are checked three
 * different ways rather than all through the browser:
 *
 *  1. **The mode reaches the prompt.** `plan` used to stop at the client, where it
 *     decided one thing — whether projects were forwarded. A mode that changes what the
 *     assistant is *given* but never what it is *for* cannot produce a brief. Pure, no
 *     server.
 *  2. **The brief is composed from what the assistant actually wrote**, and the
 *     fallbacks are real rather than an empty string. Pure, bundled from TypeScript the
 *     way `AGENTS.md` describes, because a rule this load-bearing must be checkable
 *     without a browser or a model.
 *  3. **The button seeds the wizard and goes there.** Only the browser can prove that,
 *     and it is the half that would silently rot: a composer that works and a button
 *     that navigates nowhere look identical from the two checks above.
 */
import * as esbuild from 'esbuild';
import { spawn } from 'node:child_process';
import { launch, openPage, assertBackend, dockTo, DESKTOP } from './ui-harness.mjs';
import { buildSystemPrompt } from '../providers/prompts.js';

let failures = 0;
const ok = (name, cond, detail = '') => {
    if (cond) console.log(`  ok    ${name}`);
    else { failures += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const PORT = Number(process.env.PORT_UI ?? 8063);
const URL = process.env.URL ?? `http://127.0.0.1:${PORT}/`;

/**
 * This gate serves the build itself.
 *
 * The first version pointed at a fixed port and passed — because a server happened to be
 * running there by hand. In the sweep, with nothing on that port, it failed with
 * `ERR_CONNECTION_REFUSED` after every pure assertion had already printed `ok`. A gate
 * whose result depends on what someone left running is not a gate; it is a coincidence
 * with a green tick.
 *
 * `detached` because `npx` starts vite as a child, so killing the parent would leave the
 * child holding the port — and the next run's readiness poll would then be answered by
 * the leftover from the last one. The same trap `check-editor` documents.
 */
const stopPreview = (proc) => {
    if (!proc) return;
    try { process.kill(-proc.pid, 'SIGTERM'); }
    catch { proc.kill('SIGTERM'); }
};

const startPreview = async () => {
    const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
        stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    let log = '';
    proc.stdout.on('data', d => { log += d; });
    proc.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 60; i++) {
        /* `--strictPort` makes vite exit when the port is held, and a leftover server
           would answer the poll instead. Notice the exit rather than the 200. */
        if (proc.exitCode !== null) {
            console.error(`preview exited (code ${proc.exitCode}):\n${log.trim() || '(no output)'}`);
            process.exit(1);
        }
        try { if ((await fetch(URL)).ok) return proc; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 500));
    }
    console.error(`preview never came up on ${PORT}:\n${log}`);
    stopPreview(proc);
    process.exit(1);
};

// ─────────────────────────────────────────── 1. the mode reaches the prompt
console.log('\n1. plan mode changes what the assistant is for, not just what it is given');

const base = { provider: 'google', persona: {}, projects: [], customStyles: [] };
const plain = buildSystemPrompt(base);
const planning = buildSystemPrompt({ ...base, mode: 'plan' });

ok('an ordinary turn is not told to write a brief', !/BRIEF/.test(plain));
/* The presence half, first: without it "the brief block is absent" and "the prompt is
   empty" are the same observation. */
ok('a plan turn is', /BRIEF/.test(planning), planning.slice(-200));
ok('and is told what shape to write it in', /Pages:/.test(planning) && /Must have:/.test(planning));
ok('and keeps the persona and house rules it would otherwise have had',
    planning.startsWith(plain), 'plan mode replaced the base prompt instead of extending it');

for (const mode of [undefined, 'chat', 'coding']) {
    ok(`mode ${JSON.stringify(mode)} gets no planning instructions`,
        !/BRIEF/.test(buildSystemPrompt({ ...base, mode })));
}

// ─────────────────────────────────────────── 2. the brief, composed
console.log('\n2. the brief is what the assistant wrote, and never nothing');

const bundled = await esbuild.build({
    entryPoints: ['utils/builderBrief.ts'],
    bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
});
const { composeBuilderBrief, hasBuilderBrief } = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const user = (text) => ({ id: `u${Math.random()}`, author: 'user', parts: [{ text }] });
const bot = (text) => ({ id: `a${Math.random()}`, author: 'assistant', parts: [{ text }] });

const withBrief = [
    user('I want something for my bakery'),
    bot('Sure — what pages?'),
    user('menu, contact'),
    bot('Right.\n\nBRIEF\nA small site for a local bakery.\nPages: Home, Menu, Contact\nMust have: opening hours'),
];
const composed = composeBuilderBrief(withBrief);
ok('the BRIEF block is taken, not the whole reply', composed.startsWith('A small site'), JSON.stringify(composed));
ok('and the marker itself is not part of it', !composed.startsWith('BRIEF'));
ok('and the structured lines survive', /Pages: Home, Menu, Contact/.test(composed));

/* The most recent one wins: the assistant is told to revise the brief rather than
   append, so an earlier turn's version is stale by definition. */
const revised = [...withBrief, user('add a gallery'),
    bot('BRIEF\nA small site for a local bakery.\nPages: Home, Menu, Contact, Gallery\nMust have: opening hours')];
ok('a revised brief supersedes the earlier one', /Gallery/.test(composeBuilderBrief(revised)));

/* The trap this guards: an assistant that merely mentions the word. Treating everything
   after any occurrence as the brief would hand the builder a sentence fragment. */
const mentioned = [user('go on'), bot('I will put the BRIEF at the end once we agree on the pages.')];
ok('a mention of the word mid-sentence is not a brief',
    composeBuilderBrief(mentioned) === 'I will put the BRIEF at the end once we agree on the pages.',
    JSON.stringify(composeBuilderBrief(mentioned)));

ok('an assistant that answered without a block still hands over its answer',
    composeBuilderBrief([user('hi'), bot('A recipe site with search.')]) === 'A recipe site with search.');
/* Never worse than an empty textarea — this is what happens if plan mode was never used. */
ok('a conversation with no assistant turn falls back to what was asked',
    composeBuilderBrief([user('a bakery site'), user('with a menu')]) === 'a bakery site\n\nwith a menu');
ok('and an empty conversation has nothing to hand over',
    composeBuilderBrief([]) === '' && hasBuilderBrief([]) === false);

// ─────────────────────────────────────────── 3. the button, driven
console.log('\n3. Send to Builder seeds the wizard and lands you in it');

await assertBackend();
const preview = await startPreview();
const browser = await launch();
const { context, page } = await openPage(browser, DESKTOP, URL, {
    gemini_messages_general: withBrief,
});
try {
    await dockTo(page, 'Chat');
    /* No button before the mode is chosen: the hand-off belongs to `plan`, and a control
       that appears everywhere is one you stop reading. */
    ok('there is no hand-off outside plan mode',
        await page.getByRole('button', { name: 'Send to Builder' }).count() === 0);

    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await page.waitForTimeout(400);
    ok('choosing Plan offers the hand-off',
        await page.getByRole('button', { name: 'Send to Builder' }).isVisible());

    await page.getByRole('button', { name: 'Send to Builder' }).click();
    await page.waitForTimeout(900);

    ok('pressing it lands you on the builder',
        await page.locator('[data-dock-live] [aria-current="page"]').innerText() === 'Build',
        await page.locator('[data-dock-live] [aria-current="page"]').innerText().catch(() => '(none)'));

    const idea = page.getByRole('textbox', { name: 'Your idea' });
    ok('on the first step, which is where an idea is entered', await idea.isVisible());
    const seeded = await idea.inputValue();
    ok('with the brief already in it', seeded.startsWith('A small site for a local bakery'),
        JSON.stringify(seeded.slice(0, 80)));
    /* Editable, not submitted. The whole design rests on the person reading it before a
       builder request is made — a seeded field that had already been sent would be a
       different and much worse feature. */
    ok('and nothing has been generated yet',
        await page.getByRole('button', { name: /Create project blueprint/ }).isVisible(),
        'the wizard moved past step 1 on its own');
    await idea.fill('edited by hand');
    ok('and the seed can be edited before it is used',
        await idea.inputValue() === 'edited by hand');
} finally {
    await context.close();
    await browser.close();
    stopPreview(preview);
}

console.log(failures === 0 ? '\npipeline ok' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
