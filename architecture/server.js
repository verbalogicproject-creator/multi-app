#!/usr/bin/env node
// The interactive architecture doc's own tiny server. Deliberately dependency-free
// (plain node:http, no Express) — this is a standalone tool, not part of the app it
// documents, and doesn't need the main app's dependency tree.
//
// Run:     node architecture/server.js            (serves on :4600, ARCH_PORT overrides)
// Verify:  node architecture/server.js --verify    (re-runs every generator's own
//          --verify and reports ok/FAIL per file — this repo's own convention,
//          see scripts/*.mjs — then exits; does not start the server)

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const FONTS_DIR = path.join(__dirname, '..', 'public', 'fonts');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mmd': 'text/plain; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff2': 'font/woff2',
};

function runVerify() {
    const generators = ['models.mjs', 'routes.mjs', 'modules.mjs'];
    let failed = 0;
    for (const gen of generators) {
        const result = spawnSync('node', [path.join(ROOT, 'generate', gen), '--verify'], { encoding: 'utf8' });
        const line = (result.stdout + result.stderr).trim().split('\n').filter(Boolean).pop() ?? '(no output)';
        console.log(line);
        if (result.status !== 0) failed += 1;
    }
    if (failed > 0) {
        console.error(`FAIL ${failed}/${generators.length} generated file(s) are stale — the doc has drifted from source.`);
        process.exit(1);
    }
    console.log(`ok all ${generators.length} generated files match their source`);
    process.exit(0);
}

if (process.argv.includes('--verify')) {
    runVerify();
}

// A request is served from architecture/ itself, or from ../public/fonts/ under
// /fonts/ (the same font files index.css already self-hosts — no CDN, per this
// repo's own "this device is often offline" rule).
function resolveFile(urlPath) {
    if (urlPath === '/' || urlPath === '') return path.join(ROOT, 'index.html');
    if (urlPath.startsWith('/fonts/')) return path.join(FONTS_DIR, urlPath.slice('/fonts/'.length));
    return path.join(ROOT, urlPath.replace(/^\//, ''));
}

const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filePath = resolveFile(urlPath);

    // Refuse to serve outside ROOT/FONTS_DIR — ProjectFile.path-style escape guard,
    // same reasoning as typecheck/routes.js's own path check.
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(ROOT) && !resolved.startsWith(FONTS_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
    }

    const ext = path.extname(resolved);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    createReadStream(resolved).pipe(res);
});

const port = Number(process.env.ARCH_PORT) || 4600;
server.listen(port, () => {
    console.log(`Architecture doc serving on http://localhost:${port}`);
    console.log(`Run 'node architecture/server.js --verify' any time to check the doc hasn't drifted from source.`);
});
