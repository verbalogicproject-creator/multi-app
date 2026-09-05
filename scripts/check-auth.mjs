/**
 * The safety floor, asserted.
 *
 * Every check here corresponds to a way this app was open before Stage 4. They are
 * written so that removing the fix fails a **named** assertion rather than timing out
 * or passing quietly — which matters more here than anywhere else in the repo, because
 * an authentication gate that has stopped working looks exactly like one that is
 * working until someone tries.
 *
 * Two halves, deliberately:
 *
 *  - **In-process**, driving `createAuthRouter` on a throwaway Express app with
 *    `globalThis.fetch` stubbed. That is the only way to prove a *negative* about the
 *    OAuth flow — that a callback with a bad `state` never reaches Google at all — and
 *    it needs no credentials and no network.
 *  - **Out-of-process**, spawning the real `server.js`, because the boot posture, the
 *    CORS allowlist and the `/api` gate are properties of that file's wiring and not of
 *    any module it imports. A gate that only tests the module cannot see a router
 *    mounted in the wrong order.
 */
import { spawn } from 'node:child_process';
import express from 'express';
import { createAuthRouter } from '../auth/index.js';
import { createGithubAuthManager } from '../auth/github.js';
import { authConfigProblems, bootPosture, isLoopback, DEV_JWT_SECRET } from '../auth/config.js';

let failures = 0;
const ok = (name, cond, detail = '') => {
    if (cond) console.log(`  ok    ${name}`);
    else { failures += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** A configuration with nothing wrong with it, so each check can break exactly one thing. */
const GOOD_ENV = {
    GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'a-real-looking-secret',
    JWT_SECRET: 'x'.repeat(48),
    ALLOWED_EMAILS: 'someone@example.com',
};

const cookiesFrom = (res) => {
    const raw = res.headers.getSetCookie?.() ?? [];
    const jar = {};
    for (const line of raw) {
        const [pair] = line.split(';');
        const idx = pair.indexOf('=');
        jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
    }
    return jar;
};

// ---------------------------------------------------------------- 1. configuration
console.log('\n1. a configuration that cannot enforce anything says so');

ok('a complete configuration has no problems', authConfigProblems(GOOD_ENV).length === 0,
    authConfigProblems(GOOD_ENV).join('; '));

for (const [key, why] of [
    ['GOOGLE_CLIENT_ID', 'client id'],
    ['GOOGLE_CLIENT_SECRET', 'client secret'],
    ['JWT_SECRET', 'signing secret'],
    ['ALLOWED_EMAILS', 'allowlist'],
]) {
    const problems = authConfigProblems({ ...GOOD_ENV, [key]: '' });
    ok(`a missing ${why} is named, not shrugged at`, problems.some(p => p.includes(key)),
        `got ${JSON.stringify(problems)}`);
}

/* The one that would have shipped: a signing secret with a working fallback. Anyone
   reading the repo could mint a session for any email. */
ok('the placeholder signing secret is refused by name',
    authConfigProblems({ ...GOOD_ENV, JWT_SECRET: DEV_JWT_SECRET }).some(p => /placeholder|forge/i.test(p)));
ok('and a short one is refused too',
    authConfigProblems({ ...GOOD_ENV, JWT_SECRET: 'too-short' }).some(p => p.includes('JWT_SECRET')));

/* An empty allowlist reads as "no restriction" in most codebases and as "every Google
   account on earth" in this one. */
ok('an empty allowlist is a problem, not a default',
    authConfigProblems({ ...GOOD_ENV, ALLOWED_EMAILS: '  ,  ' }).some(p => p.includes('ALLOWED_EMAILS')));

// ---------------------------------------------------------------- 2. boot posture
console.log('\n2. never reachable and unauthenticated at once');

ok('loopback is recognised', ['127.0.0.1', 'localhost', '::1', '127.0.0.5', ''].every(isLoopback));
ok('and every-interface is not', !isLoopback('0.0.0.0') && !isLoopback('::') && !isLoopback('192.168.1.4'));

const exposedOpen = bootPosture({ host: '0.0.0.0', env: { ...GOOD_ENV, ALLOWED_EMAILS: '' } });
ok('an exposed host with no allowlist refuses to start', exposedOpen.ok === false);
ok('and the refusal names what to fix', /ALLOWED_EMAILS/.test(exposedOpen.reason ?? ''),
    exposedOpen.reason);

ok('an exposed host with real auth starts', bootPosture({ host: '0.0.0.0', env: GOOD_ENV }).ok === true);
ok('and enforces it', bootPosture({ host: '0.0.0.0', env: GOOD_ENV }).enforce === true);
/* The development posture has to stay usable, or it gets worked around. */
ok('loopback with no auth starts', bootPosture({ host: '127.0.0.1', env: {} }).ok === true);
ok('but does not claim to enforce', bootPosture({ host: '127.0.0.1', env: {} }).enforce === false);

// ---------------------------------------------------------------- 3. the state nonce
console.log('\n3. a sign-in nobody started is refused before it costs anything');

/**
 * Stub only what leaves the machine.
 *
 * A blanket stub also swallows this gate's own requests to its own throwaway server,
 * which is how the first run reported "no state cookie" for a route that issues one:
 * the request never reached it. `googleCalls` is then meaningless too — it was
 * recording the test's own URLs. Intercept by destination, pass everything else
 * through.
 */
const realFetch = globalThis.fetch;
let googleCalls = [];
const OUTBOUND = /^https:\/\/(oauth2\.googleapis\.com|www\.googleapis\.com|github\.com|api\.github\.com)\//;
globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (!OUTBOUND.test(href)) return realFetch(url, init);
    googleCalls.push(href);
    return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
};

const authApp = express();
authApp.use(createAuthRouter({ google: GOOD_ENV.GOOGLE_CLIENT_ID ? {
    clientId: GOOD_ENV.GOOGLE_CLIENT_ID,
    clientSecret: GOOD_ENV.GOOGLE_CLIENT_SECRET,
    jwtSecret: GOOD_ENV.JWT_SECRET,
    allowedEmails: ['someone@example.com'],
} : {} }).router);
const authServer = await new Promise((resolve) => {
    const s = authApp.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${authServer.address().port}`;

const begin = await fetch(`${base}/api/auth/google`, { redirect: 'manual' });
const beginJar = cookiesFrom(begin);
const state = beginJar['multi_app_oauth_state'];

ok('starting a sign-in issues a state cookie', Boolean(state), `cookies: ${Object.keys(beginJar)}`);
ok('and the cookie is httpOnly', (begin.headers.getSetCookie?.() ?? []).some(c => /multi_app_oauth_state/.test(c) && /HttpOnly/i.test(c)));
const location = begin.headers.get('location') ?? '';
ok('and the consent URL carries that exact state', location.includes(`state=${state}`),
    location.slice(0, 120));
/* The old route forwarded `req.query.state` to Google unchanged, so an attacker could
   pick the nonce that was then never checked. Both halves were broken; this is the half
   that made the other one exploitable rather than merely useless. */
const chosen = await fetch(`${base}/api/auth/google?state=attacker-chosen`, { redirect: 'manual' });
ok('a caller cannot choose the nonce',
    !(chosen.headers.get('location') ?? '').includes('attacker-chosen'),
    chosen.headers.get('location') ?? '');

googleCalls = [];
const noCookie = await fetch(`${base}/api/auth/google/callback?code=abc&state=${state}`, { redirect: 'manual' });
ok('a callback with no state cookie is refused', noCookie.status === 400, `status ${noCookie.status}`);
ok('and no session cookie is issued', !('multi_app_session' in cookiesFrom(noCookie)));

const mismatched = await fetch(`${base}/api/auth/google/callback?code=abc&state=${state}`, {
    redirect: 'manual',
    headers: { cookie: 'multi_app_oauth_state=a-different-nonce' },
});
ok('a callback whose state does not match its cookie is refused', mismatched.status === 400,
    `status ${mismatched.status}`);
ok('and no session cookie is issued', !('multi_app_session' in cookiesFrom(mismatched)));
/* The assertion that makes this a real gate rather than a status-code check: the code
   is never spent. A refusal that still exchanges the token has not refused anything. */
ok('and the authorization code is never exchanged', googleCalls.length === 0,
    `contacted: ${googleCalls.join(', ')}`);

/* The other direction, so the refusals above are known to mean something: a matching
   nonce does get as far as Google. Without this, deleting the whole callback body would
   pass every assertion so far. */
googleCalls = [];
await fetch(`${base}/api/auth/google/callback?code=abc&state=${state}`, {
    redirect: 'manual',
    headers: { cookie: `multi_app_oauth_state=${state}` },
});
ok('a matching state does reach the token exchange',
    googleCalls.some(u => u.includes('oauth2.googleapis.com/token')),
    `contacted: ${googleCalls.join(', ') || 'nothing'}`);

await new Promise(r => authServer.close(r));
globalThis.fetch = realFetch;

// ---------------------------------------------------------------- 4. the second door
console.log('\n4. the second provider cannot widen the first');

let githubRefused = null;
try {
    createGithubAuthManager({
        clientId: 'gh', clientSecret: 'gh-secret', jwtSecret: GOOD_ENV.JWT_SECRET, allowedUsers: [],
    });
} catch (e) { githubRefused = e.message; }
/* GitHub signs sessions with the same secret under the same cookie name, so an empty
   allowlist there admits every GitHub account to an app whose Google side has a strict
   one. It must refuse to exist rather than warn. */
ok('GitHub refuses to mount without an allowlist', githubRefused !== null);
ok('and says why it matters', /ALLOWED_GITHUB_USERS/.test(githubRefused ?? ''), githubRefused ?? '');

const googleOnly = createAuthRouter({ google: { clientId: 'x', clientSecret: 'y' } });
ok('an unconfigured GitHub is simply not mounted',
    googleOnly.providers.length === 1 && googleOnly.providers[0] === 'google',
    JSON.stringify(googleOnly.providers));

// ---------------------------------------------------------------- 5. the real server
console.log('\n5. the running server gates its own routes');

const PORT = 8077;
const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
        ...process.env,
        ...GOOD_ENV,
        PORT: String(PORT),
        HOST: '127.0.0.1',
        ALLOWED_ORIGINS: 'http://localhost:5173',
        GITHUB_CLIENT_ID: '',
        GITHUB_CLIENT_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', d => { serverLog += d; });
child.stderr.on('data', d => { serverLog += d; });

const up = await (async () => {
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
            if (r.ok) return true;
        } catch { /* not yet */ }
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
})();

try {
    ok('the server starts with a complete configuration', up, serverLog.slice(-400));
    if (up) {
        ok('and says it is enforcing', /auth enforced/.test(serverLog), serverLog.slice(-200));

        /* Liveness must never need a session, or the thing that tells you the server is
           broken becomes the thing that is broken. */
        const health = await fetch(`http://127.0.0.1:${PORT}/healthz`);
        ok('healthz needs no session', health.status === 200, `status ${health.status}`);

        for (const route of ['/api/models', '/api/quota', '/api/memory/health']) {
            const r = await fetch(`http://127.0.0.1:${PORT}${route}`);
            ok(`${route} refuses an unauthenticated request`, r.status === 401, `status ${r.status}`);
        }

        /* The login route itself has to stay reachable, or there is no way in. */
        const login = await fetch(`http://127.0.0.1:${PORT}/api/auth/google`, { redirect: 'manual' });
        ok('the sign-in route is still open', login.status === 302, `status ${login.status}`);

        /* A forged session must not be accepted: the signature is what does the work,
           not the presence of a cookie. */
        const forged = await fetch(`http://127.0.0.1:${PORT}/api/models`, {
            headers: { cookie: 'multi_app_session=not.a.token' },
        });
        ok('a forged session cookie is refused', forged.status === 401, `status ${forged.status}`);

        // --- CORS ---
        const allowed = await fetch(`http://127.0.0.1:${PORT}/healthz`, {
            headers: { Origin: 'http://localhost:5173' },
        });
        ok('an allowlisted origin is answered with its own origin',
            allowed.headers.get('access-control-allow-origin') === 'http://localhost:5173',
            String(allowed.headers.get('access-control-allow-origin')));

        const stranger = await fetch(`http://127.0.0.1:${PORT}/healthz`, {
            headers: { Origin: 'https://evil.example' },
        });
        ok('an origin nobody allowed gets no CORS header',
            stranger.headers.get('access-control-allow-origin') === null,
            String(stranger.headers.get('access-control-allow-origin')));
        /* `cors()` with no arguments answered `*` here, which is what made every route
           callable from any page in a victim's browser. */
        ok('and specifically not a wildcard',
            stranger.headers.get('access-control-allow-origin') !== '*');
    }
} finally {
    child.kill('SIGTERM');
}

console.log(failures === 0 ? '\nauth ok' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
