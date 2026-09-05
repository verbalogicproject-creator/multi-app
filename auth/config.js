/**
 * What has to be true before authentication is worth having.
 *
 * Every check here exists because the module it guards has a default that works. That
 * is the hazard: a signing secret with a fallback value, an allowlist that permits
 * everyone when empty, and a redirect that accepts whatever the caller sent all behave
 * correctly in development and are wide open in production. Nothing fails, nothing
 * warns, and the app looks authenticated.
 *
 * So the rule is that misconfiguration is **loud and fatal**, never a warning. These
 * are pure functions over an environment so the boot path can ask before it listens,
 * and so `check:auth` can assert them without starting a server or contacting Google.
 */

/** The value `auth/google.js` and `auth/github.js` fall back to. Never acceptable. */
export const DEV_JWT_SECRET = 'dev-secret-change-in-prod-32-chars-min';

/** HMAC-SHA256 keys shorter than the digest add no strength. */
const MIN_SECRET_LENGTH = 32;

/**
 * Everything wrong with an environment's auth configuration, named.
 *
 * An empty array means auth can be enforced. It is deliberately not a boolean: the
 * caller has to be able to tell the operator *which* piece is missing, because "auth is
 * misconfigured" is the kind of message that gets worked around rather than fixed.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {string[]}
 */
export const authConfigProblems = (env = process.env) => {
    const problems = [];
    const value = (name) => (env[name] ?? '').trim();

    if (!value('GOOGLE_CLIENT_ID')) problems.push('GOOGLE_CLIENT_ID is not set');
    if (!value('GOOGLE_CLIENT_SECRET')) problems.push('GOOGLE_CLIENT_SECRET is not set');

    const secret = value('JWT_SECRET');
    if (!secret) {
        problems.push('JWT_SECRET is not set — sessions would be signed with a key published in this repo');
    } else if (secret === DEV_JWT_SECRET) {
        problems.push('JWT_SECRET is still the placeholder — anyone reading this repo can forge a session');
    } else if (secret.length < MIN_SECRET_LENGTH) {
        problems.push(`JWT_SECRET is ${secret.length} characters; HMAC-SHA256 wants at least ${MIN_SECRET_LENGTH}`);
    }

    /* An empty allowlist is not "no restriction" here, it is "every Google account on
       earth". A personal app with a login screen and no allowlist is a door with a
       handle painted on it. */
    const allowed = value('ALLOWED_EMAILS').split(',').map(e => e.trim()).filter(Boolean);
    if (!allowed.length) {
        problems.push('ALLOWED_EMAILS is empty — every Google account would be admitted');
    }

    return problems;
};

/**
 * Whether a bind address is reachable only from this machine.
 *
 * `::` and `0.0.0.0` are the two that matter — they mean *every* interface, which on a
 * phone on a shared network means every device on that network. An unset host is
 * loopback here because that is what this server now defaults to.
 */
export const isLoopback = (host) => {
    const h = String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!h) return true;
    return h === 'localhost' || h === '::1' || h === '127.0.0.1' || h.startsWith('127.');
};

/**
 * The one invariant the boot path must not be able to violate:
 * **never reachable from the network and unauthenticated at the same time.**
 *
 * Either of those alone is a normal state. A loopback server with no login is how this
 * is developed; a network-reachable server behind Google is how it is shared. The
 * combination is four live API keys and a filesystem-writing model, offered to whoever
 * is on the Wi-Fi.
 *
 * @returns {{ ok: boolean, enforce: boolean, reason?: string }}
 */
export const bootPosture = ({ host, env = process.env } = {}) => {
    const problems = authConfigProblems(env);
    const enforce = problems.length === 0;
    if (enforce || isLoopback(host)) return { ok: true, enforce };
    return {
        ok: false,
        enforce,
        reason: [
            `Refusing to listen on ${host} without authentication.`,
            'This process holds live provider keys and can write files, so it may be',
            'reachable from the network or unauthenticated, but not both.',
            '',
            'Fix the configuration:',
            ...problems.map(p => `  - ${p}`),
            '',
            'Or bind to this machine only: HOST=127.0.0.1',
        ].join('\n'),
    };
};
