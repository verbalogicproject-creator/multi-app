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
import { launch, openPage, assertBackend, DESKTOP } from './ui-harness.mjs';

const PORT = 5312;
const URL = `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { console.log(`  ok    ${name}`); return true; }
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`);
    return false;
};

const startPreview = async () => {
    const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
        stdio: ['ignore', 'pipe', 'pipe'],
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
    proc.kill();
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
        // Reach the code surface: an agent, then its IDE.
        await page.locator('aside').getByRole('button', { name: 'Agents', exact: true }).first().click();
        await page.waitForTimeout(400);
        await page.getByText('Harbour Builder').click();
        await page.waitForTimeout(800);

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

        const save = page.getByRole('button', { name: 'Save', exact: true });

        // ── 1. History and cursor survive a save ────────────────────────────
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

        // ── 2. History resets across files ──────────────────────────────────
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

    } finally {
        await context.close();
        await browser.close();
        preview.kill();
    }

    console.log('');
    if (failures) { console.error(`editor: ${failures} failure(s)`); process.exit(1); }
    console.log('editor ok');
};

run().catch(e => { console.error('CHECK FAILED TO RUN:', e.message); process.exit(1); });
