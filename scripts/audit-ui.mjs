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
import { launch, openPage, assertBackend, SURFACES, DECLARED_DESTINATIONS, PHONE, DESKTOP } from './ui-harness.mjs';

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
    /* Every source root the client bundle is built from. `components/` alone was
       enough while the UI lived entirely there; diagnostics put real behaviour in
       `hooks/` and `services/`, and a root that is not listed here is a change this
       check will cheerfully certify as already built. */
    const roots = ['components', 'hooks', 'services', 'context', 'utils', 'types'];
    const source = Math.max(
        ...roots.map(r => { try { return newest(r); } catch { return 0; } }),
        statSync('App.tsx').mtimeMs,
        statSync('index.css').mtimeMs,
    );
    if (source > built) {
        const age = Math.round((source - built) / 1000);
        console.error(`dist/ is ${age}s older than the source it is built from.`);
        console.error('Auditing it would report on code you have already changed. Run `npm run audit:ui`.');
        process.exit(1);
    }
};

const stopPreview = (proc) => {
    if (!proc) return;
    try { process.kill(-proc.pid, 'SIGTERM'); }
    catch { proc.kill('SIGTERM'); }
};

const startPreview = async () => {
    // --host 127.0.0.1 is not optional: `vite preview` binds "localhost", which
    // resolves to ::1 here, and the readiness probe on 127.0.0.1 then fails
    // against a server that is perfectly alive.
    const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
        // `detached` so the whole group can be signalled at once: `npx` is not the
        // server, it is the server's parent, and killing it alone leaves vite holding
        // the port for the next run to trip over -- and its pipes open, which keeps
        // this script alive long after it has printed its verdict.
        stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    let log = '';
    proc.stdout.on('data', d => { log += d; });
    proc.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 60; i++) {
        // Our own child, before anything else. `--strictPort` makes vite exit
        // when the port is taken, and a leftover preview server from an earlier
        // run answers 200 on the very next poll — so a probe that only asks
        // "is something listening?" happily audits a stale build served by a
        // process this run did not start and cannot configure. That is how a
        // correct API_TARGET still produced a hung audit: the answering server
        // was the previous one, still pointed at the wrong backend.
        if (proc.exitCode !== null) {
            console.error(`preview server exited (code ${proc.exitCode}) instead of serving ${PORT}:`);
            console.error(log.trim() || '(no output)');
            if (/already in use/i.test(log)) {
                console.error(`\nSomething else holds ${PORT}. Free it:  pkill -f "vite preview --port ${PORT}"`);
            }
            process.exit(1);
        }
        try {
            const r = await fetch(`http://127.0.0.1:${PORT}/`);
            if (r.ok) return proc;
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 500));
    }
    console.error(`preview server never came up on ${PORT}:\n${log}`);
    console.error('Did you run `npm run build` first?');
    stopPreview(proc);
    process.exit(1);
};
const URL = arg('--url', `http://127.0.0.1:${PORT}/`);
/* `--only <substring>` narrows the walk while iterating on one surface. It is never
   how the gate runs — a filtered pass is not a pass — so the summary says so out loud
   and refuses to print the all-clear. */
const ONLY = arg('--only', null);

/** Runs inside the page. Returns findings for the surface currently shown. */
const AUDIT = (expected) => {
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

    const findings = { tokens: [], targets: [], clipping: [], overflow: [], duplicates: [] };

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
    /**
     * The one named exception, and it is a real cost rather than a formality.
     *
     * `SandpackAppPreview.tsx` embeds `*.codesandbox.io` on purpose — there is no
     * same-origin way to get Sandpack's CDN-resolved bundling (A0's plan). Taking
     * that iframe means WebContainer (DESIGN.md §5) is no longer "cheap to take
     * later": `COEP: require-corp` would silently kill this surface too, and
     * unlike the rest of the app this one cannot be routed through our own server
     * first, because the whole point is Sandpack's own bundler. If WebContainer is
     * ever pursued, this surface is what has to change — self-host Sandpack's
     * bundler or drop it — not a config line.
     */
    const CROSS_ORIGIN_EXCEPTIONS = [/(^|\.)codesandbox\.io$/];
    for (const el of document.querySelectorAll('img[src], video[src], source[src], iframe[src], audio[src], link[rel="stylesheet"], script[src]')) {
        const raw = el.getAttribute('src') || el.getAttribute('href') || '';
        if (ORIGIN_OK.test(raw)) continue;
        let url;
        try { url = new URL(raw, location.href); } catch { continue; }
        if (url.origin === location.origin) continue;
        if (CROSS_ORIGIN_EXCEPTIONS.some(re => re.test(url.hostname))) continue;
        findings.overflow.push(`cross-origin resource: <${el.tagName.toLowerCase()}> ${url.origin}${url.pathname} — breaks under COEP`);
    }

    // --- duplicates: one reachable control per destination -------------------
    // The dock renders its children three times to fake an endless strip, so every
    // destination exists three times in the DOM. Two sets must be `inert` — not merely
    // `aria-hidden`, which leaves a focusable button a keyboard walks into and a screen
    // reader then refuses to describe. It shipped wrong once: React 19 takes `inert` as
    // a boolean and silently drops `inert=""`, giving eighteen focusable controls for
    // six destinations, with every name announced three times.
    // Scoped to the dock itself. A first attempt counted matching names across the whole
    // page and reported 98 findings that were all real controls with the same label — the
    // rail's own Projects tab, the floating Memory trigger. The hazard being guarded is
    // narrower than "two things share a name": it is *the same control rendered three
    // times*, which is a property of the dock and of nothing else.
    const dockRoot = document.querySelector('[data-dock-live]')?.parentElement;
    if (dockRoot) {
        const inDock = [...dockRoot.querySelectorAll('button, a[href], [role="button"]')]
            .filter(el => !el.closest('[inert]') && !el.closest('[aria-hidden="true"]'));
        const byName = new Map();
        for (const el of inDock) {
            const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
            if (name) byName.set(name, (byName.get(name) ?? 0) + 1);
        }
        for (const [name, count] of byName) {
            if (count > 1) {
                findings.duplicates.push(`dock: "${name}" is reachable ${count} times — a clone that is not inert`);
            }
        }
        const copies = dockRoot.children.length;
        const hiddenCopies = [...dockRoot.children].filter(c => c.getAttribute('aria-hidden') === 'true').length;
        if (copies > 1 && hiddenCopies !== copies - 1) {
            findings.duplicates.push(`dock: ${copies} copies but ${hiddenCopies} aria-hidden — every copy but one must be hidden`);
        }

        /* **A control you can see must do something.**
           This is the check that was missing, and its absence is why the dock shipped
           with fourteen visible dead buttons on a 1440px desktop: one copy is ~510px, so
           the scrollport showed most of both outer copies flanking the live one, and the
           duplicates check above passed *because* it deliberately filters clones out.
           A clean report and a two-thirds-dead dock looked identical from here.

           `inert` and `pointer-events: none` are the two ways a rendered control silently
           refuses input. Measured against the viewport, not the document: a clone parked
           off screen is the mechanism working, not a fault. */
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        for (const el of dockRoot.querySelectorAll('button, a[href], [role="button"]')) {
            const box = el.getBoundingClientRect();
            const onScreen = box.width > 0 && box.height > 0
                && box.right > 0 && box.left < vw && box.bottom > 0 && box.top < vh;
            if (!onScreen) continue;
            const name = el.lastElementChild?.textContent?.trim() || el.getAttribute('aria-label') || '(unnamed)';
            if (el.closest('[inert]')) {
                findings.duplicates.push(`dock: "${name}" is on screen but inert — a control you can see that ignores you`);
            } else if (getComputedStyle(el).pointerEvents === 'none') {
                findings.duplicates.push(`dock: "${name}" is on screen but has pointer-events:none`);
            }
        }

        /* And the other half of what `inert` used to buy: one tab stop per destination,
           not one per copy. A clone stays clickable, so this is what keeps a keyboard
           from walking the same six destinations three times. */
        const tabbable = [...dockRoot.querySelectorAll('button, a[href], [role="button"]')]
            .filter(el => el.tabIndex >= 0 && !el.closest('[inert]'));
        const tabNames = new Map();
        for (const el of tabbable) {
            const name = el.lastElementChild?.textContent?.trim() || el.getAttribute('aria-label') || '(unnamed)';
            tabNames.set(name, (tabNames.get(name) ?? 0) + 1);
        }
        for (const [name, count] of tabNames) {
            if (count > 1) findings.duplicates.push(`dock: "${name}" is a tab stop ${count} times — a clone left in the focus order`);
        }

        /* The dock is the only navigation, so its contents are the whole answer to
           "what can I get to". A destination declared in `types/ui.ts` with no item
           here is a page with no door; an item here for nothing declared is a door to
           nowhere. Both render perfectly and audit clean, which is why this is
           compared rather than eyeballed. `expected` is read from the app's own
           declaration by the harness, not restated. */
        /* `lastElementChild`, not `querySelector('span:last-child')`: the accent dot is
           also a last child, of the icon wrapper, and document order reaches it first.
           The label is the button's own last element child, which is unambiguous. */
        const present = new Set([...inDock].map(el => el.lastElementChild?.textContent?.trim()).filter(Boolean));
        for (const name of expected) {
            if (!present.has(name)) findings.duplicates.push(`dock: "${name}" is declared but has no item — a destination with no door`);
        }
        for (const name of present) {
            if (!expected.includes(name)) findings.duplicates.push(`dock: "${name}" is an item for nothing declared — a door to nowhere`);
        }
    }

    /* --- operable: a control you can see must respond to you -----------------
       Generalised out of the dock, where it was found. Scoping it to the dock would
       repeat the mistake that let the dock bug through: a check narrow enough to miss
       the next instance of its own class.

       `disabled` is not a fault — it is a visible, explained state with a title, and
       this app uses it deliberately for destinations with nothing behind them. `inert`
       and `pointer-events: none` are different: the control looks live and silently
       is not. That gap between what a control promises and what it does is the whole
       finding. */
    for (const el of document.querySelectorAll(INTERACTIVE)) {
        if (!visible(el)) continue;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) || '(unnamed)';
        if (el.closest('[inert]')) {
            findings.targets.push(`${label(el)} "${name}" is on screen but inert — it looks live and ignores you`);
        } else if (getComputedStyle(el).pointerEvents === 'none' && !el.closest('[aria-hidden="true"]')) {
            findings.targets.push(`${label(el)} "${name}" is on screen but has pointer-events:none`);
        }
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

/**
 * Every iframe's own document must fit the frame it was given.
 *
 * Playwright reaches a sandboxed frame through CDP, which the page's own JavaScript
 * cannot. A frame that scrolls sideways is either a document written for a width it
 * did not get, or one that should have been scaled — and to a reader it is simply
 * content cut in half.
 */
const framedOverflow = async (page) => {
    const found = [];
    for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
            const box = await frame.evaluate(() => {
                const de = document.documentElement;
                return { scroll: de.scrollWidth, client: de.clientWidth, title: document.title };
            });
            /* 1px of slack for sub-pixel layout; anything more is a real clip. */
            if (box.client > 0 && box.scroll > box.client + 1) {
                found.push(`iframe content ${box.scroll}px wide in a ${box.client}px frame ("${box.title || 'untitled'}")`);
            }
        } catch { /* a frame that cannot be read is not evidence of a fault */ }
    }
    return [...new Set(found)];
};

const run = async () => {
    if (!arg('--url', null)) { await assertFreshBuild(); await assertBackend(); }
    const preview = arg('--url', null) ? null : await startPreview();
    const browser = await launch();
    const report = [];
    let total = 0;

    for (const [profileName, profile] of [['phone', PHONE], ['desktop', DESKTOP]]) {
        for (const surface of SURFACES) {
            if (!surface[profileName]) continue;
            if (ONLY && !surface.name.includes(ONLY)) continue;
            const { context, page } = await openPage(browser, profile, URL, surface.seed);
            const where = `${profileName}/${surface.name}`;
            try {
                await surface.reach(page);
                await page.waitForTimeout(500);
                if (SHOTS) await page.screenshot({ path: `${SHOTS}/${profileName}-${surface.name}.png` });
                const f = await page.evaluate(AUDIT, DECLARED_DESTINATIONS);
                /* Inner frame overflow, measured from outside.
                   The page probe cannot see this: a `sandbox=""` frame has an opaque
                   origin, so `contentDocument` is unreachable from the page — which is
                   exactly why a document overflowing its own iframe was invisible to
                   every check here while being the most visible fault on the screen.
                   The design contract laid out at ~760px inside a ~262px card, clipped
                   mid-nav, and nothing failed. */
                f.framed = await framedOverflow(page);
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

    for (const kind of ['tokens', 'targets', 'clipping', 'overflow', 'framed', 'duplicates']) {
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
    console.log(`${visited} surface(s) audited, ${total} finding(s).${ONLY ? ` (filtered by --only ${ONLY}: NOT a full pass)` : ''}`);
    await browser.close();
    stopPreview(preview);

    // A surface we could not reach is a coverage hole, and a coverage hole is
    // indistinguishable from a pass. Fail on it.
    if (total > 0 || unreachable.length > 0) process.exit(2);
    if (ONLY) { console.log('filtered run clean — run without --only before calling it green'); process.exit(0); }
    console.log('ui ok');
    process.exit(0);
};

run().catch(e => { console.error('AUDIT FAILED TO RUN:', e.message); process.exit(1); });
