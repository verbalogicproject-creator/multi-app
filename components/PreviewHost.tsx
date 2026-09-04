import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildPreview } from '../services/buildPreview';
import { PREVIEW_MARK } from '../types/preview';
import type { PreviewBuildError, PreviewMessage, PreviewRuntimeError } from '../types/preview';

interface PreviewHostProps {
    projectId: string;
    /** The project as the model wrote it: path -> content. */
    files: Record<string, string>;
    title: string;
    /**
     * Whether this host is on screen. A hidden pane must not bundle on every save —
     * the last built document is kept, so coming back is instant rather than a rebuild.
     */
    active?: boolean;
    className?: string;
}

/** Saves arrive in bursts; a bundle costs a quarter of a second. */
const DEBOUNCE_MS = 400;

/**
 * The generated app, running.
 *
 * The one seam. Both the wizard's final step and the IDE's Preview tab render this
 * component and nothing else — there is no second place that knows how a preview is
 * built, sandboxed, or how it reports failure.
 *
 * **The sandbox is `allow-scripts` and must never also be `allow-same-origin`.** The
 * two together defeat the sandbox: the document would reach into this origin's
 * storage and DOM, and the document is built from model output. `srcDoc` keeps it
 * origin-less and gives it no `src` to load, which is also what keeps the UI audit's
 * origins rule green.
 *
 * Against the blank white pane, three layers, because all three failures look the
 * same from outside and are three different bugs:
 *
 *   1. A build error never reaches the iframe at all — it is rendered here as text.
 *   2. A runtime error is posted out by the document's own harness and shown over
 *      the frame, which keeps whatever *did* render visible underneath it.
 *   3. An app that mounted nothing says so, rather than leaving white space to be
 *      read as a slow load.
 */
const PreviewHost: React.FC<PreviewHostProps> = ({ projectId, files, title, active = true, className }) => {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [html, setHtml] = useState<string | null>(null);
    const [errors, setErrors] = useState<PreviewBuildError[] | null>(null);
    const [status, setStatus] = useState<'idle' | 'building' | 'ready' | 'failed' | 'unavailable'>('idle');
    const [runtime, setRuntime] = useState<PreviewRuntimeError | null>(null);
    const [emptyRender, setEmptyRender] = useState(false);
    const [styleError, setStyleError] = useState<string | null>(null);

    /* The build is keyed on content, not on identity: the same files rebuilt produce
       the same document, and a re-render that changed nothing must not re-bundle. */
    const signature = useMemo(() => JSON.stringify(files), [files]);
    const buildSeq = useRef(0);
    /** What the document on screen was built from, so returning to the tab is free. */
    const builtSignature = useRef<string | null>(null);

    useEffect(() => {
        if (!active) return;
        /* Becoming visible is not a reason to rebuild. Without this the IDE re-bundles
           every time you come back from the Terminal, which is the cost the `active`
           prop exists to avoid, paid on the other edge. */
        if (signature === builtSignature.current) return;
        const revision = ++buildSeq.current;
        const controller = new AbortController();

        setStatus('building');
        /* Clear what the last document said before the next one exists. A runtime
           error describes a build; carrying it across would attach it to code that
           may already have fixed it. */
        setRuntime(null);
        setEmptyRender(false);

        const timer = setTimeout(async () => {
            const result = await buildPreview(projectId, files, controller.signal);
            if (revision !== buildSeq.current) return;

            if (!result) { setStatus('unavailable'); return; }
            if (!result.ok) {
                setErrors(result.errors);
                /* The stale document is dropped deliberately: showing the last working
                   app beside a build error invites reading it as the current one. */
                setHtml(null);
                setStatus('failed');
                return;
            }
            setErrors(null);
            setStyleError(result.styleError);
            setHtml(result.html);
            builtSignature.current = signature;
            setStatus('ready');
        }, DEBOUNCE_MS);

        return () => { clearTimeout(timer); controller.abort(); };
    }, [projectId, signature, active]);

    /**
     * The document runs at an opaque origin, so `event.origin` is the string
     * `"null"` — it identifies nothing and cannot be checked. The frame's own
     * `contentWindow` is the identity that means something, so that is what is
     * compared, and the harness's mark is what separates our messages from anything
     * the app itself posts.
     */
    const onMessage = useCallback((event: MessageEvent) => {
        if (event.source !== frameRef.current?.contentWindow) return;
        const data = event.data as PreviewMessage | undefined;
        if (!data || data.__preview !== PREVIEW_MARK) return;
        if (data.type === 'runtime-error') setRuntime(data);
        if (data.type === 'rendered') setEmptyRender(data.empty);
    }, []);

    useEffect(() => {
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [onMessage]);

    const frame = (
        <div className="bezel-shell">
            <div className="bezel-core overflow-hidden relative">
                {html !== null && (
                    <iframe
                        ref={frameRef}
                        /* Scripts, and nothing else. Never `allow-same-origin` with it. */
                        sandbox="allow-scripts"
                        srcDoc={html}
                        title={title}
                        className={`w-full bg-white block rounded-core ${className ?? 'h-[22rem] md:h-[28rem]'}`}
                    />
                )}
                {html === null && (
                    <div className={`w-full flex items-center justify-center bg-raised rounded-core ${className ?? 'h-[22rem] md:h-[28rem]'}`}>
                        <span className="meta text-xs text-metal-400">
                            {status === 'building' ? 'Building…'
                                : status === 'unavailable' ? 'The bundler did not answer'
                                : status === 'failed' ? 'Not built' : 'No preview yet'}
                        </span>
                    </div>
                )}

                {/* Layer 3. Sits over the frame rather than replacing it, so an app
                    that renders a shell and no content is still visible behind the
                    sentence explaining that it drew nothing. */}
                {status === 'ready' && emptyRender && !runtime && (
                    <div className="absolute inset-x-0 bottom-0 px-4 py-2 bg-surface/95 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
                        <p className="text-xs text-metal-200">
                            The app ran without error and rendered nothing.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div>
            {frame}

            {/* Layer 2. */}
            {runtime && (
                <div className="mt-3 p-3 bg-surface rounded-card hairline text-left">
                    <p className="meta text-xs text-accent-soft">
                        {runtime.rejection ? 'Unhandled rejection' : 'Runtime error'}
                        {runtime.line ? <span className="text-metal-400">{`  line ${runtime.line}`}</span> : null}
                    </p>
                    <p className="mt-1 text-sm text-metal-200 whitespace-pre-wrap break-words">{runtime.message}</p>
                </div>
            )}

            {/* Layer 1. */}
            {status === 'failed' && errors && errors.length > 0 && (
                <div className="mt-3 p-3 bg-surface rounded-card hairline text-left">
                    <p className="meta text-xs text-accent-soft">
                        The project did not build — {errors.length} error{errors.length === 1 ? '' : 's'}
                    </p>
                    <ul className="mt-2 space-y-2">
                        {errors.slice(0, 20).map((error, index) => (
                            <li key={index} className="text-sm text-metal-200">
                                {error.file && (
                                    <span className="meta text-xs text-metal-400">
                                        {error.file}{error.line ? `:${error.line}:${error.column}` : ''}{'  '}
                                    </span>
                                )}
                                <span className="whitespace-pre-wrap break-words">{error.text}</span>
                                {error.detail && <span className="block text-xs text-metal-400">{error.detail}</span>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Not a failure: the app renders, unstyled. Said plainly so it is not
                mistaken for the design the model produced. */}
            {status === 'ready' && styleError && (
                <p className="mt-3 text-xs text-metal-400">
                    The stylesheet did not compile, so this is the app without its styles — {styleError}
                </p>
            )}
        </div>
    );
};

export default PreviewHost;
