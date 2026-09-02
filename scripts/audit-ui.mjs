#!/usr/bin/env node
/**
 * Renders every surface and checks the things a compiler cannot.
 *
 * Written after a week in which typecheck, `vite build`, the design detector and
 * an exhaustive colour grep were all green while: a slider rendered browser
 * blue in an app with no blue in it; `--ease-fluid` and every radius token
 * compiled to invalid CSS and had *never once applied*, so every corner was
 * square and every transition used the default curve; and a mode pill was being
 * cropped by a container's overflow. Each was found by a human looking at a
 * phone.
 *
 * Four checks, each aimed at one of those:
 *
 *   tokens    a design utility that resolves to the browser default is a
 *             declaration the browser threw away. This is the regression test
 *             for the 43 dropped `ease-[--ease-fluid]` / `rounded-[--radius-*]`
 *             usages, and it asserts a PRESENCE, not an absence.
 *   targets   DESIGN.md mandates 44px. Nothing enforced it.
 *   clipping  an element cropped by an ancestor that cannot scroll to reveal it.
 *   overflow  the page must never scroll sideways.
 *
 * Usage:  node scripts/audit-ui.mjs [--url http://localhost:5199] [--shots DIR]
 */
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { launch, openPage, SURFACES, PHONE, DESKTOP } from './ui-harness.mjs';

const arg = (flag, fallback) => {
    const i = process.argv.indexOf(flag);
    return i > -1 ? process.argv[i + 1] : fallback;
};
const SHOTS = process.argv.includes('--shots') ? arg('--shots', null) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/**
 * Serve the built output, not the dev server.
 *
 * Two reasons, one practical and one principled. Practically, transpiling on
 * demand for two dozen fresh browser contexts kills Vite's dev server on this
 * device — it died twice, mid-run, and a crashed server looks exactly like a
 * passing audit until you read the error. Principally, `dist/` is what ships;
 * auditing anything else audits something nobody runs.
 */
const PORT = 5311;

/**
 * Refuse to audit a stale build.
 *
 * `npm run audit:ui` builds first, but running this file directly does not — and
 * doing exactly that produced a clean-looking report against the previous
 * `dist/`, showing five violations that had already been fixed. Auditing the
 * wrong artifact is the same mistake as grepping for the wrong string: the
 * output is confident and it is about something else.
 */
const assertFreshBuild = async () => {
    const { statSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const newest = (dir, acc = 0) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const full = join(dir, e.name);
            acc = e.isDirectory() ? newest(full, acc) : Math.max(acc, statSync(full).mtimeMs);
        }
        return acc;
    };
    let built;
    try { built = newest('dist/assets'); }
    catch { console.error('No dist/. Run `npm run build` (or use `npm run audit:ui`).'); process.exit(1); }
    const source = Math.max(newest('components'), statSync('App.tsx').mtimeMs, statSync('index.css').mtimeMs);
    if (source > built) {
        const age = Math.round((source - built) / 1000);
        console.error(`dist/ is ${age}s older than the source it is built from.`);
        console.error('Auditing it would report on code you have already changed. Run `npm run audit:ui`.');
        process.exit(1);
    }
};

const startPreview = async () => {
    // --host 127.0.0.1 is not optional: `vite preview` binds "localhost", which
    // resolves to ::1 here, and the readiness probe on 127.0.0.1 then fails
    // against a server that is perfectly alive.
    const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
        stdio: ['ignore', 'pipe', 'pipe'], detached: false,
    });
    let log = '';
    proc.stdout.on('data', d => { log += d; });
    proc.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${PORT}/`);
            if (r.ok) return proc;
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 500));
    }
    console.error(`preview server never came up on ${PORT}:\n${log}`);
    console.error('Did you run `npm run build` first?');
    proc.kill();
    process.exit(1);
};
const URL = arg('--url', `http://127.0.0.1:${PORT}/`);

/** Runs inside the page. Returns findings for the surface currently shown. */
const AUDIT = () => {
    const visible = el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = getComputedStyle(el);
        return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };
    const label = el => {
        const cls = (el.className?.baseVal ?? el.className ?? '').toString().trim().split(/\s+/).slice(0, 3).join('.');
        const text = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30);
        return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
    };

    const findings = { tokens: [], targets: [], clipping: [], overflow: [] };

    // --- tokens: a utility whose declaration the browser dropped --------------
    // Each entry: the class, the property it must change, and the value that
    // means "nothing was applied".
    const TOKEN_RULES = [
        { cls: 'rounded-card',  prop: 'borderRadius',             dead: v => v === '0px' },
        { cls: 'rounded-core',  prop: 'borderRadius',             dead: v => v === '0px' },
        { cls: 'rounded-shell', prop: 'borderRadius',             dead: v => v === '0px' },
        { cls: 'bezel-core',    prop: 'borderRadius',             dead: v => v === '0px' },
        { cls: 'bezel-shell',   prop: 'borderRadius',             dead: v => v === '0px' },
        { cls: 'plane',         prop: 'borderRadius',             dead: v => v === '0px' },
        { cls: 'ease-fluid',    prop: 'transitionTimingFunction', dead: v => !v.includes('cubic-bezier') || v.includes('0.25, 0.1') },
        { cls: 'hairline',      prop: 'boxShadow',                dead: v => v === 'none' },
        { cls: 'meta',          prop: 'fontFamily',               dead: v => !/mono/i.test(v) },
    ];
    for (const rule of TOKEN_RULES) {
        for (const el of document.querySelectorAll(`.${CSS.escape(rule.cls)}`)) {
            if (!visible(el)) continue;
            const value = getComputedStyle(el)[rule.prop];
            if (rule.dead(value)) {
                findings.tokens.push(`.${rule.cls} → ${rule.prop}: ${value}  on ${label(el)}`);
                break;   // one example per utility is enough to fail the build
            }
        }
    }
    // accent-* utilities: `accent-color: auto` means the declaration was dropped.
    // The class must be an accent utility, not merely contain the string: the
    // first version of this matched `hover:text-accent-soft` and reported a
    // button that has no accent-color and never wanted one.
    const isAccentUtility = cls => cls.split(/\s+/).some(token => {
        const bare = token.split(':').pop();          // strip md: / hover: / focus:
        return bare.startsWith('accent-');
    });
    for (const el of document.querySelectorAll('[class*="accent-"]')) {
        if (!visible(el)) continue;
        if (!isAccentUtility(el.className.toString())) continue;
        const v = getComputedStyle(el).accentColor;
        if (v === 'auto') findings.tokens.push(`accent utility → accent-color: auto on ${label(el)}`);
    }

    // --- targets: DESIGN.md says 44px, always, desktop included --------------
    const INTERACTIVE = 'button, a[href], select, textarea, [role="button"], [role="tab"], summary, input:not([type="hidden"])';
    for (const el of document.querySelectorAll(INTERACTIVE)) {
        if (!visible(el)) continue;
        // A checkbox wrapped in a <label> is tapped through the whole label, so
        // the label is the target. Measuring the 20px box would report a
        // violation that a finger never experiences.
        const wrapper = el.closest('label');
        const r = (wrapper && wrapper.contains(el) ? wrapper : el).getBoundingClientRect();
        if (r.width < 43.5 || r.height < 43.5) {
            findings.targets.push(`${Math.round(r.width)}×${Math.round(r.height)}  ${label(el)}`);
        }
    }

    // --- clipping: cropped by an ancestor that cannot scroll to reveal it ----
    //
    // The first run of this check produced 168 findings and almost all of them
    // were wrong, which is a useful thing for a new checker to do early. An
    // ancestor's `overflow` only clips a descendant that the ancestor actually
    // lays out. A `position: fixed` element is laid out against the viewport, so
    // the closed Memory drawer — parked off-screen at translate-x-full, exactly
    // as designed — was reported as "cropped" on every single surface. An
    // absolutely positioned element answers to its nearest positioned ancestor
    // and to nothing above it.
    //
    // A checker that cries wolf on every screen is worse than no checker: it
    // trains you to skim the output, which is how the real finding gets missed.
    for (const el of document.querySelectorAll('body *')) {
        if (!visible(el)) continue;
        if (el.closest('[aria-hidden="true"]')) continue;   // shut drawers, hidden dialogs
        const pos = getComputedStyle(el).position;
        if (pos === 'fixed') continue;                      // laid out by the viewport
        const r = el.getBoundingClientRect();
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            const s = getComputedStyle(a);
            // A descendant of a fixed element is also positioned against the
            // viewport, so nothing above that element clips it. Missing this
            // reported the whole file tree inside the phone's Explorer sheet as
            // "cropped" by the IDE pane it deliberately floats over.
            if (s.position === 'fixed') break;
            // an absolutely positioned element is not clipped by anything below
            // its containing block
            if (pos === 'absolute' && s.position !== 'static') {
                const clipped = s.overflowY !== 'visible' || s.overflowX !== 'visible';
                if (!clipped) break;
            }
            const clipsY = s.overflowY !== 'visible';
            const clipsX = s.overflowX !== 'visible';
            if (!clipsY && !clipsX) {
                if (pos === 'absolute' && s.position !== 'static') break;
                continue;
            }
            const ar = a.getBoundingClientRect();
            const canScrollY = a.scrollHeight - a.clientHeight > 2;
            const canScrollX = a.scrollWidth - a.clientWidth > 2;
            if (clipsY && !canScrollY && (r.top < ar.top - 1 || r.bottom > ar.bottom + 1)) {
                findings.clipping.push(`${label(el)} cropped vertically by ${label(a)} (cannot scroll)`);
            } else if (clipsX && !canScrollX && (r.left < ar.left - 1 || r.right > ar.right + 1)) {
                findings.clipping.push(`${label(el)} cropped horizontally by ${label(a)} (cannot scroll)`);
            }
            break;   // nearest clipping ancestor only
        }
    }

    // --- unreachable: content above a scroll container's origin --------------
    //
    // A scroll container that also centres its children pushes overflow ABOVE
    // scrollTop 0, where no gesture can reach it. The export screen lost its own
    // heading this way, and the clipping check above waved it through because
    // the container *could* scroll — just never far enough up.
    for (const c of document.querySelectorAll('body *')) {
        const s = getComputedStyle(c);
        if (s.overflowY !== 'auto' && s.overflowY !== 'scroll') continue;
        if (c.scrollTop !== 0) continue;                 // only judge at the origin
        const cr = c.getBoundingClientRect();
        // Descendants, not children. The first version of this compared only
        // direct children and missed the real case entirely: the wrapper began
        // at the origin while everything inside it sat 191px above, because a
        // flex child had been shrunk to its min-height and then centred its
        // overflow in both directions. Report the worst offender only — one
        // mis-set container makes every element inside it a finding.
        let worst = null;
        for (const d of c.querySelectorAll('*')) {
            if (!visible(d)) continue;
            const pos = getComputedStyle(d).position;
            if (pos === 'fixed' || pos === 'sticky') continue;
            const top = d.getBoundingClientRect().top;
            if (top < cr.top - 2 && (!worst || top < worst.top)) worst = { el: d, top };
        }
        if (worst) {
            findings.clipping.push(
                `${label(worst.el)} sits ${Math.round(cr.top - worst.top)}px above the scroll origin of ` +
                `${label(c)} — unreachable by scrolling`);
        }
    }

    // --- origins: nothing may be fetched cross-origin -------------------------
    //
    // Not a style rule. The preview-runtime decision (DESIGN.md §5) keeps the
    // door open to WebContainer, which needs cross-origin isolation, which
    // needs `COEP: require-corp` — under which the document REFUSES any
    // cross-origin subresource that has not opted in, silently.
    //
    // The app already satisfies this and nobody had written it down: the server
    // converts Veo downloads and generated images to `data:` URLs before they
    // reach the browser, uploads go through FileReader, and the fonts are
    // self-hosted. That invariant is easy to break with one convenient CDN URL,
    // so it is checked rather than remembered.
    const ORIGIN_OK = /^(data:|blob:|about:|$)/;
    for (const el of document.querySelectorAll('img[src], video[src], source[src], iframe[src], audio[src], link[rel="stylesheet"], script[src]')) {
        const raw = el.getAttribute('src') || el.getAttribute('href') || '';
        if (ORIGIN_OK.test(raw)) continue;
        let url;
        try { url = new URL(raw, location.href); } catch { continue; }
        if (url.origin === location.origin) continue;
        findings.overflow.push(`cross-origin resource: <${el.tagName.toLowerCase()}> ${url.origin}${url.pathname} — breaks under COEP`);
    }

    // --- overflow: the page itself must never scroll sideways ----------------
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) {
        findings.overflow.push(`page scrolls horizontally: ${de.scrollWidth}px content in ${de.clientWidth}px viewport`);
    }

    // de-duplicate; the same structural mistake repeats across list items
    for (const k of Object.keys(findings)) findings[k] = [...new Set(findings[k])];
    return findings;
};

const run = async () => {
    if (!arg('--url', null)) await assertFreshBuild();
    const preview = arg('--url', null) ? null : await startPreview();
    const browser = await launch();
    const report = [];
    let total = 0;

    for (const [profileName, profile] of [['phone', PHONE], ['desktop', DESKTOP]]) {
        for (const surface of SURFACES) {
            if (!surface[profileName]) continue;
            const { context, page } = await openPage(browser, profile, URL, surface.seed);
            const where = `${profileName}/${surface.name}`;
            try {
                await surface.reach(page);
                await page.waitForTimeout(500);
                if (SHOTS) await page.screenshot({ path: `${SHOTS}/${profileName}-${surface.name}.png` });
                const f = await page.evaluate(AUDIT);
                const count = Object.values(f).flat().length;
                total += count;
                report.push({ where, ...f, count });
                process.stdout.write(count === 0 ? '.' : '!');
            } catch (e) {
                report.push({ where, unreachable: e.message.split('\n')[0], count: 0 });
                process.stdout.write('?');
            }
            await context.close();
        }
    }
    console.log('\n');

    const unreachable = report.filter(r => r.unreachable);
    if (unreachable.length) {
        console.log('COULD NOT REACH — a surface that cannot be visited is not a surface that passed:');
        for (const r of unreachable) console.log(`  ${r.where}: ${r.unreachable}`);
        console.log('');
    }

    for (const kind of ['tokens', 'targets', 'clipping', 'overflow']) {
        const hits = report.filter(r => r[kind]?.length);
        if (!hits.length) continue;
        console.log(`${kind.toUpperCase()}`);
        for (const r of hits) {
            console.log(`  ${r.where}`);
            for (const line of r[kind]) console.log(`    ${line}`);
        }
        console.log('');
    }

    const visited = report.length - unreachable.length;
    console.log(`${visited} surface(s) audited, ${total} finding(s).`);
    await browser.close();
    preview?.kill();

    // A surface we could not reach is a coverage hole, and a coverage hole is
    // indistinguishable from a pass. Fail on it.
    if (total > 0 || unreachable.length > 0) process.exit(2);
    console.log('ui ok');
};

run().catch(e => { console.error('AUDIT FAILED TO RUN:', e.message); process.exit(1); });
