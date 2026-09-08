/**
 * The safety floor, asserted — out-of-process half.
 *
 * Spawns the real `server.js`, because the boot posture, the CORS allowlist and the
 * `/api` gate are properties of that file's wiring and not of any module it imports. A
 * gate that only tests the module cannot see a router mounted in the wrong order. The
 * in-process half (`createAuthRouter` driven directly, `globalThis.fetch` stubbed —
 * `state`-nonce validation, cookie flags, the second-provider allowlist) is
 * `auth/index.test.js`, run by `npm test` (Vitest) alongside every other pure check.
 */
import { spawn } from 'node:child_process';

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

console.log('\n1. the running server gates its own routes');

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
