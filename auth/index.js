import express from 'express';
import { createGoogleAuthManager } from './google.js';
import { createGithubAuthManager } from './github.js';

/**
 * The auth router, and the rule about how many doors it opens.
 *
 * Google is the provider this app asked for and the one it enforces against. GitHub is
 * kept because it works, but it is **mounted only when it is explicitly configured** —
 * previously it was mounted unconditionally, and because it signs its sessions with the
 * same secret under the same cookie name, that made it a second entrance to the same
 * lock whose own allowlist defaulted to admitting everyone. Sign in with any GitHub
 * account, receive a session the Google-side `requireAuth` honours, and `ALLOWED_EMAILS`
 * never gets a say. A provider nobody asked for that quietly widens the one they did
 * ask for is not a feature.
 *
 * `createGithubAuthManager` now throws rather than warns when it is half-configured, so
 * a typo in `ALLOWED_GITHUB_USERS` fails at boot instead of at the door.
 */
export function createAuthRouter(config = {}) {
    const router = express.Router();
    const successRedirect = config.successRedirect || process.env.FRONTEND_URL || '/';

    const googleAuth = createGoogleAuthManager(config.google);
    googleAuth.attachRoutes(router, { successRedirect });

    /* Opt-in, and all-or-nothing. `createGithubAuthManager` refuses to construct
       without an allowlist, so reaching that call at all means it is safe to mount. */
    const githubConfigured = Boolean(
        (config.github?.clientId ?? process.env.GITHUB_CLIENT_ID)
        && (config.github?.clientSecret ?? process.env.GITHUB_CLIENT_SECRET),
    );
    if (githubConfigured) {
        createGithubAuthManager(config.github).attachRoutes(router, { successRedirect });
    }

    return {
        router,
        requireAuth: googleAuth.requireAuth,
        authenticate: googleAuth.authenticate,
        verifyToken: googleAuth.verifyToken,
        providers: githubConfigured ? ['google', 'github'] : ['google'],
    };
}

export { authConfigProblems, bootPosture, isLoopback, DEV_JWT_SECRET } from './config.js';
