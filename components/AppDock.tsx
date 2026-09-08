import React from 'react';
import InfinityDock, { DockCopyIsLive } from './InfinityDock';
import { SURFACE_ORDER, SURFACE_LABEL } from '../types/ui';
import type { Surface } from '../types/ui';

/**
 * The app's destinations, and the one control that is not a destination.
 *
 * Replaces the four-slot bottom bar, which had run out of room: Chat and Build shared a
 * slot whose label flipped depending on a rail tab, so what you tapped and what you got
 * were decided in two different places, and `AI Tools` was a dead surface because its
 * tab lived in one destination while its content rendered in another.
 *
 * It runs at **every** width. `DESIGN.md §1` locked "phone nav: bottom tab bar" and
 * "two designs, not one that recomposes" — both are deliberately overturned here, and
 * rewritten there with the reason, because seven things do not fit in four slots twice.
 *
 * Memory stays a toggle rather than becoming a destination: the drawer is already a full
 * sheet on a phone, and it is the one control that must be reachable *from* wherever you
 * are rather than instead of it. It keeps the accent dot, so the glance test — any orange
 * means something needs you — still works from every screen.
 */

interface AppDockProps {
    surface: Surface;
    onSurfaceChange: (surface: Surface) => void;
    /** A destination with nothing behind it yet: shown, disabled, and explained. */
    unavailable: Partial<Record<Surface, string>>;
    memoryOpen: boolean;
    onMemoryToggle: () => void;
    memoryNeedsYou: boolean;
}

const icon = 'h-5 w-5 shrink-0';

const ICONS: Record<Surface, React.FC> = {
    projects: () => (
        <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h3.6l1.8 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
    ),
    chat: () => (
        <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v7A2.5 2.5 0 0117.5 16H12l-4.5 4v-4h-1A2.5 2.5 0 014 13.5v-7z" />
        </svg>
    ),
    build: () => (
        <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.6-.8L12 3z" />
        </svg>
    ),
    code: () => (
        <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 8.5L5 12l3.5 3.5M15.5 8.5L19 12l-3.5 3.5M13.5 5l-3 14" />
        </svg>
    ),
    preview: () => (
        <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 6.5A1.5 1.5 0 015 5h14a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5v-11zM3.5 9h17" />
        </svg>
    ),
    harness: () => (
        <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
        </svg>
    ),
};

const MemoryIcon = () => (
    <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5c-2.2 0-4 1.7-4 3.8 0 .5.1 1 .3 1.4A3.6 3.6 0 007 13c0 2 1.8 3.7 4 3.7h1V4.5h-1zM13 4.5v12.2h1c2.2 0 4-1.7 4-3.7a3.6 3.6 0 00-1.3-3.3c.2-.4.3-.9.3-1.4 0-2.1-1.8-3.8-4-3.8h0zM12 16.7V20" />
    </svg>
);

/**
 * One dock item.
 *
 * `disabled` rather than absent, so the dock's contents do not shuffle under a thumb
 * between visits — the idiom the old bar used for Code, kept because it was right.
 *
 * **A clone of this item is still a working control.** When the dock is revolving it
 * renders three copies, and a drag brings the outer two on screen; anything the user can
 * see and press has to do what it looks like it does. So a clone keeps its `onClick` and
 * gives up only the two things that should not be tripled: a tab stop and a name for a
 * screen reader to announce. The earlier attempt used `inert` for that, which also
 * removes pointer interaction — fourteen visible dead buttons on a desktop.
 */
const Item: React.FC<{
    label: string;
    selected: boolean;
    disabled?: boolean;
    hint?: string;
    dot?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}> = ({ label, selected, disabled = false, hint, dot = false, onClick, children }) => {
    const live = React.useContext(DockCopyIsLive);
    return (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={disabled ? hint : undefined}
        aria-label={dot ? `${label} — something needs you` : undefined}
        aria-current={selected && !disabled ? 'page' : undefined}
        /* Out of the tab order in a clone, but not out of reach. */
        tabIndex={live ? undefined : -1}
        /* And never focused by the press itself: a clone sits inside `aria-hidden`, and
           focus landing there is the exact "hidden but focused" state this is all trying
           to avoid. Preventing the default on mousedown suppresses focus while leaving
           the click intact. */
        onMouseDown={live ? undefined : (e) => e.preventDefault()}
        className={[
            'tap relative shrink-0 flex flex-col items-center justify-center gap-1 px-3 pt-2 pb-1',
            'text-[11px] font-medium select-none',
            'transition-colors duration-200 ease-fluid',
            disabled
                ? 'text-metal-500 opacity-35'
                : selected
                    ? 'text-metal-100'
                    : 'text-metal-300 active:text-metal-100 md:hover:text-metal-100',
        ].join(' ')}
    >
        {/* Selection is a value change and a rule, never orange. */}
        <span
            aria-hidden
            className={`absolute top-0 h-0.5 w-8 rounded-full transition-colors duration-200 ease-fluid
                        ${selected && !disabled ? 'bg-metal-300' : 'bg-transparent'}`}
        />
        <span className="relative">
            {children}
            {dot && <span aria-hidden className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-accent" />}
        </span>
        <span className="truncate max-w-[5rem]">{label}</span>
    </button>
    );
};

const AppDock: React.FC<AppDockProps> = ({
    surface, onSurfaceChange, unavailable, memoryOpen, onMemoryToggle, memoryNeedsYou,
}) => (
    <InfinityDock label="Destinations">
        {SURFACE_ORDER.map((name) => {
            const Icon = ICONS[name];
            const why = unavailable[name];
            return (
                <Item
                    key={name}
                    label={SURFACE_LABEL[name]}
                    selected={surface === name}
                    disabled={Boolean(why)}
                    hint={why}
                    onClick={() => onSurfaceChange(name)}
                >
                    <Icon />
                </Item>
            );
        })}
        {/* Not a destination: a drawer over whichever one you are on. */}
        <Item label="Memory" selected={memoryOpen} dot={memoryNeedsYou} onClick={onMemoryToggle}>
            <MemoryIcon />
        </Item>
    </InfinityDock>
);

export default AppDock;
