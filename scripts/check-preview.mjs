/**
 * The preview actually runs the app.
 *
 * `audit:ui` proves a pane exists and obeys the token layer. It cannot prove the
 * thing inside the pane is a *running React application*, and the way a preview
 * fails is specifically invisible: a blank white iframe looks identical whether the
 * bundle failed, the app threw on its first render, or it rendered nothing at all.
 * All three are "the preview is broken" to a reader and three different bugs to us.
 *
 * So this drives the real `/api/preview/build` route with real generated-shaped
 * projects, puts the answer in a real sandboxed iframe in a real browser, and
 * asserts the three failure modes are distinguishable and the success case is
 * genuinely alive — not merely present.
 *
 * The assertions that matter most are the ones about the *sandbox*, because the
 * preview document runs at an opaque origin where `history.pushState`,
 * `localStorage` and `document.cookie` all throw. The generate prompt mandates a
 * `BrowserRouter`; unshimmed, the first click on a nav link blanks the page. A test
 * that only renders the home page would never see it.
 *
 *   npm run check:preview
 */
import { spawn } from 'node:child_process';
import { launch, assertBackend, openPage, SURFACES, DESKTOP } from './ui-harness.mjs';

const API = process.env.API_TARGET || 'http://localhost:8050';
/* 5311 is the audit's, 5312 the editor's. Three gates, three ports, no waiting. */
const PORT = 5313;
const URL = `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (name, cond, detail = '') => {
    if (cond) { console.log(`  ok    ${name}`); return true; }
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`);
    return false;
};

/**
 * Stop the preview, and mean it — `spawn` gets us `npx`, which starts vite as a
 * child; killing the parent leaves that child holding the port and the script's
 * event loop alive. `detached` puts the pair in one process group.
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
        if (proc.exitCode !== null) {
            console.error(`preview exited (code ${proc.exitCode}):\n${log.trim() || '(no output)'}`);
            process.exit(1);
        }
        try { if ((await fetch(`${URL}/`)).ok) return proc; } catch { /* not up */ }
        await new Promise(r => setTimeout(r, 500));
    }
    console.error(`vite preview never came up on ${PORT}:\n${log}`);
    stopPreview(proc);
    process.exit(1);
};

const build = async (files) => {
    const res = await fetch(`${API}/api/preview/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'check-preview', files }),
        signal: AbortSignal.timeout(60_000),
    });
    return { status: res.status, body: await res.json() };
};

// ---------------------------------------------------------------------------
// Fixtures, shaped like what `/api/builder/generate` is told to emit: Vite +
// React 19 + TypeScript, react-router-dom v6, Tailwind v4 via `@import`.
// ---------------------------------------------------------------------------

const HTML = (entry = '/src/main.tsx') => '<!doctype html><html lang="en"><head><meta charset="UTF-8" />'
    + '<link rel="icon" type="image/svg+xml" href="/vite.svg" />'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0" />'
    + '<title>Harbour Dashboard</title></head><body><div id="root"></div>'
    + `<script type="module" src="${entry}"></script></body></html>`;

const PACKAGE_JSON = JSON.stringify({
    name: 'harbour', private: true,
    dependencies: { react: '^19', 'react-dom': '^19', 'react-router-dom': '^6' },
}, null, 2);

const INDEX_CSS = '@import "tailwindcss";\n\n:root { --color-primary: #0f766e; }\n';

const MAIN = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);`;

const GOOD = {
    'index.html': HTML(),
    'package.json': PACKAGE_JSON,
    'src/index.css': INDEX_CSS,
    'src/main.tsx': MAIN,
    'src/types.ts': 'export interface Berth { id: number; name: string; }\n',
    'src/App.tsx': `import { Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import About from './pages/About';

export default function App() {
    return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
            <nav className="max-w-6xl mx-auto px-4 py-6 flex gap-6">
                <Link to="/">Harbour</Link>
                <Link to="/about">About the harbour</Link>
            </nav>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/about" element={<About />} />
            </Routes>
        </div>
    );
}`,
    /* The localStorage round-trip is not decoration: reading the property throws in
       a sandboxed frame, so an app that persists anything is a white pane without
       the shim — and persisting to localStorage is what generated apps do. */
    'src/pages/Home.tsx': `import { useEffect, useState } from 'react';
import type { Berth } from '../types';

const berths: Berth[] = [{ id: 1, name: 'North Quay' }];

export default function Home() {
    const [seen, setSeen] = useState('never');
    useEffect(() => {
        window.localStorage.setItem('harbour.visits', '4');
        setSeen(window.localStorage.getItem('harbour.visits') ?? 'never');
    }, []);
    return (
        <main className="max-w-6xl mx-auto px-4 py-16">
            <h1 className="text-4xl font-bold">Berth occupancy at a glance</h1>
            <p data-testid="visits">visits: {seen}</p>
            <ul>{berths.map((b) => <li key={b.id}>{b.name}</li>)}</ul>
        </main>
    );
}`,
    'src/pages/About.tsx': `export default function About() {
    return <main className="max-w-6xl mx-auto px-4 py-16"><h1 className="text-4xl font-bold">A working harbour since 1846</h1></main>;
}`,
};

const THROWS = {
    ...GOOD,
    'src/pages/Home.tsx': `export default function Home(): JSX.Element {
    const berths: string[] | null = null;
    return <ul>{berths!.map((b) => <li key={b}>{b}</li>)}</ul>;
}`,
};

const MISSING_PACKAGE = {
    ...GOOD,
    'src/pages/Home.tsx': `import Chart from 'chart.js/auto';

export default function Home() {
    return <main>{String(Chart)}</main>;
}`,
};

const MISSING_FILE = {
    ...GOOD,
    'src/App.tsx': `import { Sidebar } from './components/Sidebar';

export default function App() { return <Sidebar />; }`,
};

const RENDERS_NOTHING = {
    ...GOOD,
    'src/App.tsx': 'export default function App() { return null; }',
};

const NAMED_ENTRY = {
    'index.html': HTML('/src/boot.tsx'),
    'package.json': PACKAGE_JSON,
    'src/boot.tsx': `import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<p>booted from a file nobody guessed</p>);`,
};

// ---------------------------------------------------------------------------
// Driving the document the way the app will: an iframe, sandboxed, srcDoc.
// ---------------------------------------------------------------------------

/**
 * The parent here is `about:blank` rather than the app's own origin, and that is
 * deliberate rather than lazy: the child's origin is opaque either way, which is the
 * only thing every shim in the harness turns on. It also means the parent is not a
 * secure context — which is exactly the condition under which `crypto.randomUUID`
 * goes missing, so the fixture below gets the harsher of the two environments.
 */
const HOST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%} iframe{border:0;width:100%;height:100%}
</style></head><body><div id="host" style="height:100%"></div>
<script>
window.__messages = [];
window.addEventListener('message', function (e) {
    if (e.data && e.data.__preview === 'multi-app-preview') {
        window.__messages.push(Object.assign({ __origin: e.origin, __fromFrame: e.source === document.querySelector('iframe').contentWindow }, e.data));
    }
});
window.__mount = function (html) {
    window.__messages = [];
    var host = document.getElementById('host');
    host.innerHTML = '';
    var f = document.createElement('iframe');
    f.id = 'preview';
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('title', 'preview');
    f.srcdoc = html;
    host.appendChild(f);
};
<\/script></body></html>`;

/**
 * Text, or `null` — never a thrown timeout.
 *
 * `locator.innerText()` on an element that never arrives throws after 30 s, and the
 * run dies with a stack trace instead of a failed assertion. That matters here more
 * than it usually does: the app not rendering at all is precisely what a missing
 * sandbox shim looks like, so the most important failure this gate can detect was
 * also the one it reported worst. Reverting a shim must name an assertion.
 */
const textOf = async (locator, timeout = 6000) => {
    try { return await locator.innerText({ timeout }); } catch { return null; }
};

const mount = async (page, html) => {
    await page.evaluate((doc) => window.__mount(doc), html);
    /* One message of type `rendered` always arrives — empty or not — so waiting for
       it is waiting for the app to have had its chance, not for a happy path. */
    await page.waitForFunction(
        () => window.__messages.some((m) => m.type === 'rendered'),
        null, { timeout: 15_000 },
    ).catch(() => {});
    return page.evaluate(() => window.__messages);
};

const run = async () => {
    await assertBackend();
    const browser = await launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.setContent(HOST_PAGE);
    const frame = page.frameLocator('#preview');

    try {
        // ---- 1. it bundles, and it is one self-contained document ---------------
        console.log('\n1. the route answers with a running document');
        const good = await build(GOOD);
        ok('a generated project builds', good.body.ok === true, JSON.stringify(good.body.errors ?? good.body.error));
        ok('the entry came from index.html', good.body.entry === 'src/main.tsx', String(good.body.entry));
        ok('Tailwind compiled, in-process', (good.body.candidates ?? 0) > 10 && !good.body.styleError,
            `${good.body.candidates} candidates, styleError=${good.body.styleError}`);

        const html = good.body.html ?? '';
        /* The origins rule the UI audit enforces, checked at the source instead: a
           document that references a CDN cannot be caught by looking at a screenshot. */
        const external = [/<script[^>]+src\s*=\s*["']https?:/i, /<link[^>]+href\s*=\s*["']https?:/i, /@import\s+url\(/i]
            .filter((re) => re.test(html));
        ok('nothing is fetched from anywhere', external.length === 0, external.map(String).join(' '));

        // ---- 2. it is alive, not merely present --------------------------------
        console.log('\n2. the app is running');
        const messages = await mount(page, html);
        const rendered = messages.find((m) => m.type === 'rendered');
        ok('the harness reports a render', Boolean(rendered), JSON.stringify(messages));
        /* Weak on purpose, and paired: a shell that renders with an empty content
           area reports `empty: false` quite honestly. It is the content assertions
           below that know whether the app works. */
        ok('and it is not empty', rendered?.empty === false, JSON.stringify(rendered));
        ok('the postMessage came from the frame at an opaque origin',
            rendered?.__fromFrame === true && rendered?.__origin === 'null',
            `origin=${rendered?.__origin} fromFrame=${rendered?.__fromFrame}`);
        ok('no runtime error was reported', !messages.some((m) => m.type === 'runtime-error'),
            JSON.stringify(messages.filter((m) => m.type === 'runtime-error')));

        const heading = frame.locator('h1');
        const headingText = await textOf(heading);
        ok('the app\'s own content is on screen',
            headingText?.includes('Berth occupancy') === true,
            headingText === null ? 'no <h1> ever rendered' : `h1 reads "${headingText}"`);

        /* 36px is `text-4xl`. A browser's default h1 is 32px, so this fails if the
           stylesheet is missing *or* empty — the assertion moves with the CSS. */
        const size = headingText === null ? null
            : await heading.evaluate((el) => getComputedStyle(el).fontSize).catch(() => null);
        ok('Tailwind\'s utilities are in force', size === '36px', `h1 font-size is ${size}, expected 36px`);

        // ---- 3. the sandbox, which is where a preview quietly dies --------------
        console.log('\n3. the opaque origin does not break the app');
        const visits = await textOf(frame.locator('[data-testid="visits"]'));
        ok('localStorage round-trips through the shim', visits?.includes('visits: 4') === true,
            visits === null ? 'the component that reads localStorage never rendered' : visits);

        /* The one that would not be caught by rendering the home page: navigating is
           what calls `history.pushState`, and `pushState` throws here. */
        const link = frame.getByRole('link', { name: 'About the harbour' });
        const clicked = await link.click({ timeout: 6000 }).then(() => true).catch(() => false);
        await page.waitForTimeout(400);
        const after = clicked ? await textOf(frame.locator('h1')) : null;
        ok('a router link navigates instead of throwing', after?.includes('since 1846') === true,
            clicked ? `h1 reads "${after}"` : 'the nav link never rendered — the router did not mount');
        const navErrors = await page.evaluate(() => window.__messages.filter((m) => m.type === 'runtime-error'));
        ok('and navigating raised nothing', navErrors.length === 0, JSON.stringify(navErrors));

        // ---- 4. the three failure modes are three different answers -------------
        console.log('\n4. a broken app says why');
        const threw = await build(THROWS);
        ok('an app that throws still bundles', threw.body.ok === true, JSON.stringify(threw.body.errors));
        const threwMessages = await mount(page, threw.body.html);
        const runtime = threwMessages.find((m) => m.type === 'runtime-error');
        ok('the runtime error reaches the parent', Boolean(runtime), JSON.stringify(threwMessages));
        ok('and it carries a message worth reading',
            /null|undefined|map/i.test(runtime?.message ?? ''), runtime?.message);
        ok('and the empty root is reported as empty, not as white space',
            threwMessages.find((m) => m.type === 'rendered')?.empty === true,
            JSON.stringify(threwMessages.find((m) => m.type === 'rendered')));

        console.log('\n5. an unbuildable app never becomes an empty frame');
        const missingPkg = await build(MISSING_PACKAGE);
        ok('a missing package fails the build', missingPkg.body.ok === false, JSON.stringify(missingPkg.body).slice(0, 200));
        ok('and no document is produced at all', missingPkg.body.html === undefined);
        ok('and the error names the package',
            (missingPkg.body.errors ?? []).some((e) => e.text?.includes('chart.js')),
            JSON.stringify(missingPkg.body.errors));

        const missingFile = await build(MISSING_FILE);
        ok('a missing file fails the build', missingFile.body.ok === false);
        ok('and the error names the import and the file that wrote it',
            (missingFile.body.errors ?? []).some((e) => e.text?.includes('./components/Sidebar') && e.file === 'src/App.tsx'),
            JSON.stringify(missingFile.body.errors));

        console.log('\n6. rendering nothing is its own answer');
        const nothing = await build(RENDERS_NOTHING);
        ok('an app that renders null still builds', nothing.body.ok === true, JSON.stringify(nothing.body.errors));
        const nothingMessages = await mount(page, nothing.body.html);
        ok('and is reported as empty rather than left blank',
            nothingMessages.find((m) => m.type === 'rendered')?.empty === true,
            JSON.stringify(nothingMessages));
        ok('with no error, because nothing went wrong — it just renders nothing',
            !nothingMessages.some((m) => m.type === 'runtime-error'));

        console.log('\n7. the entry is read, not assumed');
        const named = await build(NAMED_ENTRY);
        ok('a project whose entry is not main.tsx still builds', named.body.ok === true, JSON.stringify(named.body.errors));
        ok('and the entry is the one index.html points at', named.body.entry === 'src/boot.tsx', String(named.body.entry));
        const namedMessages = await mount(page, named.body.html);
        ok('and it renders', namedMessages.find((m) => m.type === 'rendered')?.empty === false,
            JSON.stringify(namedMessages));
    } finally {
        await browser.close();
    }

    // ---- 8. the seam, in both places it is mounted -------------------------
    /* Everything above proves the *server* produces a running document. None of it
       proves the app ever puts one on screen. `audit:ui` reaches both surfaces, but
       reaching a tab is not the same as the tab having built anything — a host stuck
       on "Building…" forever is a reachable surface and a dead preview. */
    console.log('\n8. the app mounts the preview, in both places');
    const vite = await startPreview();
    const clientBrowser = await launch();
    try {
        // -- mount one: the IDE's Preview tab --
        const ide = await openPage(clientBrowser, DESKTOP, URL);
        await ide.page.locator('aside').getByRole('button', { name: 'Agents', exact: true }).first().click();
        await ide.page.waitForTimeout(400);
        await ide.page.getByText('Harbour Builder').click();
        await ide.page.waitForTimeout(800);
        await ide.page.getByRole('tab', { name: /Preview/ }).first().click();

        const ideFrame = ide.page.locator('iframe[title="Preview of the open project"]');
        const ideBuilt = await ideFrame.waitFor({ timeout: 45_000 }).then(() => true).catch(() => false);
        ok('the IDE builds a preview of the open project', ideBuilt,
            'no iframe ever appeared — the host never got a document to show');

        const ideSandbox = ideBuilt ? await ideFrame.getAttribute('sandbox') : null;
        /* The one that must never regress: `allow-scripts` together with
           `allow-same-origin` is not a sandbox at all, and this document is built
           from model output. */
        ok('and sandboxes it with scripts only', ideSandbox === 'allow-scripts', `sandbox="${ideSandbox}"`);

        const ideText = ideBuilt
            ? await textOf(ide.page.frameLocator('iframe[title="Preview of the open project"]').locator('#root'), 20_000)
            : null;
        ok('and the seeded project is running inside it', ideText?.includes('harbour') === true,
            ideText === null ? 'nothing rendered in #root' : `#root reads "${ideText}"`);

        // -- mount two: the wizard's export step --
        /* Seeded from the audit's own fixture, so the two gates cannot disagree
           about what a finished build looks like. */
        const exportSeed = SURFACES.find((s) => s.name === 'wizard-5-export')?.seed;
        ok('the export fixture is still where the audit keeps it', Boolean(exportSeed));
        const wizard = await openPage(clientBrowser, DESKTOP, URL, exportSeed ?? {});

        const wizardFrame = wizard.page.locator('iframe[title*="preview"]');
        const wizardBuilt = await wizardFrame.waitFor({ timeout: 45_000 }).then(() => true).catch(() => false);
        ok('the wizard\'s last step builds one too', wizardBuilt,
            'no iframe appeared on the export step');
        ok('with the same sandbox', wizardBuilt && await wizardFrame.getAttribute('sandbox') === 'allow-scripts');

        const wizardText = wizardBuilt
            ? await textOf(wizard.page.frameLocator('iframe[title*="preview"]').locator('#root'), 20_000)
            : null;
        ok('and it runs the generated app rather than a picture of it',
            wizardText?.includes('Harbour Dashboard') === true,
            wizardText === null ? 'nothing rendered in #root' : `#root reads "${wizardText}"`);
    } finally {
        await clientBrowser.close();
        stopPreview(vite);
    }

    console.log(failures === 0 ? '\npreview ok' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(1); });
