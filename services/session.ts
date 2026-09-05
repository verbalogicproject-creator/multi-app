/**
 * One place that notices you are signed out.
 *
 * The backend refuses every `/api` route with `401` when authentication is enforced.
 * There are sixteen `fetch` call sites across four services and no wrapper around them,
 * so handling that per-caller would mean sixteen edits and a seventeenth the next time
 * someone adds a route — and the failure mode of missing one is an app that renders an
 * empty panel and says nothing.
 *
 * So `window.fetch` is wrapped exactly once, here, at boot. Every existing caller and
 * every future one is covered without knowing about it, and the rule lives in a single
 * readable place rather than being distributed across the codebase as a convention.
 *
 * **What it deliberately does not do:** retry, refresh, or queue. A 401 from this server
 * means "no valid session", not "expired token that could be renewed" — there is no
 * refresh flow — so the only correct response is to send the browser to the sign-in
 * route the server itself named.
 */

/** Requests we must never redirect on, or signing in becomes a loop. */
const isAuthRoute = (url: string) => url.includes('/api/auth/');

/** Set once we have started navigating, so a burst of parallel 401s sends one redirect. */
let redirecting = false;

export const installSessionHandling = () => {
    if (typeof window === 'undefined' || !window.fetch) return;

    const original = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await original(input, init);
        if (response.status !== 401) return response;

        const url = typeof input === 'string' ? input
            : input instanceof URL ? input.href
            : input.url;
        if (isAuthRoute(url) || redirecting) return response;

        /* The server names where to go. Reading it rather than hardcoding `/api/auth/google`
           means adding a provider does not require changing this file — and the clone is
           taken because the caller still owns the body it was handed. */
        let loginUrl = '/api/auth/google';
        try {
            const body = await response.clone().json();
            if (typeof body?.loginUrl === 'string') loginUrl = body.loginUrl;
        } catch { /* a 401 with no JSON body is still a 401 */ }

        redirecting = true;
        window.location.href = loginUrl;
        return response;
    };
};
