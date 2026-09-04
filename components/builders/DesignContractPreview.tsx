import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ThemeColors, TypographyOption } from '../../utils/palettes';
import { buildDesignContractHtml } from '../../utils/designContract';

interface DesignContractPreviewProps {
    colors: ThemeColors;
    typography: TypographyOption;
    projectName?: string;
    /** Height of the visible frame. The document inside is scaled to fit its width. */
    className?: string;
}

/**
 * The width the contract document is written for.
 *
 * `utils/designContract.ts` lays out a nav with `display:flex` and no `flex-wrap`, so
 * its min-content width is roughly the sum of its links — about 380px — and its
 * `.wrap` is `max-width: 720px`. Rendered into a narrower frame it does not reflow;
 * it overflows, and the iframe grows its own horizontal scrollbar.
 *
 * That is what a 390px phone showed: an art-direction card ~262px wide (the wizard's
 * padding applied twice, then the card's, then the cell's) holding a document that
 * needed 380, clipped mid-nav at "AICODEJOURNAL  Features  P…".
 */
const LOGICAL_WIDTH = 760;

/**
 * The design tokens rendered as a real page, in a fully sandboxed iframe — no
 * scripts, no network — so a direction can be judged before any code is generated.
 *
 * **Scaled, not squeezed.** The document is laid out at its own width and then
 * transformed down to whatever the card actually has. A miniature of the real page is
 * the honest answer to "what will this look like"; a clipped corner of it is not, and
 * neither is a reflowed version that no visitor would ever see. `transform` also costs
 * nothing at render time and cannot change the document's own layout, which is the
 * whole point of previewing it.
 */
const DesignContractPreview: React.FC<DesignContractPreviewProps> = ({ colors, typography, projectName, className }) => {
    const html = useMemo(
        () => buildDesignContractHtml(colors, typography, projectName),
        [colors.bg, colors.surface, colors.text, colors.muted, colors.primary, colors.accent, typography.name, projectName],
    );

    const hostRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    /* Measured rather than guessed: the same component sits in a full-width panel and
       in a third of a phone's width, and only the element knows which. */
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const measure = () => {
            const width = host.clientWidth;
            if (width > 0) setScale(Math.min(1, width / LOGICAL_WIDTH));
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(host);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={hostRef}
            className={`relative overflow-hidden bg-white ${className ?? 'w-full h-[26rem] rounded-lg'}`}
        >
            <iframe
                sandbox=""
                srcDoc={html}
                title={`Design preview${projectName ? ` for ${projectName}` : ''}`}
                aria-hidden={scale < 0.5 || undefined}
                /* Laid out at the width it was written for, then scaled from the top
                   left so the page's own origin stays in the corner of the card.
                   Height is the frame's height divided back out, so the document fills
                   the visible box rather than being letterboxed inside a scaled one. */
                style={{
                    width: `${LOGICAL_WIDTH}px`,
                    height: `${100 / scale}%`,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    border: 0,
                    display: 'block',
                    pointerEvents: 'none',
                }}
            />
        </div>
    );
};

export default DesignContractPreview;
