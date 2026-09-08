/**
 * The safety floor, asserted — in-process half.
 *
 * Every check here corresponds to a way this app was open before Stage 4. They are
 * written so that removing the fix fails a **named** assertion rather than timing out
 * or passing quietly — which matters more here than anywhere else in the repo, because
 * an authentication gate that has stopped working looks exactly like one that is
 * working until someone tries.
 *
 * In-process only: driving `createAuthRouter` on a throwaway Express app with
 * `globalThis.fetch` stubbed. That is the only way to prove a *negative* about the OAuth
 * flow — that a callback with a bad `state` never reaches Google at all — and it needs
 * no credentials and no network. The out-of-process half (the real `server.js`, its boot
 * posture, its CORS allowlist, its `/api` gate — properties of that file's wiring, not of
 * any module it imports) stays a separate script: `npm run check:auth`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createAuthRouter } from './index.js';
import { createGithubAuthManager } from './github.js';
import { authConfigProblems, bootPosture, isLoopback, DEV_JWT_SECRET } from './config.js';

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

describe('a configuration that cannot enforce anything says so', () => {
    it('a complete configuration has no problems', () => {
        expect(authConfigProblems(GOOD_ENV), authConfigProblems(GOOD_ENV).join('; ')).toEqual([]);
    });

    it.each([
        ['GOOGLE_CLIENT_ID', 'client id'],
        ['GOOGLE_CLIENT_SECRET', 'client secret'],
        ['JWT_SECRET', 'signing secret'],
        ['ALLOWED_EMAILS', 'allowlist'],
    ])('a missing %s (%s) is named, not shrugged at', (key) => {
        const problems = authConfigProblems({ ...GOOD_ENV, [key]: '' });
        expect(problems.some(p => p.includes(key)), `got ${JSON.stringify(problems)}`).toBe(true);
    });

    /* The one that would have shipped: a signing secret with a working fallback. Anyone
       reading the repo could mint a session for any email. */
    it('the placeholder signing secret is refused by name', () => {
        expect(authConfigProblems({ ...GOOD_ENV, JWT_SECRET: DEV_JWT_SECRET }).some(p => /placeholder|forge/i.test(p))).toBe(true);
    });
    it('and a short one is refused too', () => {
        expect(authConfigProblems({ ...GOOD_ENV, JWT_SECRET: 'too-short' }).some(p => p.includes('JWT_SECRET'))).toBe(true);
    });

    /* An empty allowlist reads as "no restriction" in most codebases and as "every Google
       account on earth" in this one. */
    it('an empty allowlist is a problem, not a default', () => {
        expect(authConfigProblems({ ...GOOD_ENV, ALLOWED_EMAILS: '  ,  ' }).some(p => p.includes('ALLOWED_EMAILS'))).toBe(true);
    });
});

describe('never reachable and unauthenticated at once', () => {
    it('loopback is recognised', () => {
        expect(['127.0.0.1', 'localhost', '::1', '127.0.0.5', ''].every(isLoopback)).toBe(true);
    });
    it('and every-interface is not', () => {
        expect(!isLoopback('0.0.0.0') && !isLoopback('::') && !isLoopback('192.168.1.4')).toBe(true);
    });

    it('an exposed host with no allowlist refuses to start', () => {
        const exposedOpen = bootPosture({ host: '0.0.0.0', env: { ...GOOD_ENV, ALLOWED_EMAILS: '' } });
        expect(exposedOpen.ok).toBe(false);
    });
    it('and the refusal names what to fix', () => {
        const exposedOpen = bootPosture({ host: '0.0.0.0', env: { ...GOOD_ENV, ALLOWED_EMAILS: '' } });
        expect(/ALLOWED_EMAILS/.test(exposedOpen.reason ?? ''), exposedOpen.reason).toBe(true);
    });

    it('an exposed host with real auth starts', () => {
        expect(bootPosture({ host: '0.0.0.0', env: GOOD_ENV }).ok).toBe(true);
    });
    it('and enforces it', () => {
        expect(bootPosture({ host: '0.0.0.0', env: GOOD_ENV }).enforce).toBe(true);
    });
    /* The development posture has to stay usable, or it gets worked around. */
    it('loopback with no auth starts', () => {
        expect(bootPosture({ host: '127.0.0.1', env: {} }).ok).toBe(true);
    });
    it('but does not claim to enforce', () => {
        expect(bootPosture({ host: '127.0.0.1', env: {} }).enforce).toBe(false);
    });
});

/**
 * Stub only what leaves the machine.
 *
 * A blanket stub also swallows this gate's own requests to its own throwaway server,
 * which is how the first run reported "no state cookie" for a route that issues one: the
 * request never reached it. `googleCalls` is then meaningless too — it was recording the
 * test's own URLs. Intercept by destination, pass everything else through.
 */
describe('a sign-in nobody started is refused before it costs anything', () => {
    const realFetch = globalThis.fetch;
    const OUTBOUND = /^https:\/\/(oauth2\.googleapis\.com|www\.googleapis\.com|github\.com|api\.github\.com)\//;
    let googleCalls = [];
    let authServer;
    let base;
    let state;

    beforeAll(async () => {
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
        authServer = await new Promise((resolve) => {
            const s = authApp.listen(0, '127.0.0.1', () => resolve(s));
        });
        base = `http://127.0.0.1:${authServer.address().port}`;
    });

    afterAll(async () => {
        await new Promise(r => authServer.close(r));
        globalThis.fetch = realFetch;
    });

    it('starting a sign-in issues a state cookie', async () => {
        const begin = await fetch(`${base}/api/auth/google`, { redirect: 'manual' });
        const beginJar = cookiesFrom(begin);
        state = beginJar['multi_app_oauth_state'];
        expect(Boolean(state), `cookies: ${Object.keys(beginJar)}`).toBe(true);
        expect((begin.headers.getSetCookie?.() ?? []).some(c => /multi_app_oauth_state/.test(c) && /HttpOnly/i.test(c))).toBe(true);
        const location = begin.headers.get('location') ?? '';
        expect(location.includes(`state=${state}`), location.slice(0, 120)).toBe(true);
    });

    /* The old route forwarded `req.query.state` to Google unchanged, so an attacker could
       pick the nonce that was then never checked. Both halves were broken; this is the
       half that made the other one exploitable rather than merely useless. */
    it('a caller cannot choose the nonce', async () => {
        const chosen = await fetch(`${base}/api/auth/google?state=attacker-chosen`, { redirect: 'manual' });
        expect(!(chosen.headers.get('location') ?? '').includes('attacker-chosen'), chosen.headers.get('location') ?? '').toBe(true);
    });

    it('a callback with no state cookie is refused', async () => {
        googleCalls = [];
        const noCookie = await fetch(`${base}/api/auth/google/callback?code=abc&state=${state}`, { redirect: 'manual' });
        expect(noCookie.status, `status ${noCookie.status}`).toBe(400);
        expect('multi_app_session' in cookiesFrom(noCookie)).toBe(false);
    });

    it('a callback whose state does not match its cookie is refused', async () => {
        const mismatched = await fetch(`${base}/api/auth/google/callback?code=abc&state=${state}`, {
            redirect: 'manual',
            headers: { cookie: 'multi_app_oauth_state=a-different-nonce' },
        });
        expect(mismatched.status, `status ${mismatched.status}`).toBe(400);
        expect('multi_app_session' in cookiesFrom(mismatched)).toBe(false);
        /* The assertion that makes this a real gate rather than a status-code check: the
           code is never spent. A refusal that still exchanges the token has not refused
           anything. */
        expect(googleCalls.length, `contacted: ${googleCalls.join(', ')}`).toBe(0);
    });

    /* The other direction, so the refusals above are known to mean something: a matching
       nonce does get as far as Google. Without this, deleting the whole callback body
       would pass every assertion so far. */
    it('a matching state does reach the token exchange', async () => {
        googleCalls = [];
        await fetch(`${base}/api/auth/google/callback?code=abc&state=${state}`, {
            redirect: 'manual',
            headers: { cookie: `multi_app_oauth_state=${state}` },
        });
        expect(googleCalls.some(u => u.includes('oauth2.googleapis.com/token')), `contacted: ${googleCalls.join(', ') || 'nothing'}`).toBe(true);
    });
});

describe('the second provider cannot widen the first', () => {
    /* GitHub signs sessions with the same secret under the same cookie name, so an empty
       allowlist there admits every GitHub account to an app whose Google side has a
       strict one. It must refuse to exist rather than warn. */
    it('GitHub refuses to mount without an allowlist, and says why it matters', () => {
        let githubRefused = null;
        try {
            createGithubAuthManager({
                clientId: 'gh', clientSecret: 'gh-secret', jwtSecret: GOOD_ENV.JWT_SECRET, allowedUsers: [],
            });
        } catch (e) { githubRefused = e.message; }
        expect(githubRefused).not.toBeNull();
        expect(/ALLOWED_GITHUB_USERS/.test(githubRefused ?? ''), githubRefused ?? '').toBe(true);
    });

    it('an unconfigured GitHub is simply not mounted', () => {
        const googleOnly = createAuthRouter({ google: { clientId: 'x', clientSecret: 'y' } });
        expect(googleOnly.providers, JSON.stringify(googleOnly.providers)).toEqual(['google']);
    });
});
