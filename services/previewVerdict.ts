import { buildPreview } from './buildPreview';
import { PREVIEW_MARK } from '../types/preview';
import type { PreviewMessage } from '../types/preview';
import type { BuildIssue } from '../utils/validateBuild';
import { PREVIEW_PACKAGES } from '../providers/allowlist.js';

/**
 * Does the generated app actually run?
 *
 * Every other judge reads the code. `validateBuild` counts braces, `tsc` knows what
 * the code means, esbuild knows whether it resolves — and all three can pass over an
 * app that mounts a blank page. Until this existed, "it built" was the strongest thing
 * the builder could say, and the preview's opinion reached a human looking at a pane
 * and nothing else.
 *
 * So the app runs the app. It is already a browser; a detached, off-screen iframe with
 * the same sandbox the visible preview uses gives a real verdict for the price of one
 * bundle, and the document's own harness already reports both things worth knowing —
 * whether it threw, and whether it drew anything.
 *
 * **Attribution is the point, not detection**, and the rule for it was inverted once,
 * expensively. It used to be *"a package the project **declared** is the environment's
 * problem"* — reasoning that a declared dependency simply awaits an `npm install`. But
 * there is no later `npm install`: this preview is the only place a generated app ever
 * runs. So a build importing `lucide-react` declared it, was forgiven by this function,
 * was forgiven by `tsc` for the same reason, was never examined by `validateBuild` at
 * all, and shipped as "Passed all N file checks" above a preview showing the failure.
 *
 * The rule now gates on **availability**: a package is the environment's problem only if
 * the preview is *supposed* to have it — meaning it is on `providers/allowlist.js`, which
 * the generate prompt names — and something has gone wrong locally. A package outside
 * that list is the model's problem, because it was told the list.
 */

/** The harness reports within ~2.5s; this is the outer bound before we give up. */
const RUN_TIMEOUT_MS = 15_000;



const packageIn = (text: string): string | null => {
    const match = /Could not resolve "([^"]+)"/.exec(text);
    if (!match) return null;
    const spec = match[1];
    if (spec.startsWith('.')) return null;
    const parts = spec.split('/');
    return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/**
 * Whose fault is a bundle failure?
 *
 * Exported and pure because this is the judgement the lesson ladder acts on, and a
 * rule that decides what a model gets taught must be checkable without a browser, a
 * network or a model. Attribution is the whole job: a package the project *declared*
 * is missing from **our** node_modules, not from the project — dropping it is what
 * stops the ladder teaching the model to abandon dependencies it correctly declared.
 */
export const attributeBundleErrors = (
    errors: { text: string; file: string | null }[],
    _files: Record<string, string> = {},
): BuildIssue[] => {
    const issues: BuildIssue[] = [];
    for (const error of errors) {
        const pkg = packageIn(error.text);
        /* On the list means the preview should have had it, so a failure here is ours.
           Off the list means the model reached outside what it was given. */
        if (pkg && PREVIEW_PACKAGES.has(pkg)) continue;
        issues.push({
            severity: 'error',
            code: pkg ? 'unresolved-import' : 'bundle-error',
            file: error.file ?? undefined,
            message: error.text,
        });
    }
    return issues;
};

/**
 * Load one document in a sandboxed frame and report what it did.
 *
 * Off-screen rather than `display:none`: a frame that is never laid out may not run
 * layout-dependent code the same way, and the question being asked is precisely
 * whether the thing renders.
 */
const runDocument = (html: string): Promise<{ threw: PreviewMessage | null; empty: boolean; reported: boolean }> =>
    new Promise((resolve) => {
        const frame = document.createElement('iframe');
        /* Scripts, and nothing else — never together with `allow-same-origin`, which
           would hand model-authored code this origin's storage and DOM. */
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('title', 'build verification');
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:390px;height:800px;border:0';

        let threw: PreviewMessage | null = null;
        let settled = false;

        const finish = (empty: boolean, reported: boolean) => {
            if (settled) return;
            settled = true;
            window.removeEventListener('message', onMessage);
            clearTimeout(timer);
            frame.remove();
            resolve({ threw, empty, reported });
        };

        const onMessage = (event: MessageEvent) => {
            if (event.source !== frame.contentWindow) return;
            const data = event.data as PreviewMessage | undefined;
            if (!data || data.__preview !== PREVIEW_MARK) return;
            if (data.type === 'runtime-error' && !threw) threw = data;
            if (data.type === 'rendered') finish(data.empty, true);
        };

        /* A frame that never reports is not evidence of anything — it is the
           instrument failing to answer, and it says so rather than guessing "empty". */
        const timer = setTimeout(() => finish(false, false), RUN_TIMEOUT_MS);

        window.addEventListener('message', onMessage);
        frame.srcdoc = html;
        document.body.appendChild(frame);
    });

/**
 * Bundle the project and run it, as `BuildIssue[]` the existing verdict can absorb.
 *
 * Returns `null` when the bundler could not be reached at all — the same "no opinion"
 * contract `runTypecheck` uses. A judge that did not run must never be able to certify
 * or condemn a build.
 */
export const previewVerdict = async (
    projectId: string,
    files: Record<string, string>,
): Promise<BuildIssue[] | null> => {
    const built = await buildPreview(projectId, files);
    if (!built) return null;

    if (!built.ok) return attributeBundleErrors(built.errors, files);

    const { threw, empty, reported } = await runDocument(built.html);
    if (!reported) return [];   // the frame never answered; no opinion, not a verdict

    const issues: BuildIssue[] = [];
    if (threw && threw.type === 'runtime-error') {
        issues.push({
            severity: 'error',
            code: 'runtime-error',
            file: threw.file ?? undefined,
            message: threw.message,
        });
    }
    /* An app that threw is already explained; reporting the empty root as well would
       propose two lessons for one fault. */
    if (empty && !threw) {
        issues.push({
            severity: 'error',
            code: 'renders-nothing',
            message: 'The app built and ran without error, but mounted nothing into #root.',
        });
    }
    return issues;
};
