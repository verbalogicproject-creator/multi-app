/**
 * The editor's behaviour, which no screenshot can see.
 *
 * `audit:ui` proves the code surface renders and obeys the token layer. It
 * cannot prove the editor *works*, and the way this component fails is
 * specifically invisible: rebuild the EditorView on every save and the pane
 * looks perfect, keeps your text, passes every visual check — and silently
 * throws away undo history each time you press Save. You find out the first
 * time you need it, which is the worst moment to find out.
 *
 * So this asserts the two properties that define the stage, from the outside,
 * through the keyboard only:
 *
 *   1. Within a file, undo history and the cursor survive a save.
 *   2. Across files, undo history resets — undo must never walk you into the
 *      edits you made in a different file.
 *
 * Every assertion also checks that its subject actually moved. A test where
 * "nothing changed" can pass is a test that passes when the editor is dead.
 */
import { spawn } from 'node:child_process';
import { launch, openPage, assertBackend, dockTo, DESKTOP } from './ui-harness.mjs';

const PORT = 5312;
const URL = `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { console.log(`  ok    ${name}`); return true; }
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`);
    return false;
};

/**
 * Stop the preview, and mean it.
 *
 * `spawn` gets us `npx`, which is not the server — `npx` starts vite as a *child*,
 * and killing the parent leaves that child holding the port. The next run then meets
 * `--strictPort`, exits, and the readiness poll is answered by the leftover from last
 * time: the exact trap the guard in `startPreview` was written for. `detached` puts
 * the pair in their own process group so one signal reaches both.
 *
 * It also has to happen, or the script never exits. A surviving grandchild keeps its
 * pipes open, and open pipes keep node's event loop alive long after the last
 * assertion has been printed.
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
        // Same trap as audit-ui: --strictPort makes vite exit when the port is
        // held, and a leftover server answers 200 on the next poll.
        if (proc.exitCode !== null) {
            console.error(`preview exited (code ${proc.exitCode}):\n${log.trim() || '(no output)'}`);
            process.exit(1);
        }
        try { if ((await fetch(`${URL}/`)).ok) return proc; } catch { /* not up */ }
        await new Promise(r => setTimeout(r, 500));
    }
    console.error(`preview never came up on ${PORT}:\n${log}`);
    stopPreview(proc);
    process.exit(1);
};

/** The editor's document, read the way a person reads it. */
const docText = page => page.locator('.cm-content').innerText();

const run = async () => {
    await assertBackend();
    const preview = await startPreview();
    const browser = await launch();
    const { context, page } = await openPage(browser, DESKTOP, URL);

    try {
        // ── 0. The IDE belongs to a project, not to an agent ─────────────────
        // Regression guard for the bug that made "Open in IDE" unable to open the
        // IDE. The editor was gated on an active agent; the hand-off that fills a
        // project ends by deselecting the agent, so the one button built to open
        // the editor guaranteed it stayed shut and the Code tab stayed grey.
        //
        // Nothing in this section selects an agent. Put the gate back on the agent
        // and this fails while everything below still passes — which is what tells
        // the two properties apart.
        ok('no editor before anything is chosen', await page.locator('.cm-editor').count() === 0,
           'something was already open; this section proves nothing');
        await dockTo(page, 'Projects');
        await page.getByRole('checkbox', { name: 'Harbour Dashboard' }).check();
        await dockTo(page, 'Code');
        const openedByProject = await page.waitForSelector('.cm-editor', { timeout: 15000 })
            .then(() => true).catch(() => false);
        ok('ticking a project opens its code, with no agent anywhere', openedByProject,
           'the IDE never mounted — it is still gated on an active agent');

        /* And again with an agent, which is the other way a project becomes the IDE's.
           Choosing an expert now lands you in the conversation, so the dock is what
           brings you back to the code — the same two clicks a person makes. */
        await dockTo(page, 'Harness');
        await page.getByText('Harbour Builder').click();
        await page.waitForTimeout(800);
        await dockTo(page, 'Code');

        // CodeMirror mounted at all — and it is CodeMirror, not the textarea it replaced.
        await page.waitForSelector('.cm-editor', { timeout: 15000 });
        ok('CodeMirror mounts', await page.locator('.cm-editor').count() === 1);
        ok('the textarea is gone', await page.locator('textarea[aria-label^="Contents of"]').count() === 0);

        const seeded = await docText(page);
        ok('the file has content', seeded.length > 0 && seeded.includes('harbour'),
           `got ${JSON.stringify(seeded.slice(0, 80))}`);
        ok('line numbers render', await page.locator('.cm-gutterElement').count() > 0);
        // HighlightStyle.define emits CodeMirror's own generated class names, not
        // the `tok-*` set (those come from classHighlighter). What matters is
        // that the grammar produced *styled spans* at all: an unparsed document
        // is one flat text node.
        const spans = await page.locator('.cm-line span').count();
        ok('the grammar produced styled spans', spans > 0, `${spans} spans in the document`);

        // ── 1. Type diagnostics ─────────────────────────────────────────────
        // `src/Broken.tsx` violates an interface declared in `src/types.ts`, so
        // nothing here can pass unless the checker saw both files at once.
        await page.getByRole('button', { name: 'src/Broken.tsx', exact: true }).click();
        await page.waitForTimeout(700);

        // tsc is a subprocess behind a 500ms debounce; it is seconds, not frames.
        let squiggle = page.locator('.cm-lintRange-error').first();
        try { await squiggle.waitFor({ timeout: 30000 }); } catch { /* asserted below */ }

        const marked = (await squiggle.count()) ? (await squiggle.innerText()) : '';
        ok('a type error is underlined', marked.length > 0,
           'no .cm-lintRange-error appeared — the checker never answered, or the dispatch never landed');
        // The whole point of the offset conversion. tsc counts lines and columns
        // from 1; CodeMirror wants absolute offsets, and getting that wrong
        // underlines real text with total confidence.
        ok('the underline is on the offending token', marked === 'id',
           `underlined ${JSON.stringify(marked)}, expected "id" — the line/col to offset conversion is off`);

        ok('the gutter marks the line', await page.locator('.cm-lint-marker-error').count() > 0);

        // The panel lists it, and says where.
        await page.getByRole('tab', { name: /Problems/ }).click();
        await page.waitForTimeout(400);
        const entry = page.getByRole('button', { name: /src\/Broken\.tsx:4:24/ }).first();
        ok('the problems panel names the place', await entry.count() > 0,
           'no entry matching src/Broken.tsx:4:24');

        // ── 2. The staleness guard, and proof it is awake ───────────────────
        // Editing the marked line must *retract* the squiggle, not leave it to
        // slide onto whatever text now sits at those coordinates. Delete the
        // clear-on-change dispatch in useDiagnostics and this is the assertion
        // that fails, by name.
        const brokenLine = page.locator('.cm-line').nth(3);
        await brokenLine.click();
        await page.keyboard.press('End');
        // Count first. "It is gone now" is not a result unless it was there before —
        // otherwise this assertion passes loudest when diagnostics are broken
        // entirely, which is the one time it must not.
        const before = await page.locator('.cm-lintRange-error').count();
        await page.keyboard.type(' ');
        await page.waitForTimeout(250);
        const after = await page.locator('.cm-lintRange-error').count();
        ok('editing the line retracts the stale squiggle', before > 0 && after === 0,
           before === 0
               ? 'there was no underline to retract — this assertion proved nothing'
               : `${after} underline(s) survived the edit — they now describe text that has moved`);


        // Back to a pristine App.tsx for the editing assertions below, which need
        // the caret in a file they are about to deliberately mangle.
        await page.getByRole('button', { name: 'src/App.tsx', exact: true }).click();
        await page.waitForTimeout(600);

        const save = page.getByRole('button', { name: 'Save', exact: true });

        // ── 3. History and cursor survive a save ────────────────────────────
        const firstLine = page.locator('.cm-line').first();
        await firstLine.click();
        await page.keyboard.press('End');
        await page.keyboard.type('/*MARK*/');
        const typed = await docText(page);
        ok('typing reaches the document', typed.includes('/*MARK*/'));
        ok('typing marks the file unsaved', await save.isEnabled());

        // Save from the keyboard, not the button. Clicking Save moves focus out of
        // the editor, so a click can only ever show that the caret was lost to
        // the click — it says nothing about whether the view was rebuilt. Mod-s
        // keeps focus where a person's hands are, which is also the binding this
        // component adds.
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(400);
        ok('Mod-s saves', await save.isDisabled(), 'the Save button is still enabled');
        ok('saving keeps the text', (await docText(page)).includes('/*MARK*/'));

        // The cursor must still be where it was. If the view was rebuilt it is
        // at offset 0 and this character lands at the top of the file.
        await page.keyboard.type('!');
        const afterCaret = await docText(page);
        ok('the cursor survives a save', afterCaret.includes('/*MARK*/!'),
           `expected "/*MARK*/!" — the caret jumped, so the view was rebuilt`);

        // The load-bearing one. Undo across a save is what a remount destroys.
        const beforeUndo = await docText(page);
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(200);
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(300);
        const afterUndo = await docText(page);
        ok('undo actually changes the document', afterUndo !== beforeUndo,
           'undo was a no-op — history is empty, so the view is being rebuilt');
        ok('undo history survives a save', !afterUndo.includes('/*MARK*/'),
           `still ${JSON.stringify(afterUndo.slice(0, 80))} — history was reset by the save`);

        // ── 4. History resets across files ──────────────────────────────────
        await page.keyboard.press('Control+Shift+z');   // redo, back to /*MARK*/
        await page.waitForTimeout(300);
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(400);
        const persisted = await docText(page);
        ok('redo works', persisted.includes('/*MARK*/'));

        await page.getByRole('button', { name: 'src/components/Header.tsx', exact: true }).click();
        await page.waitForTimeout(700);
        const other = await docText(page);
        ok('switching files changes the document', other !== persisted && other.includes('Header'),
           `got ${JSON.stringify(other.slice(0, 80))}`);

        // Undo in the second file must not reach into the first one's history.
        await page.locator('.cm-line').first().click();
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(300);
        ok('undo does not cross into another file', (await docText(page)) === other,
           'the second file changed under an undo — history leaked across the switch');

        await page.getByRole('button', { name: 'src/App.tsx', exact: true }).click();
        await page.waitForTimeout(700);
        ok('the saved edit persisted', (await docText(page)).includes('/*MARK*/'));

        await page.locator('.cm-line').first().click();
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(300);
        ok('history resets when you come back', (await docText(page)).includes('/*MARK*/'),
           'undo walked back past the file switch — history was not reset');

        // ── 5. A destination is only open if the project behind it still exists ──
        /* Found by an adversarial review, and confirmed by measurement before it was
           believed. `ideProjectId` was `activeAgent?.projectId ?? lastTicked`, and
           nothing ever asked whether that id still named a loaded project. A truthy id
           for a project that is gone left Code and Preview enabled, kept the redirect
           guard from firing, and rendered both against nothing.

           Two cases, and the split matters. The second is the one a person hits; the
           first is the one that can only be passed by the fix. Deleting a project also
           stands down the agent bound to it, so case (b) alone would go green with the
           existence check reverted — the stand-down would disable Code by itself. Case
           (a) has no deletion and no stand-down in it, so nothing but the existence
           check can make Code unavailable there. */
        const dockItem = (p, name) => p.locator('[data-dock-live] button', { hasText: name }).first();

        // (a) An agent restored from storage naming a project that is not there.
        const ghost = await openPage(browser, DESKTOP, URL, {
            gemini_agents: [{ id: 'agent-ghost', name: 'Ghost Builder', personaId: 'p1', projectId: 'proj-deleted-elsewhere' }],
        });
        try {
            await dockTo(ghost.page, 'Harness');
            await ghost.page.getByText('Ghost Builder').click();
            await ghost.page.waitForTimeout(800);
            ok('an agent naming a project that does not exist cannot open Code',
                await dockItem(ghost.page, 'Code').isDisabled(),
                'Code was offered for a project id that resolves to nothing');
            ok('nor Preview',
                await dockItem(ghost.page, 'Preview').isDisabled(),
                'Preview was offered for a project id that resolves to nothing');
            ok('and it says why rather than just greying out',
                /Open a project/.test(await dockItem(ghost.page, 'Code').getAttribute('title') ?? ''),
                `title was ${JSON.stringify(await dockItem(ghost.page, 'Code').getAttribute('title'))}`);
        } finally {
            await ghost.context.close();
        }

        // (b) The project is deleted while its agent is active and its code is open.
        /* The agent from section 0 is still active here; clicking it again would
           deselect it, which is how the first version of this section managed to
           disable Code before the deletion it was supposed to be testing. */
        await dockTo(page, 'Code');
        ok('the open project still has an editor before the deletion',
            await page.locator('.cm-editor').count() > 0,
            'this case needs the editor open before it can prove it closes');

        await dockTo(page, 'Projects');
        /* Deletion asks first, and the question names what goes with it. There is no
           undo in this app, so this step is the only thing between a mis-tap and a lost
           project — and it has to mention the experts bound to it, which are deleted
           too. A confirmation that hides half of what it does is worse than none. */
        await page.getByRole('button', { name: 'Delete Harbour Dashboard' }).click();
        await page.waitForTimeout(400);
        ok('deleting asks before it deletes',
            await page.getByRole('button', { name: 'Confirm deleting Harbour Dashboard' }).isVisible()
                && await page.getByRole('checkbox', { name: 'Harbour Dashboard' }).count() === 1,
            'the project went without a question');
        ok('and names the expert that goes with it',
            /Harbour Builder/.test(await page.getByText(/will go with it/).innerText()),
            await page.getByText(/will go with it/).innerText().catch(() => '(no cost line rendered)'));

        await page.getByRole('button', { name: 'Keep' }).click();
        await page.waitForTimeout(400);
        ok('and Keep actually keeps it',
            await page.getByRole('checkbox', { name: 'Harbour Dashboard' }).count() === 1,
            'the project vanished after choosing Keep');

        await page.getByRole('button', { name: 'Delete Harbour Dashboard' }).click();
        await page.waitForTimeout(300);
        await page.getByRole('button', { name: 'Confirm deleting Harbour Dashboard' }).click();
        await page.waitForTimeout(900);
        ok('confirming removes the project',
            await page.getByRole('checkbox', { name: 'Harbour Dashboard' }).count() === 0);
        /* The dangling half of the review finding: the shell stopped trusting these
           records, and the store went on holding them. */
        await dockTo(page, 'Harness');
        ok('and the expert bound to it is gone rather than left dangling',
            await page.getByText('Harbour Builder').count() === 0,
            'an agent still names a project that no longer exists');
        await dockTo(page, 'Projects');

        ok('deleting the open project disables Code',
            await dockItem(page, 'Code').isDisabled(),
            'Code is still offered for a project that no longer exists');
        ok('and disables Preview',
            await dockItem(page, 'Preview').isDisabled(),
            'Preview is still offered for a project that no longer exists');

        // ── 6. an idle builder has no identity to record against ────────────────
        /* `restoreBuilderState` minted a build id on every page load, because
           `resetWebAppBuild` persists `buildId: null` — so once anyone had finished or
           cancelled a build, every later load produced a fresh id and `MemoryPanel`'s
           status poll materialised a store to ask whether that id had recorded anything.
           The act of checking created what it was checking for.

           Measured as polls carrying a build id rather than as files on disk: the shared
           store means there is only ever one file either way, so a file count cannot see
           this and would pass in both directions. */
        const idle = await openPage(browser, DESKTOP, URL, {
            gemini_builder_state: { isActive: false, currentStep: 1, idea: '', memory: { buildId: null } },
        });
        try {
            const polls = [];
            idle.page.on('request', r => {
                if (r.url().includes('/api/memory/state')) polls.push(r.url());
            });
            await idle.page.reload({ waitUntil: 'networkidle' });
            await idle.page.waitForTimeout(1200);
            ok('an idle builder mints no build id',
                polls.filter(u => u.includes('buildId=build-')).length === 0,
                `${polls.length} poll(s): ${polls.map(u => u.split('?')[1]).join(', ')}`);
        } finally {
            await idle.context.close();
        }

    } finally {
        await context.close();
        await browser.close();
        stopPreview(preview);
    }

    console.log('');
    if (failures) { console.error(`editor: ${failures} failure(s)`); process.exit(1); }
    console.log('editor ok');
    /* Explicit, because a verdict has been printed and there is nothing left to
       decide. Draining the loop instead means any stray handle turns a pass into a
       hang, which reads as a broken gate rather than a green one. */
    process.exit(0);
};

run().catch(e => { console.error('CHECK FAILED TO RUN:', e.message); process.exit(1); });
