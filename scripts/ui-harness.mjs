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
export const SURFACES = [
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
    { name: 'code-terminal',   phone: true,  desktop: false, reach: async p => {
        await bottomTab(p, 'Projects'); await railTab(p, 'Agents');
        await p.getByText('Harbour Builder').click(); await p.waitForTimeout(500);
        await bottomTab(p, 'Code');
        await p.getByRole('button', { name: 'Terminal' }).first().click(); await p.waitForTimeout(400);
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

export const openPage = async (browser, profile, url) => {
    const context = await browser.newContext(profile);
    await context.addInitScript(([seed, convo, agentId]) => {
        for (const [k, v] of Object.entries(seed)) {
            localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
        localStorage.setItem(`gemini_messages_${agentId}`, JSON.stringify(convo));
        localStorage.setItem('gemini_messages_general', JSON.stringify(convo));
    }, [SEED, CONVERSATION, AGENT_ID]);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    return { context, page };
};

export const launch = () => chromium.launch({
    executablePath: findChrome(),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
