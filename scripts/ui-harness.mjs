/**
 * Shared browser harness: one browser, seeded state, and the list of every
 * surface this app can show.
 *
 * The list is the point. The last screenshot pass visited eleven states, missed
 * the AI Settings tab entirely, and a slider sat there rendering browser-default
 * blue in an app with no blue in it until Eyal photographed it himself. A
 * coverage hole and a clean result look identical from the outside, so the
 * surfaces are enumerated here, once, and both the audit and the screenshots
 * walk the same list.
 */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';

/** Chromium 1228 — the revision the pinned playwright-core expects. 1234 is 151. */
const CANDIDATES = [
    '/root/.cache/ms-playwright/chromium-1228/chrome-linux/chrome',
    '/root/.cache/ms-playwright/chromium-1234/chrome-linux/chrome',
];

export const findChrome = () => {
    const found = CANDIDATES.find(existsSync);
    if (!found) {
        console.error('No Chromium found. Looked in:\n  ' + CANDIDATES.join('\n  '));
        console.error('(~/.cache/puppeteer is empty scaffolding — do not look there.)');
        process.exit(1);
    }
    return found;
};

export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

const PROJECT_ID = 'proj-alpha';
const AGENT_ID = 'agent-1';

const SEED = {
    gemini_projects: [
        { id: PROJECT_ID, name: 'Harbour Dashboard', createdAt: 1756700000000,
          dependencySummary: 'react@19.1.1\nvite@5.4.21\ntailwindcss@4.3.3' },
        { id: 'proj-beta', name: 'Field Notes', createdAt: 1756600000000 },
    ],
    [`gemini_files_${PROJECT_ID}`]: [
        { id: 'f1', projectId: PROJECT_ID, path: 'src/App.tsx', type: 'text/plain', createdAt: 1,
          content: "import React from 'react';\n\nexport default function App() {\n  return <main>harbour</main>;\n}\n" },
        { id: 'f2', projectId: PROJECT_ID, path: 'src/components/Header.tsx', type: 'text/plain', createdAt: 2, content: 'export const Header = () => null;\n' },
        // A deliberate type error, and deliberately a *cross-file* one: the
        // interface it violates lives in another file, so a checker that only ever
        // saw one file at a time would call this project clean. Kept last so
        // `files[0]` is still src/App.tsx and the editor still opens on it.
        { id: 'f3', projectId: PROJECT_ID, path: 'src/types.ts', type: 'text/plain', createdAt: 3,
          content: 'export interface User { id: number; name: string; }\n' },
        { id: 'f4', projectId: PROJECT_ID, path: 'src/Broken.tsx', type: 'text/plain', createdAt: 4,
          content: "import type { User } from './types';\n\nexport const Broken = () => {\n  const user: User = { id: 'not-a-number', name: 'crate' };\n  return <span>{user.name}</span>;\n};\n" },
        // An entry point and a mount, so the IDE's Preview tab has something to
        // bundle. Without them the tab is reachable and shows a build error, which
        // is a real state worth having — but not the one that proves the app runs.
        // `Broken.tsx` is imported by nothing, so it never reaches the bundler: the
        // preview builds while the same project still has a type error to report,
        // which is exactly the pair the IDE has to hold at once.
        { id: 'f5', projectId: PROJECT_ID, path: 'index.html', type: 'text/plain', createdAt: 5,
          content: '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Harbour</title></head>'
              + '<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n' },
        { id: 'f6', projectId: PROJECT_ID, path: 'src/main.tsx', type: 'text/plain', createdAt: 6,
          content: "import { createRoot } from 'react-dom/client';\nimport App from './App';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n" },
    ],
    gemini_personas: [
        { id: 'p1', name: 'React Specialist', baseInstructions: 'You write React.',
          composedStyles: [{ name: 'The Pragmatist', weight: 1 }] },
    ],
    gemini_agents: [{ id: AGENT_ID, name: 'Harbour Builder', personaId: 'p1', projectId: PROJECT_ID }],
    gemini_selected_model: 'auto',
};

const CONVERSATION = [
    { id: 'm1', author: 'user', parts: [{ text: 'Make the header stick when you scroll.' }] },
    { id: 'm2', author: 'assistant', parts: [{ text: 'I will pin it with `position: sticky` and reserve its height so nothing jumps.' }] },
];

/**
 * Move to a destination — the dock's **live** copy, and only that one.
 *
 * Two things were wrong here before the dock, and both are worth keeping in mind. A
 * bare `getByRole('button', {name:'Projects'})` matched the rail tab *and* the bottom
 * bar, so strict mode refused and two surfaces went unvisited; and `md:hidden` removes
 * an element from view without removing it from the DOM, so an existence check happily
 * clicked a bar that was off screen and then timed out.
 *
 * The dock adds a third: it renders its children three times to fake an endless strip,
 * so every destination exists three times in the DOM. Two of the three sets are
 * `aria-hidden` and `inert`; only the live one carries `data-dock-live`. A CSS query
 * honours neither attribute and would match all three. Scope to the live set — which is
 * now the whole of navigation, at every width, so there is nothing else to scope to.
 */
export const dockTo = async (page, name) => {
    await page.locator('[data-dock-live] button', { hasText: name }).first().click();
    await page.waitForTimeout(400);
};

/**
 * Code and Preview both need a project open, and the dock disables them until one is.
 * Ticking the seeded project is what makes them reachable — the IDE follows a project,
 * not an agent, since `b8399a7`.
 */
export const openProjectThen = async (page, destination) => {
    await dockTo(page, 'Projects');
    const box = page.getByRole('checkbox', { name: 'Harbour Dashboard' });
    if (!(await box.isChecked().catch(() => true))) await box.check();
    await page.waitForTimeout(300);
    await dockTo(page, destination);
    await page.waitForTimeout(500);
};

/**
 * Every surface, and how to reach it.
 *
 * `phone` and `desktop` used to say where each surface *existed*, because the shell
 * had two navigation models and some surfaces only had a door in one of them. There is
 * one layout now, so every destination is meaningful at both widths and the two flags
 * mean what they should have meant all along: which viewports to audit it at. The two
 * that stay phone-only are drawers the wide layout does not need — the file sheet and
 * the editor's terminal, which sit beside the code above `md:` instead of over it.
 */
/**
 * The wizard's five steps are only reachable from an in-progress build, so they
 * are reached by seeding one rather than by clicking through five screens and a
 * model call. Without this, auditing "the wizard" audits its front door: the
 * shelf renders, every step behind it goes unseen, and a clean report means
 * nothing about the four screens where the work actually happens.
 */
const PLAN = {
    projectName: 'Harbour Dashboard',
    projectDescription: 'Berth occupancy at a glance, for the harbourmaster.',
    pages: [{ name: 'HomePage', path: '/', description: 'Live berth map and today\u2019s arrivals.' }],
    components: [{ name: 'BerthChart', description: 'Occupancy over the last 24 hours.' }],
    acceptanceCriteria: ['The berth chart updates without a reload.', 'Works on a phone in daylight.'],
};
const THEME = { palette: 'Charcoal', typography: 'Grotesk & Bold', colors: {
    bg: '#0b0b0c', surface: '#161617', primary: '#ea580c', accent: '#fb923c', text: '#f4f4f5', muted: '#9a9aa2' } };
/**
 * A project the preview bundler can actually build.
 *
 * It used to be one component plus a `preview.html` — a static snapshot the model was
 * asked to hand-write, which the export step rendered in a script-less iframe. That
 * file is retired, and with it the surface that displayed it: the wizard's last step
 * now bundles and runs this, so the fixture has to be a real entry point, a real
 * mount and a real stylesheet or the audited surface is a build error.
 */
const FILES = {
    'index.html': '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Harbour Dashboard</title></head>'
        + '<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    'package.json': '{"name":"harbour","dependencies":{"react":"^19","react-dom":"^19"}}',
    'src/index.css': '@import "tailwindcss";\n',
    'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './index.css';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
    'src/App.tsx': "export default function App() {\n"
        + "    return (\n"
        + "        <main className=\"max-w-6xl mx-auto px-4 py-16\">\n"
        + "            <h1 className=\"text-4xl font-bold\">Harbour Dashboard</h1>\n"
        + "            <p className=\"mt-4 text-slate-600\">Berth occupancy at a glance.</p>\n"
        + "        </main>\n"
        + "    );\n"
        + "}\n",
};
const EVIDENCE = [
    { ts: 1756700000000, event: 'Blueprint approved — 1 pages, 1 components, 2 acceptance criteria' },
    { ts: 1756700060000, event: 'Direction selected — Charcoal' },
];
const wizard = extra => ({ gemini_builder_state: {
    isActive: true, idea: 'A dashboard showing harbour berth occupancy.',
    plan: PLAN, theme: THEME, generatedFiles: null, evidence: EVIDENCE, ...extra } });

/**
 * The destinations the app itself declares, read out of `types/ui.ts` rather than
 * copied here.
 *
 * A hardcoded list would pass while drifting, which is the failure this exists to
 * catch: a `Surface` added to the union and never given a dock item is a page with no
 * door, and a dock item for a surface nothing renders is a door to nowhere. Both look
 * like a clean run from the outside, so the gate reads the declaration and compares it
 * to what the live dock actually renders.
 */
export const DECLARED_DESTINATIONS = (() => {
    const src = readFileSync(new URL('../types/ui.ts', import.meta.url), 'utf8');
    const order = src.match(/SURFACE_ORDER: Surface\[\] = \[([^\]]*)\]/)?.[1] ?? '';
    const names = [...order.matchAll(/'([^']+)'/g)].map(m => m[1]);
    const labels = Object.fromEntries(
        [...(src.match(/SURFACE_LABEL: Record<Surface, string> = \{([^}]*)\}/)?.[1] ?? '')
            .matchAll(/(\w[\w-]*):\s*'([^']*)'/g)].map(m => [m[1], m[2]]),
    );
    const missing = names.filter(n => !labels[n]);
    if (!names.length || missing.length) {
        throw new Error(`could not read SURFACE_ORDER/SURFACE_LABEL from types/ui.ts (missing: ${missing.join(', ') || 'all'})`);
    }
    /* Memory is a dock item without being a destination — it opens a drawer over
       wherever you are — so it is expected in the dock and absent from `Surface`. */
    return [...names.map(n => labels[n]), 'Memory'];
})();

export const SURFACES = [
    { name: 'wizard-1-idea',     phone: true, desktop: true, seed: wizard({ currentStep: 1 }),                        reach: async () => {} },
    { name: 'wizard-2-plan',     phone: true, desktop: true, seed: wizard({ currentStep: 2 }),                        reach: async () => {} },
    { name: 'wizard-3-theme',    phone: true, desktop: true, seed: wizard({ currentStep: 3 }),                        reach: async () => {} },
    // Step 4 with a held candidate: the screen where a failed verdict waits for
    // a decision. Without candidateFiles it is treated as an interrupted run.
    { name: 'wizard-4-held',     phone: true, desktop: true, reach: async () => {},
      seed: wizard({ currentStep: 4, candidateFiles: FILES, validation: { ok: false, checked: 2, issues: [
          { severity: 'error', code: 'unresolved-import', message: 'src/App.tsx imports ./Chart, which was never emitted.', file: 'src/App.tsx' },
          // `placeholder-content` is the real member of BuildIssueCode. This read
          // `placeholder-text` for a long time and failed nothing, because a fixture's
          // issues are only ever displayed — a fixture asserting against a vocabulary
          // that does not exist is still a fixture that has stopped describing the app.
          { severity: 'warning', code: 'placeholder-content', message: 'Lorem ipsum remains in the hero copy.', file: 'src/App.tsx' },
      ] } }) },
    { name: 'wizard-5-export',   phone: true, desktop: true, seed: wizard({ currentStep: 5, generatedFiles: FILES, validation: { ok: true, checked: 2, issues: [] } }), reach: async () => {} },
    // Every route below goes through the dock, because the dock is the only thing that
    // moves you between destinations now. The rail's tab strip is gone: Projects is a
    // destination, Agents and AI Settings are the Harness, and `AI Tools` was dead —
    // its tab lived in one destination while its content rendered in another.
    { name: 'projects',        phone: true,  desktop: true,  reach: async p => { await dockTo(p, 'Projects'); } },
    { name: 'harness-experts', phone: true,  desktop: true,  reach: async p => {
        await dockTo(p, 'Harness');
        await p.getByRole('tab', { name: 'Experts' }).click(); await p.waitForTimeout(400);
    } },
    // The densest collection of native controls in the app — sliders, toggles, selects.
    { name: 'harness-config',  phone: true,  desktop: true,  reach: async p => {
        await dockTo(p, 'Harness');
        await p.getByRole('tab', { name: 'Configuration' }).click(); await p.waitForTimeout(400);
    } },
    { name: 'chat-general',    phone: true,  desktop: true,  reach: async p => { await dockTo(p, 'Chat'); } },
    { name: 'builder-wizard',  phone: true,  desktop: true,  reach: async p => { await dockTo(p, 'Build'); } },
    { name: 'agent-chat',      phone: true,  desktop: true,  reach: async p => {
        await dockTo(p, 'Harness');
        await p.getByText('Harbour Builder').click(); await p.waitForTimeout(500);
        await dockTo(p, 'Chat');
    } },
    { name: 'code',            phone: true,  desktop: true,  reach: async p => { await openProjectThen(p, 'Code'); } },
    { name: 'code-tree-sheet', phone: true,  desktop: false, reach: async p => {
        await openProjectThen(p, 'Code');
        await p.getByRole('button', { name: /^Choose file/ }).click(); await p.waitForTimeout(400);
    } },
    { name: 'code-terminal',   phone: true,  desktop: false, reach: async p => {
        await openProjectThen(p, 'Code');
        await p.getByRole('tab', { name: /Terminal/ }).first().click(); await p.waitForTimeout(400);
    } },
    // The seeded project carries a deliberate type error, so this is the populated panel
    // rather than its empty state. The checker is a subprocess, so it needs longer than
    // the other surfaces to have anything to show.
    { name: 'code-problems',   phone: true,  desktop: true,  reach: async p => {
        await openProjectThen(p, 'Code');
        await p.getByRole('tab', { name: /Problems/ }).first().click();
        await p.waitForTimeout(6000);
    } },
    // Preview is its own destination now rather than a tab inside the IDE. The wait
    // covers the host's 400ms debounce plus a real esbuild + Tailwind pass.
    { name: 'preview',         phone: true,  desktop: true,  reach: async p => {
        await openProjectThen(p, 'Preview');
        await p.waitForTimeout(6000);
    } },
    { name: 'memory',          phone: true,  desktop: true,  reach: async p => {
        await dockTo(p, 'Memory');
        await p.waitForTimeout(800);
    } },
    { name: 'project-settings', phone: true, desktop: true,  reach: async p => {
        await dockTo(p, 'Projects');
        await p.getByRole('button', { name: /^Settings for/ }).first().click(); await p.waitForTimeout(500);
    } },
];

export const openPage = async (browser, profile, url, extraSeed = {}) => {
    const context = await browser.newContext(profile);
    await context.addInitScript(([seed, convo, agentId, extra]) => {
        for (const [k, v] of Object.entries({ ...seed, ...extra })) {
            localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
        localStorage.setItem(`gemini_messages_${agentId}`, JSON.stringify(convo));
        localStorage.setItem('gemini_messages_general', JSON.stringify(convo));
    }, [SEED, CONVERSATION, AGENT_ID, extraSeed]);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    return { context, page };
};

export const launch = () => chromium.launch({
    executablePath: findChrome(),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

/**
 * Prove the backend is *this app's* backend, not merely that something answers.
 *
 * Every surface is seeded from localStorage, so the audit does not need the API
 * for its assertions — but `vite preview` proxies `/api` regardless, and a proxy
 * whose upstream accepts the connection and never replies leaves the request
 * hanging, so `waitUntil: 'networkidle'` never fires and the run dies on a
 * `page.goto` timeout that reads exactly like broken UI.
 *
 * That is not hypothetical. Port 8080 was taken by an unrelated project's BFF,
 * which answers `/healthz` with `{status:'ok'}` — healthy, wrong app, and the
 * audit hung for thirty seconds and blamed the page. The default moved to 8050
 * because of it, which makes a collision unlikely rather than impossible: a
 * liveness check that any server can pass is still not a check, so this one
 * asserts the response shape only multi-app returns.
 */
export const assertBackend = async () => {
    const target = process.env.API_TARGET || 'http://localhost:8050';
    let body;
    try {
        const r = await fetch(`${target}/healthz`, { signal: AbortSignal.timeout(4000) });
        body = await r.json();
    } catch (e) {
        console.error(`No backend on ${target} — ${e.message}`);
        console.error('The preview proxy would hang on every /api call and the audit would');
        console.error('time out looking like a UI failure. Start it:  node server.js');
        console.error('(Or point elsewhere: API_TARGET=http://localhost:8090 <this command>)');
        process.exit(1);
    }
    if (!body || body.ok !== true || !body.models) {
        console.error(`Something is listening on ${target}, but it is not multi-app.`);
        console.error(`  /healthz returned: ${JSON.stringify(body)}`);
        console.error('  expected the shape: { ok: true, models: {...} }');
        console.error('Free the port, or run multi-app elsewhere and point at it:');
        console.error('  PORT=8090 node server.js  &&  API_TARGET=http://localhost:8090 <this command>');
        process.exit(1);
    }
};
