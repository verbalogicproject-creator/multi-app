/**
 * Assembling the one self-contained document the preview iframe renders.
 *
 * The iframe is `sandbox="allow-scripts"` **without** `allow-same-origin` — the two
 * together defeat the sandbox — so the document runs at an opaque origin. That is not
 * a detail the app can ignore, because a surprising amount of ordinary React code
 * throws there. Measured in a real sandboxed frame on this device:
 *
 *   history.pushState / replaceState  SecurityError
 *   localStorage / sessionStorage     SecurityError on *property access*
 *   document.cookie (read and write)  SecurityError
 *   location.hash = '#/x'             works
 *   indexedDB, matchMedia, fetch      present
 *
 * The first three are exactly what generated apps do: the generate prompt *mandates*
 * `react-router-dom` v6, and persisting state to `localStorage` is routine. Unshimmed,
 * the first click on a nav link throws and the preview becomes the blank white pane
 * this whole layer exists to prevent — and it would look like the model's bug.
 *
 * So the document installs, in order: error reporting, then the shims, then the app.
 * Reporting goes first deliberately, so that a shim that itself fails is visible.
 */

/**
 * Runs before the bundle. Everything here is ES5 on purpose — it must not be the
 * thing that fails to parse.
 *
 * It is a template literal, so no backtick and no `${` may appear inside it, comments
 * included. Getting that wrong makes this module unparseable and the server refuses
 * to boot, which is loud — but it has already happened twice while writing this file.
 */
const HARNESS = `(function () {
    var MARK = 'multi-app-preview';
    var send = function (msg) {
        try { parent.postMessage(Object.assign({ __preview: MARK }, msg), '*'); } catch (e) {}
    };

    /* --- layer 2 of 3: runtime errors. Layer 1 (build errors) never gets here, and
           layer 3 (rendered nothing) is the poll at the bottom. --- */
    window.addEventListener('error', function (e) {
        send({
            type: 'runtime-error',
            message: String((e && e.message) || 'Script error'),
            file: (e && e.filename) || null,
            line: (e && e.lineno) || null,
            column: (e && e.colno) || null,
            stack: e && e.error && e.error.stack ? String(e.error.stack).slice(0, 2000) : null,
        });
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason;
        send({
            type: 'runtime-error',
            rejection: true,
            message: r && r.message ? String(r.message) : String(r),
            stack: r && r.stack ? String(r.stack).slice(0, 2000) : null,
        });
    });

    /* --- the sandbox shims --- */
    var memoryStorage = function () {
        var mem = {};
        return {
            getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, String(k)) ? mem[String(k)] : null; },
            setItem: function (k, v) { mem[String(k)] = String(v); },
            removeItem: function (k) { delete mem[String(k)]; },
            clear: function () { mem = {}; },
            key: function (i) { var ks = Object.keys(mem); return i < ks.length ? ks[i] : null; },
            get length() { return Object.keys(mem).length; },
        };
    };
    /* Reading the property is what throws, so this cannot be a feature test that
       touches it first — define unconditionally and let the own property win. */
    ['localStorage', 'sessionStorage'].forEach(function (name) {
        try { Object.defineProperty(window, name, { configurable: true, value: memoryStorage() }); } catch (e) {}
    });
    try {
        var jar = '';
        Object.defineProperty(document, 'cookie', {
            configurable: true,
            get: function () { return jar; },
            set: function (v) { var pair = String(v).split(';')[0]; if (pair) jar = jar ? jar + '; ' + pair : pair; },
        });
    } catch (e) {}
    /* A no-op rather than a throw. The app's own router is routed around below, so
       what reaches here is code calling the History API directly — and for a preview,
       a link that does nothing beats a link that blanks the page. */
    try {
        history.pushState = function () {};
        history.replaceState = function () {};
    } catch (e) {}
    try {
        if (!window.crypto) window.crypto = {};
        if (typeof crypto.randomUUID !== 'function') {
            crypto.randomUUID = function () {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    var r = (Math.random() * 16) | 0;
                    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
                });
            };
        }
    } catch (e) {}

    /* --- layer 3 of 3: did anything actually render? ---
       React's initial render is scheduled, not synchronous, so a single check on
       the load event reports every app as empty. Poll instead, and report once.

       Know what this does and does not prove. It catches the total blank — nothing
       mounted, the bundle threw before React ran. It does *not* catch an app whose
       layout shell renders while its content area is empty: measured by deleting the
       router shim, which leaves the nav on screen, no route matched, no error thrown,
       and an honest report of "not empty". A non-empty root is evidence of life,
       never evidence of correctness. */
    var visibleChildren = function (el) {
        if (!el) return -1;
        var n = 0;
        for (var i = 0; i < el.children.length; i++) {
            var tag = el.children[i].tagName;
            if (tag !== 'SCRIPT' && tag !== 'STYLE') n++;
        }
        return n;
    };
    var deadline = Date.now() + 2500;
    var poll = function () {
        var root = document.getElementById('root');
        var mounted = root ? visibleChildren(root) : visibleChildren(document.body);
        if (mounted > 0 || Date.now() > deadline) {
            send({ type: 'rendered', empty: mounted <= 0, hasRoot: Boolean(root) });
            return;
        }
        setTimeout(poll, 60);
    };
    if (document.readyState === 'complete') poll();
    else window.addEventListener('load', poll);
})();`;

/** A document body for a project whose `index.html` we could not use. */
const FALLBACK_SHELL = '<!doctype html><html lang="en"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Preview</title>'
    + '</head><body><div id="root"></div></body></html>';

/**
 * `</script>` inside the bundled source would end the tag early. The replacement is
 * still the same string to a JavaScript parser.
 */
const escapeScript = (code) => code.replace(/<\/script/gi, '<\\/script');
/** Same hazard, and `\/` is a valid CSS escape for a solidus inside a string. */
const escapeStyle = (css) => css.replace(/<\/style/gi, '<\\/style');

const stripExternalScripts = (html) =>
    html.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*["'][^>]*>\s*<\/script>/gi, '');
/** Would be fetched from an opaque origin, fail, and tell nobody. The CSS is inlined. */
const stripLinks = (html) =>
    html.replace(/<link\b[^>]*>/gi, '');

const injectBefore = (html, tag, content) => {
    const index = html.toLowerCase().lastIndexOf(tag);
    if (index === -1) return html + content;
    return html.slice(0, index) + content + html.slice(index);
};

/**
 * @param {{html?: string, css?: string, code: string}} parts
 * @returns {string} one document, no external references of any kind
 */
export const buildDocument = ({ html, css, code }) => {
    let shell = typeof html === 'string' && /<body/i.test(html) ? html : FALLBACK_SHELL;
    shell = stripLinks(stripExternalScripts(shell));
    if (!/id\s*=\s*["']root["']/i.test(shell)) {
        shell = injectBefore(shell, '</body>', '<div id="root"></div>');
    }

    const head = `<style>${escapeStyle(css ?? '')}</style>\n<script>${HARNESS}</script>`;
    shell = /<\/head>/i.test(shell) ? injectBefore(shell, '</head>', head) : injectBefore(shell, '</body>', head);

    return injectBefore(shell, '</body>', `<script>${escapeScript(code)}</script>`);
};
