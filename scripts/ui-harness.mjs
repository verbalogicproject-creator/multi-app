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
import { existsSync } from 'node:fs';

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
 * Scoped, and visibility-aware.
 *
 * Both of these were wrong on the first run. `getByRole('button', {name:'Projects'})`
 * matched two elements — the rail tab and the bottom-bar tab — and Playwright's
 * strict mode refused, so two surfaces went unvisited. And `md:hidden` removes
 * an element from view without removing it from the DOM, so a `.count()` check
 * happily clicked a bar that is not on screen at desktop width and then timed
 * out. Scope by container, gate on visibility, never on existence.
 */
const railTab = async (page, name) => {
    await page.locator('aside').getByRole('button', { name, exact: true }).first().click();
    await page.waitForTimeout(400);
};

const bottomBar = page => page.locator('nav[aria-label="Sections"]');

const bottomTab = async (page, name) => {
    const bar = bottomBar(page);
    if (!(await bar.isVisible().catch(() => false))) return false;   // desktop: no bar
    await bar.locator('button', { hasText: name }).click();
    await page.waitForTimeout(400);
    return true;
};

/**
 * Every surface, and how to reach it. `phone` and `desktop` say where each one
 * is meaningful — the bottom bar does not exist above md:, and the rail is not a
 * destination below it.
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
const FILES = {
    'src/App.tsx': "export default function App() { return <main>harbour</main>; }\n",
    'preview.html': '<!doctype html><html><body style="font-family:system-ui;padding:2rem"><h1>Harbour Dashboard</h1><p>Berth occupancy at a glance.</p></body></html>',
};
const EVIDENCE = [
    { ts: 1756700000000, event: 'Blueprint approved — 1 pages, 1 components, 2 acceptance criteria' },
    { ts: 1756700060000, event: 'Direction selected — Charcoal' },
];
const wizard = extra => ({ gemini_builder_state: {
    isActive: true, idea: 'A dashboard showing harbour berth occupancy.',
    plan: PLAN, theme: THEME, generatedFiles: null, evidence: EVIDENCE, ...extra } });

export const SURFACES = [
    { name: 'wizard-1-idea',     phone: true, desktop: true, seed: wizard({ currentStep: 1 }),                        reach: async () => {} },
    { name: 'wizard-2-plan',     phone: true, desktop: true, seed: wizard({ currentStep: 2 }),                        reach: async () => {} },
    { name: 'wizard-3-theme',    phone: true, desktop: true, seed: wizard({ currentStep: 3 }),                        reach: async () => {} },
    // Step 4 with a held candidate: the screen where a failed verdict waits for
    // a decision. Without candidateFiles it is treated as an interrupted run.
    { name: 'wizard-4-held',     phone: true, desktop: true, reach: async () => {},
      seed: wizard({ currentStep: 4, candidateFiles: FILES, validation: { ok: false, checked: 2, issues: [
          { severity: 'error', code: 'unresolved-import', message: 'src/App.tsx imports ./Chart, which was never emitted.', file: 'src/App.tsx' },
          { severity: 'warning', code: 'placeholder-text', message: 'Lorem ipsum remains in the hero copy.', file: 'preview.html' },
      ] } }) },
    { name: 'wizard-5-export',   phone: true, desktop: true, seed: wizard({ currentStep: 5, generatedFiles: FILES, validation: { ok: true, checked: 2, issues: [] } }), reach: async () => {} },
    { name: 'projects',        phone: true,  desktop: true,  reach: async p => { await bottomTab(p, 'Projects'); await railTab(p, 'Projects'); } },
    { name: 'agents',          phone: true,  desktop: true,  reach: async p => { await bottomTab(p, 'Projects'); await railTab(p, 'Agents'); } },
    { name: 'ai-tools',        phone: true,  desktop: true,  reach: async p => { await bottomTab(p, 'Projects'); await railTab(p, 'AI Tools'); } },
    // The one the last pass missed. It holds the sliders, toggles and selects —
    // the densest collection of native controls in the app.
    { name: 'ai-settings',     phone: true,  desktop: true,  reach: async p => { await bottomTab(p, 'Projects'); await railTab(p, 'AI Settings'); } },
    { name: 'chat-general',    phone: true,  desktop: true,  reach: async p => { await bottomTab(p, 'Chat'); } },
    { name: 'builder-wizard',  phone: true,  desktop: true,  reach: async p => {
        await bottomTab(p, 'Projects'); await railTab(p, 'AI Tools');
        await bottomTab(p, 'Build');
    } },
    { name: 'agent-chat',      phone: true,  desktop: true,  reach: async p => {
        await bottomTab(p, 'Projects'); await railTab(p, 'Agents');
        await p.getByText('Harbour Builder').click(); await p.waitForTimeout(500);
        await bottomTab(p, 'Chat');
    } },
    { name: 'code',            phone: true,  desktop: true,  reach: async p => {
        await bottomTab(p, 'Projects'); await railTab(p, 'Agents');
        await p.getByText('Harbour Builder').click(); await p.waitForTimeout(500);
        await bottomTab(p, 'Code');
    } },
    { name: 'code-tree-sheet', phone: true,  desktop: false, reach: async p => {
        await bottomTab(p, 'Projects'); await railTab(p, 'Agents');
        await p.getByText('Harbour Builder').click(); await p.waitForTimeout(500);
        await bottomTab(p, 'Code');
        await p.getByRole('button', { name: /^Choose file/ }).click(); await p.waitForTimeout(400);
    } },
    // The bottom block is a tab strip now, so these are tabs, not buttons. The
    // audit caught the change by failing to reach the surface at all, which is
    // the point of treating an unreachable surface as a failure.
    { name: 'code-terminal',   phone: true,  desktop: false, reach: async p => {
        await bottomTab(p, 'Projects'); await railTab(p, 'Agents');
        await p.getByText('Harbour Builder').click(); await p.waitForTimeout(500);
        await bottomTab(p, 'Code');
        await p.getByRole('tab', { name: /Terminal/ }).first().click(); await p.waitForTimeout(400);
    } },
    // The seeded project carries a deliberate type error, so this surface is the
    // populated panel rather than its empty state. Given the checker is a
    // subprocess, it needs longer than the other surfaces to have anything to show.
    { name: 'code-problems',   phone: true,  desktop: true,  reach: async p => {
        await bottomTab(p, 'Projects'); await railTab(p, 'Agents');
        await p.getByText('Harbour Builder').click(); await p.waitForTimeout(500);
        await bottomTab(p, 'Code');
        await p.getByRole('tab', { name: /Problems/ }).first().click();
        await p.waitForTimeout(6000);
    } },
    { name: 'memory',          phone: true,  desktop: true,  reach: async p => {
        // Phone: the bottom bar. Desktop: the floating trigger, whose accessible
        // name is "Memory" or "Memory — something needs you". The drawer's own
        // close control is "Close memory", so anchoring at the start is enough.
        if (!(await bottomTab(p, 'Memory'))) {
            await p.getByRole('button', { name: /^Memory($| —)/ }).click();
        }
        await p.waitForTimeout(800);
    } },
    { name: 'project-settings', phone: true, desktop: true,  reach: async p => {
        await bottomTab(p, 'Projects'); await railTab(p, 'Projects');
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
