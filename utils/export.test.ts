/**
 * The export path had no test, and a change to it would have shipped green.
 *
 * `createProjectZip` builds the .zip a finished build is downloaded as — the last step
 * of the wizard, and the only thing standing between a generated project and the user
 * actually having it. No CDP gate clicks that button (a headless download is awkward to
 * assert) and no unit test covered it, so the whole path rested on nobody having touched
 * it. Then it was touched: jszip became a dynamic `import()` to keep ~95K out of the
 * eagerly-loaded bundle.
 *
 * A dynamic import fails at *runtime*, not at build time. The build emitting a
 * `jszip.min-*.js` chunk proves the specifier resolves; it does not prove the module
 * loads and the zip still contains the files. That gap is exactly the shape of thing
 * that passes CI and fails a user, so it is closed here.
 *
 * The browser surface is stubbed rather than mocked away: the anchor, its `download`
 * attribute and the object URL are the observable result of this function, so they are
 * asserted, not discarded.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createProjectZip } from './export';

const FILES = {
    'src/App.tsx': 'export default () => <div>hi</div>;',
    'package.json': '{"name":"demo"}',
};

const stubBrowser = () => {
    const anchor: Record<string, unknown> = { click: vi.fn() };
    const blobs: Blob[] = [];
    const originals = { document: globalThis.document, URL: globalThis.URL };
    (globalThis as any).document = {
        createElement: () => anchor,
        body: { appendChild: vi.fn(), removeChild: vi.fn() },
    };
    (globalThis as any).URL = Object.assign(Object.create(URL), {
        createObjectURL: (b: Blob) => { blobs.push(b); return 'blob:stub'; },
        revokeObjectURL: vi.fn(),
    });
    return { anchor, blobs, restore: () => Object.assign(globalThis, originals) };
};

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

describe('createProjectZip', () => {
    it('loads jszip at call time and produces a non-empty archive', async () => {
        const s = stubBrowser(); restore = s.restore;
        await createProjectZip(FILES, 'Demo Project');
        expect(s.blobs).toHaveLength(1);
        expect(s.blobs[0].size).toBeGreaterThan(0);
    });

    it('the archive actually contains the files it was given', async () => {
        const s = stubBrowser(); restore = s.restore;
        await createProjectZip(FILES, 'Demo Project');
        const { default: JSZip } = await import('jszip');
        const read = await new JSZip().loadAsync(await s.blobs[0].arrayBuffer());
        // jszip lists directory entries too (`src/`); assert the files, not the scaffolding.
        const names = Object.keys(read.files).filter(k => !read.files[k].dir).sort();
        expect(names).toEqual(['package.json', 'src/App.tsx']);
        expect(await read.file('src/App.tsx')!.async('string')).toBe(FILES['src/App.tsx']);
    });

    it('names the download after the project, lowercased with spaces collapsed', async () => {
        const s = stubBrowser(); restore = s.restore;
        await createProjectZip(FILES, 'Demo Project');
        expect(s.anchor.download).toBe('demo_project.zip');
        expect(s.anchor.href).toBe('blob:stub');
        expect(s.anchor.click).toHaveBeenCalledOnce();
    });
});
