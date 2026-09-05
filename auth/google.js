/**
 * Express Google OAuth 2.0 Closure Factory
 * Provides standalone Google OAuth 2.0 login, callback, session verification,
 * and route protection middleware using pure HTTP/standard crypto (zero heavy deps).
 */
import crypto from 'crypto';

export function createGoogleAuthManager({
    clientId = process.env.GOOGLE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET,
    redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8050/api/auth/google/callback',
    jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-in-prod-32-chars-min',
    allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
    cookieName = 'multi_app_session',
    /* The CSRF nonce, kept apart from the session so that clearing one never clears
       the other and so it can carry a much shorter life. */
    stateCookieName = 'multi_app_oauth_state',
    stateMaxAgeMs = 10 * 60 * 1000,
} = {}) {
    if (!clientId || !clientSecret) {
        console.warn('[GoogleAuth] Warning: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing.');
    }

    // --- JWT Helper Primitives (HMAC-SHA256) ---
    function base64UrlEncode(str) {
        return Buffer.from(str)
            .toString('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
    }

    function base64UrlDecode(str) {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) str += '=';
        return Buffer.from(str, 'base64').toString('utf8');
    }

    function signToken(payload, expiresInSeconds = 7 * 86400) {
        const header = { alg: 'HS256', typ: 'JWT' };
        const now = Math.floor(Date.now() / 1000);
        const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
        const encHeader = base64UrlEncode(JSON.stringify(header));
        const encPayload = base64UrlEncode(JSON.stringify(fullPayload));
        const signature = crypto
            .createHmac('sha256', jwtSecret)
            .update(`${encHeader}.${encPayload}`)
            .digest('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
        return `${encHeader}.${encPayload}.${signature}`;
    }

    /**
     * Constant-time string comparison.
     *
     * `!==` on an HMAC leaks how many leading bytes were right through how long the
     * comparison took. Over a network that is a hard signal to exploit and a free one
     * to remove, and the same helper is what makes the OAuth `state` check honest.
     */
    function sameSecret(a, b) {
        if (typeof a !== 'string' || typeof b !== 'string') return false;
        const left = Buffer.from(a);
        const right = Buffer.from(b);
        /* timingSafeEqual throws on a length mismatch, which would leak length by
           exception. Compare digests of equal size instead, so every comparison costs
           the same regardless of the inputs. */
        return crypto.timingSafeEqual(
            crypto.createHash('sha256').update(left).digest(),
            crypto.createHash('sha256').update(right).digest(),
        );
    }

    function verifyToken(token) {
        if (!token || typeof token !== 'string') return null;
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const [encHeader, encPayload, signature] = parts;
        const expectedSig = crypto
            .createHmac('sha256', jwtSecret)
            .update(`${encHeader}.${encPayload}`)
            .digest('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
        if (!sameSecret(signature, expectedSig)) return null;
        try {
            const payload = JSON.parse(base64UrlDecode(encPayload));
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp && payload.exp < now) return null;
            return payload;
        } catch {
            return null;
        }
    }

    function parseCookies(req) {
        const list = {};
        const rc = req.headers.cookie;
        if (!rc) return list;
        rc.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            /* `decodeURIComponent`, not `decodeURI`: `decodeURI` leaves `%3D` and
               friends alone, which happens to be harmless for a base64url JWT and
               silently wrong for anything else stored beside it. */
            const name = parts.shift().trim();
            try { list[name] = decodeURIComponent(parts.join('=')); }
            catch { list[name] = parts.join('='); }
        });
        return list;
    }

    // --- Core Methods ---
    /**
     * The consent URL, for a state this server generated.
     *
     * `state` is required rather than defaulted. It used to be optional, and the route
     * passed `req.query.state` straight into it — so a caller could choose the nonce
     * that was later never checked anyway. A nonce the attacker picks is not a nonce.
     */
    function getAuthUrl(state) {
        if (!state) throw new Error('getAuthUrl requires a state generated by newState()');
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid email profile',
            access_type: 'offline',
            prompt: 'select_account',
            state,
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    const newState = () => crypto.randomBytes(32).toString('hex');

    /**
     * Whether a callback's `state` is the one this browser was sent away with.
     *
     * Without this the callback accepts any `code` from anyone — the login-CSRF shape,
     * where an attacker completes their own consent, hands you the resulting redirect,
     * and your browser silently becomes *their* session. Everything you then build is
     * in their account. It is the quiet one, because nothing looks broken.
     */
    function stateMatches(query, cookies) {
        const sent = cookies[stateCookieName];
        const returned = query;
        if (!sent || !returned) return false;
        return sameSecret(String(sent), String(returned));
    }

    async function handleCallback(code) {
        // 1. Exchange code for tokens
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            })
        });

        if (!tokenResp.ok) {
            const errBody = await tokenResp.text();
            throw new Error(`Google token exchange failed: ${tokenResp.status} ${errBody}`);
        }

        const tokenData = await tokenResp.json();
        const { access_token, id_token, refresh_token } = tokenData;

        // 2. Fetch user profile
        const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` }
        });
        if (!userResp.ok) {
            throw new Error('Failed to fetch Google user profile');
        }
        const profile = await userResp.json();

        // 3. Check access control / allowed emails
        const email = (profile.email || '').trim().toLowerCase();
        if (allowedEmails.length > 0 && !allowedEmails.includes(email)) {
            const err = new Error(`Email ${email} is not authorized for access.`);
            err.code = 'FORBIDDEN';
            throw err;
        }

        // 4. Create App User Object
        const user = {
            id: profile.id,
            email: profile.email,
            name: profile.name,
            picture: profile.picture,
            provider: 'google'
        };

        const sessionToken = signToken({ user });
        return { user, sessionToken, refreshToken: refresh_token };
    }

    // --- Express Middleware ---
    function authenticate(req, res, next) {
        const cookies = parseCookies(req);
        const authHeader = req.headers.authorization;
        let token = cookies[cookieName];

        if (!token && authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }

        req.user = verifyToken(token)?.user || null;
        next();
    }

    function requireAuth(req, res, next) {
        authenticate(req, res, () => {
            if (!req.user) {
                return res.status(401).json({ error: 'Authentication required', loginUrl: '/api/auth/google' });
            }
            next();
        });
    }

    // --- Mountable Express Router Builder ---
    function attachRoutes(router, { successRedirect = '/' } = {}) {
        /* The nonce is minted here and nowhere else. `req.query.state` is ignored on
           purpose: it was previously forwarded to Google unchanged, which let the
           caller choose the value that the callback then never checked. */
        router.get('/api/auth/google', (req, res) => {
            const state = newState();
            res.cookie(stateCookieName, state, {
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.NODE_ENV === 'production',
                path: '/',
                maxAge: stateMaxAgeMs,
            });
            res.redirect(getAuthUrl(state));
        });

        router.get('/api/auth/google/callback', async (req, res) => {
            const { code, error, state } = req.query;
            const cookies = parseCookies(req);
            /* Cleared before anything else can go wrong, so a nonce is single-use even
               when the exchange below fails or throws. */
            res.clearCookie(stateCookieName, { path: '/' });

            if (error) {
                return res.status(400).send(`Authentication error: ${error}`);
            }
            /* Checked before the code is spent. An unsolicited callback must cost
               nothing — not a token exchange, not a round trip to Google. */
            if (!stateMatches(state, cookies)) {
                return res.status(400).send('Authentication error: this sign-in was not started here');
            }
            if (!code) {
                return res.status(400).send('Missing authorization code');
            }

            try {
                const { user, sessionToken } = await handleCallback(code);
                res.cookie(cookieName, sessionToken, {
                    httpOnly: true,
                    sameSite: 'lax',
                    secure: process.env.NODE_ENV === 'production',
                    path: '/',
                    maxAge: 7 * 86400 * 1000
                });
                res.redirect(successRedirect);
            } catch (err) {
                console.error('[GoogleAuth] Callback error:', err.message);
                if (err.code === 'FORBIDDEN') {
                    return res.status(403).send(`<h3>Access Denied</h3><p>${err.message}</p>`);
                }
                res.status(500).send(`<h3>Authentication Failed</h3><p>${err.message}</p>`);
            }
        });

        router.get('/api/auth/session', authenticate, (req, res) => {
            if (!req.user) {
                return res.json({ authenticated: false, user: null });
            }
            res.json({ authenticated: true, user: req.user });
        });

        router.post('/api/auth/logout', (req, res) => {
            res.clearCookie(cookieName, { path: '/' });
            res.json({ success: true, message: 'Logged out successfully' });
        });

        return router;
    }

    return {
        getAuthUrl,
        handleCallback,
        signToken,
        verifyToken,
        authenticate,
        requireAuth,
        attachRoutes
    };
}
