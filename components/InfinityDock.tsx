import React, { useEffect, useRef, useState } from 'react';

/**
 * The dock: one row of destinations that revolves without end.
 *
 * Ported from `canvas-os/src/components/os/InfiniteDock.tsx` and rethemed onto this
 * app's tokens. The mechanism is the same one that works there: render the children
 * three times, park the scroll in the middle copy, and whenever it drifts past a third
 * either way, jump it back by exactly one third. The jump lands on identical pixels, so
 * the strip appears to have no ends.
 *
 * **The clones are the whole difficulty.** Three copies of every destination means three
 * of every button — three identical accessible names for a screen reader to read out,
 * three tab stops to walk through, and three matches for any selector that asks for one.
 * So exactly one copy is real: the middle set is live, and the outer two are
 * `aria-hidden` **and** `inert`, which removes them from the accessibility tree and from
 * focus order together. `inert` is the load-bearing half — `aria-hidden` alone still
 * leaves a focusable button that a keyboard walks into and a screen reader then refuses
 * to describe, which is worse than either problem on its own.
 *
 * The live set carries `data-dock-live`, which is how tests address a destination
 * without matching a clone.
 */

interface InfinityDockProps {
    children: React.ReactNode;
    /** Labelled for assistive technology; the clones are excluded from it. */
    label: string;
}

const COPIES = 3;

const InfinityDock: React.FC<InfinityDockProps> = ({ children, label }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const dragStart = useRef({ x: 0, scroll: 0 });

    useEffect(() => {
        const el = scrollRef.current;
        const content = contentRef.current;
        if (!el || !content) return;

        /* On a phone the first frame reports a width of zero, so parking the scroll
           immediately leaves the strip showing the leftmost copy with its right edge
           under the mask. Poll a few frames until layout has settled — the desktop is
           correct on frame one, a phone usually by two or three. */
        let cancelled = false;
        let attempts = 0;
        const settle = () => {
            if (cancelled) return;
            attempts += 1;
            if (content.clientWidth > 0) {
                el.scrollLeft = content.clientWidth / COPIES;
                return;
            }
            if (attempts < 8) requestAnimationFrame(settle);
        };
        requestAnimationFrame(settle);

        let wrapping = false;
        const onScroll = () => {
            if (wrapping) return;
            const third = content.clientWidth / COPIES;
            if (third === 0) return;   // never wrap before layout settles
            if (el.scrollLeft > third * 2) {
                wrapping = true;
                el.scrollLeft -= third;
                requestAnimationFrame(() => { wrapping = false; });
            } else if (el.scrollLeft < third) {
                wrapping = true;
                el.scrollLeft += third;
                requestAnimationFrame(() => { wrapping = false; });
            }
        };

        el.addEventListener('scroll', onScroll, { passive: true });
        return () => { cancelled = true; el.removeEventListener('scroll', onScroll); };
    }, []);

    const onPointerDown = (e: React.PointerEvent) => {
        const el = scrollRef.current;
        if (!el) return;
        setDragging(true);
        dragStart.current = { x: e.pageX, scroll: el.scrollLeft };
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const el = scrollRef.current;
        if (!dragging || !el) return;
        el.scrollLeft = dragStart.current.scroll - (e.pageX - dragStart.current.x) * 1.4;
    };
    const stopDrag = () => setDragging(false);

    return (
        <div
            className="fixed inset-x-0 bottom-0 z-30 flex justify-center pointer-events-none safe-b"
        >
            <div
                className="w-screen pointer-events-auto bg-surface/85 backdrop-blur-xl
                           shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
                /* The fade is what sells the endlessness: items do not stop, they
                   dissolve. Kept narrow so no destination is unreadable at rest. */
                style={{
                    WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)',
                    maskImage: 'linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)',
                }}
            >
                <div
                    ref={scrollRef}
                    className={`flex overflow-x-auto scrollbar-none w-full
                                ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={stopDrag}
                    onPointerLeave={stopDrag}
                >
                    <div ref={contentRef} className="flex flex-nowrap shrink-0">
                        {Array.from({ length: COPIES }, (_, copy) => {
                            const live = copy === 1;
                            return (
                                <div
                                    key={copy}
                                    {...(live
                                        ? { 'data-dock-live': 'true', role: 'navigation', 'aria-label': label }
                                        /* Not merely hidden: `inert` removes them from focus
                                           order too. Hidden-but-focusable is the worst of
                                           both — a keyboard lands on a control nothing will
                                           describe.

                                           A boolean, not `''`. React 19 takes `inert` as a
                                           real boolean prop and drops a falsy empty string,
                                           which is how this first shipped: three copies, none
                                           inert, eighteen focusable controls for six
                                           destinations. `audit:ui` asserts it now. */
                                        : { 'aria-hidden': true, inert: true })}
                                    className="flex shrink-0 items-center gap-1 px-3 sm:gap-2 sm:px-6"
                                >
                                    {children}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InfinityDock;
