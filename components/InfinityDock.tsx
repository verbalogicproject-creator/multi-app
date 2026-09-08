import React, { createContext, useCallback, useEffect, useRef, useState } from 'react';

/**
 * The dock: one row of destinations, which revolves without end **when it has to**.
 *
 * Ported from `canvas-os/src/components/os/InfiniteDock.tsx`. The mechanism is the one
 * that works there: render the children three times, park the scroll in the middle copy,
 * and whenever it drifts past a third either way, jump it back by exactly one third. The
 * jump lands on identical pixels, so the strip appears to have no ends.
 *
 * **Two things about the clones, both learned the expensive way.**
 *
 * *They must not exist when they are not needed.* This first shipped cloning
 * unconditionally, and on a 1440px desktop one copy is ~510px wide — so the scrollport
 * showed the live copy in the middle with most of both outer copies flanking it.
 * Measured: **fourteen visible buttons that did nothing**, against seven that worked.
 * Two thirds of the dock was dead pixels that looked exactly like the live third. So the
 * copy count is measured, not assumed: one copy when one copy fits, three only when the
 * row genuinely overflows and there is something to revolve.
 *
 * *When they do exist, a visible clone must work.* During a drag on a phone the outer
 * copies come on screen; a control the user can see and tap has to do what it looks like
 * it does. They were `inert`, which removes them from focus order *and* from pointer
 * interaction — the second half being the bug. They are now `aria-hidden` (one
 * announcement, not three) with `tabIndex={-1}` on their controls (one tab stop, not
 * three) and focus suppressed on press, while clicks pass straight through to the same
 * handler the live copy uses. Hidden from assistive technology, identical to the finger.
 *
 * The live set carries `data-dock-live`, which is how tests address a destination
 * without matching a clone.
 */

interface InfinityDockProps {
    children: React.ReactNode;
    /** Labelled for assistive technology; the clones are excluded from it. */
    label: string;
}

/** How many copies it takes to hide both seams while wrapping. */
const WRAPPED_COPIES = 3;

/**
 * Whether the copy a dock item is rendered into is the real one.
 *
 * Items read this to take themselves out of the tab order without taking themselves out
 * of the pointer's reach. It defaults to `true` so an item used outside a dock — or in a
 * dock that is not cloning — behaves normally.
 */
export const DockCopyIsLive = createContext(true);

const InfinityDock: React.FC<InfinityDockProps> = ({ children, label }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const dragStart = useRef({ x: 0, scroll: 0 });

    /* One until measurement says otherwise. Starting at one is the safe direction: a dock
       that has not measured yet shows a complete, working row rather than a row flanked
       by clones it may turn out not to need. */
    const [copies, setCopies] = useState(1);
    const copiesRef = useRef(1);
    copiesRef.current = copies;
    const wrapping = copies > 1;

    /**
     * Decide whether this dock needs to revolve at all.
     *
     * Re-run on resize because the answer changes when a phone is rotated: seven items
     * overflow 390px of portrait and fit 844px of landscape, and a dock that decided once
     * at mount would keep three copies for a row that now fits twice over.
     */
    useEffect(() => {
        const el = scrollRef.current;
        const content = contentRef.current;
        if (!el || !content) return;

        const fit = () => {
            const port = el.clientWidth;
            const one = content.clientWidth / copiesRef.current;
            /* Zero on the first frame of a phone layout; asking again next frame is
               cheaper than guessing wrong. */
            if (port === 0 || one === 0) return;
            /* The +1 absorbs sub-pixel rounding, which would otherwise flip a row that
               exactly fits back and forth between one copy and three. */
            const needed = one > port + 1 ? WRAPPED_COPIES : 1;
            if (needed !== copiesRef.current) setCopies(needed);
        };

        let frames = 0;
        let cancelled = false;
        const settle = () => {
            if (cancelled) return;
            fit();
            if (++frames < 8) requestAnimationFrame(settle);
        };
        requestAnimationFrame(settle);

        if (typeof ResizeObserver === 'undefined') return () => { cancelled = true; };
        const observer = new ResizeObserver(fit);
        observer.observe(el);
        return () => { cancelled = true; observer.disconnect(); };
    }, []);

    /** Park in the middle copy and keep it there. Only meaningful while wrapping. */
    useEffect(() => {
        const el = scrollRef.current;
        const content = contentRef.current;
        if (!el || !content) return;
        if (!wrapping) { el.scrollLeft = 0; return; }

        /* The first frame of a phone layout reports a width of zero, so parking
           immediately leaves the strip showing the leftmost copy. Poll a few frames until
           layout settles — usually two or three. */
        let cancelled = false;
        let attempts = 0;
        const park = () => {
            if (cancelled) return;
            attempts += 1;
            if (content.clientWidth > 0) {
                el.scrollLeft = content.clientWidth / copies;
                return;
            }
            if (attempts < 8) requestAnimationFrame(park);
        };
        requestAnimationFrame(park);

        let jumping = false;
        const onScroll = () => {
            if (jumping) return;
            const third = content.clientWidth / copies;
            if (third === 0) return;   // never wrap before layout settles
            if (el.scrollLeft > third * 2) {
                jumping = true;
                el.scrollLeft -= third;
                requestAnimationFrame(() => { jumping = false; });
            } else if (el.scrollLeft < third) {
                jumping = true;
                el.scrollLeft += third;
                requestAnimationFrame(() => { jumping = false; });
            }
        };

        el.addEventListener('scroll', onScroll, { passive: true });
        return () => { cancelled = true; el.removeEventListener('scroll', onScroll); };
    }, [wrapping, copies]);

    const onPointerDown = (e: React.PointerEvent) => {
        const el = scrollRef.current;
        if (!wrapping || !el) return;
        setDragging(true);
        dragStart.current = { x: e.pageX, scroll: el.scrollLeft };
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const el = scrollRef.current;
        if (!dragging || !el) return;
        el.scrollLeft = dragStart.current.scroll - (e.pageX - dragStart.current.x) * 1.4;
    };
    const stopDrag = useCallback(() => setDragging(false), []);

    return (
        <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center pointer-events-none safe-b">
            <div
                className="w-screen flex justify-center pointer-events-auto bg-surface/85 backdrop-blur-xl
                           shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
                /* The fade is what sells the endlessness: items do not stop, they
                   dissolve. Applied only while wrapping — with a single copy there are no
                   ends to hide, and the mask would just wash out two real destinations. */
                style={wrapping ? {
                    WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)',
                    maskImage: 'linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)',
                } : undefined}
            >
                <div
                    ref={scrollRef}
                    /* `w-full` while wrapping, so the port is the viewport and the copies
                       slide through it. Shrink-wrapped otherwise, so the port is exactly
                       one copy wide and centred — which is also what makes the measurement
                       stable in both directions rather than oscillating. */
                    className={`flex overflow-x-auto scrollbar-none
                                ${wrapping ? `w-full ${dragging ? 'cursor-grabbing' : 'cursor-grab'}` : 'max-w-full'}`}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={stopDrag}
                    onPointerLeave={stopDrag}
                >
                    <div ref={contentRef} className="flex flex-nowrap shrink-0">
                        {Array.from({ length: copies }, (_, copy) => {
                            /* With one copy it is the live one. With three it is the middle
                               one, which is where the scroll is parked. */
                            const live = copies === 1 || copy === 1;
                            return (
                                <DockCopyIsLive.Provider key={copy} value={live}>
                                    <div
                                        {...(live
                                            ? { 'data-dock-live': 'true', role: 'navigation', 'aria-label': label }
                                            /* `aria-hidden` only. `inert` was here, and it
                                               also removes pointer interaction — which turned
                                               every clone the user could see into a control
                                               that ignored them. The focus half of what
                                               `inert` gave us is handled per-item by
                                               `DockCopyIsLive`, which does not cost the
                                               click. */
                                            : { 'aria-hidden': true })}
                                        className="flex shrink-0 items-center gap-1 px-3 sm:gap-2 sm:px-6"
                                    >
                                        {children}
                                    </div>
                                </DockCopyIsLive.Provider>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InfinityDock;
