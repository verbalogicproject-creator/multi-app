import React from 'react';
import type { MobileSurface } from '../types/ui';

/**
 * The phone's navigation, and the phone's only.
 *
 * The desktop has room for the rail, the main panel and the memory drawer at
 * once; a 390px screen does not. So on a phone they become destinations and
 * this bar is how you move between them. At `md:` it is gone and the desktop
 * layout is untouched — the two are deliberately different designs, not one
 * design squeezed.
 *
 * Selection is carried by value and weight, never by the accent: choosing a tab
 * is something you did, not something that needs you. The one accent on this
 * bar is the Memory dot, and it means exactly what it means everywhere else.
 */

export type { MobileSurface } from '../types/ui';

interface MobileTabBarProps {
    surface: MobileSurface;
    onSurfaceChange: (surface: MobileSurface) => void;
    /** What the main panel currently is — the label tracks reality rather than a fixed word. */
    mainLabel: string;
    /** Code follows the active agent, so without one there is nothing to show. */
    codeEnabled: boolean;
    codeHint: string;
    memoryOpen: boolean;
    onMemoryToggle: () => void;
    memoryNeedsYou: boolean;
}

const iconClasses = 'h-5 w-5 shrink-0';

const ProjectsIcon = () => (
    <svg className={iconClasses} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h3.6l1.8 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
);

const BuildIcon = () => (
    <svg className={iconClasses} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v7A2.5 2.5 0 0117.5 16H12l-4.5 4v-4h-1A2.5 2.5 0 014 13.5v-7z" />
    </svg>
);

const CodeIcon = () => (
    <svg className={iconClasses} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 8.5L5 12l3.5 3.5M15.5 8.5L19 12l-3.5 3.5M13.5 5l-3 14" />
    </svg>
);

const MemoryIcon = () => (
    <svg className={iconClasses} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5c-2.2 0-4 1.7-4 3.8 0 .5.1 1 .3 1.4A3.6 3.6 0 007 13c0 2 1.8 3.7 4 3.7h1V4.5h-1zM13 4.5v12.2h1c2.2 0 4-1.7 4-3.7a3.6 3.6 0 00-1.3-3.3c.2-.4.3-.9.3-1.4 0-2.1-1.8-3.8-4-3.8h0zM12 16.7V20" />
    </svg>
);

/**
 * One tab. `disabled` keeps the bar's arity stable rather than making tabs
 * appear and vanish under the thumb — the same idiom the rail already uses for
 * AI Tools while an agent is active.
 */
const Tab: React.FC<{
    label: string;
    selected: boolean;
    disabled?: boolean;
    hint?: string;
    dot?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}> = ({ label, selected, disabled = false, hint, dot = false, onClick, children }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={disabled ? hint : undefined}
        aria-label={dot ? `${label} — something needs you` : undefined}
        aria-current={selected && !disabled ? 'page' : undefined}
        className={[
            'tap relative flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1',
            'text-[11px] font-medium',
            'transition-colors duration-200 ease-fluid',
            disabled
                ? 'text-metal-500 opacity-35'
                : selected
                    ? 'text-metal-100'
                    : 'text-metal-300 active:text-metal-100',
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
            {dot && (
                <span aria-hidden className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-accent" />
            )}
        </span>
        <span className="truncate max-w-full px-1">{label}</span>
    </button>
);

const MobileTabBar: React.FC<MobileTabBarProps> = ({
    surface, onSurfaceChange, mainLabel, codeEnabled, codeHint,
    memoryOpen, onMemoryToggle, memoryNeedsYou,
}) => (
    <nav
        aria-label="Sections"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 flex items-stretch
                   bg-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] safe-b"
    >
        <Tab label="Projects" selected={surface === 'projects'} onClick={() => onSurfaceChange('projects')}>
            <ProjectsIcon />
        </Tab>
        <Tab label={mainLabel} selected={surface === 'main'} onClick={() => onSurfaceChange('main')}>
            <BuildIcon />
        </Tab>
        <Tab
            label="Code"
            selected={surface === 'code'}
            disabled={!codeEnabled}
            hint={codeHint}
            onClick={() => onSurfaceChange('code')}
        >
            <CodeIcon />
        </Tab>
        <Tab label="Memory" selected={memoryOpen} dot={memoryNeedsYou} onClick={onMemoryToggle}>
            <MemoryIcon />
        </Tab>
    </nav>
);

export default MobileTabBar;
