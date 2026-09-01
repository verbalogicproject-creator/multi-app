// Design tokens for the builder's theme step. Palettes are plain hex so they can
// be rendered live in the design-contract preview and handed to the code
// generator verbatim, instead of being described in prose.

export interface ThemeColors {
    bg: string;       // page background
    surface: string;  // cards, panels, nav
    text: string;     // primary text
    muted: string;    // secondary text
    primary: string;  // primary action
    accent: string;   // accent / highlight
}

export interface Palette {
    name: string;
    colors: ThemeColors;
}

/** An AI-proposed visual direction for the current project. */
export interface ArtDirection {
    name: string;
    rationale: string;
    typography: string;
    colors: ThemeColors;
}

export interface TypographyOption {
    name: string;
    headingFamily: string;
    bodyFamily: string;
    headingWeight: number;
    headingTransform: 'none' | 'uppercase';
    headingSpacing: string;
    /** Instruction handed to the code generator. */
    promptSpec: string;
}

// System font stacks only: the preview iframe is sandboxed and must never make
// an external request, so a webfont could not load there anyway.
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

// The first three names are unchanged from the original picker so previously
// saved builds keep resolving.
export const TYPOGRAPHY_OPTIONS: TypographyOption[] = [
    {
        name: 'Sans-serif & Friendly',
        headingFamily: SANS, bodyFamily: SANS, headingWeight: 600, headingTransform: 'none', headingSpacing: '-0.02em',
        promptSpec: "font-sans throughout; headings font-semibold tracking-tight; body leading-relaxed.",
    },
    {
        name: 'Serif & Professional',
        headingFamily: SERIF, bodyFamily: SANS, headingWeight: 500, headingTransform: 'none', headingSpacing: '-0.01em',
        promptSpec: "font-serif headings with font-sans body; headings font-medium; formal editorial feel.",
    },
    {
        name: 'Mono & Techy',
        headingFamily: MONO, bodyFamily: SANS, headingWeight: 600, headingTransform: 'uppercase', headingSpacing: '0.04em',
        promptSpec: "font-mono for headings, labels and data; font-sans for long body text; uppercase tracking-wide micro-labels.",
    },
    {
        name: 'Grotesk & Bold',
        headingFamily: SANS, bodyFamily: SANS, headingWeight: 800, headingTransform: 'uppercase', headingSpacing: '-0.03em',
        promptSpec: "font-sans throughout; headings font-extrabold uppercase tracking-tighter at large sizes; body text-base leading-relaxed for contrast.",
    },
    {
        name: 'Editorial Serif',
        headingFamily: SERIF, bodyFamily: SERIF, headingWeight: 600, headingTransform: 'none', headingSpacing: '-0.02em',
        promptSpec: "font-serif for both headings and body; generous leading-loose body; long-form editorial rhythm with wide margins.",
    },
];

// The first four names match the original picker for backward compatibility.
export const PALETTES: Palette[] = [
    { name: 'Modern & Minimal',  colors: { bg: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#64748b', primary: '#2563eb', accent: '#0ea5e9' } },
    { name: 'Vibrant & Playful', colors: { bg: '#fffbeb', surface: '#ffffff', text: '#1f2937', muted: '#6b7280', primary: '#ec4899', accent: '#8b5cf6' } },
    { name: 'Corporate & Clean', colors: { bg: '#ffffff', surface: '#f9fafb', text: '#374151', muted: '#6b7280', primary: '#4338ca', accent: '#0891b2' } },
    { name: 'Dark & Elegant',    colors: { bg: '#030712', surface: '#111827', text: '#e5e7eb', muted: '#9ca3af', primary: '#14b8a6', accent: '#f59e0b' } },
    { name: 'Midnight Neon',     colors: { bg: '#0b1020', surface: '#151b34', text: '#e8ecff', muted: '#8b95c9', primary: '#7c3aed', accent: '#22d3ee' } },
    { name: 'Warm Editorial',    colors: { bg: '#faf6f0', surface: '#ffffff', text: '#292524', muted: '#78716c', primary: '#9a3412', accent: '#ca8a04' } },
    { name: 'Forest Calm',       colors: { bg: '#f4f7f4', surface: '#ffffff', text: '#14261c', muted: '#5f7367', primary: '#15803d', accent: '#a16207' } },
    { name: 'Ocean Deep',        colors: { bg: '#f0f9ff', surface: '#ffffff', text: '#0c2b3d', muted: '#5b7d91', primary: '#0369a1', accent: '#06b6d4' } },
    { name: 'Mono Slate',        colors: { bg: '#f5f5f4', surface: '#ffffff', text: '#1c1917', muted: '#78716c', primary: '#292524', accent: '#0d9488' } },
    { name: 'Sunset Coral',      colors: { bg: '#fff7f5', surface: '#ffffff', text: '#31170f', muted: '#8a6a5e', primary: '#e11d48', accent: '#f97316' } },
    { name: 'Nordic Frost',      colors: { bg: '#eef2f6', surface: '#ffffff', text: '#1e293b', muted: '#64748b', primary: '#334155', accent: '#38bdf8' } },
    { name: 'Terracotta Craft',  colors: { bg: '#1c1917', surface: '#292524', text: '#f5f5f4', muted: '#a8a29e', primary: '#ea580c', accent: '#84cc16' } },
];

export const DEFAULT_PALETTE = PALETTES[0];
export const CUSTOM_PALETTE_NAME = 'Custom';

export const COLOR_ROLES: { key: keyof ThemeColors; label: string; hint: string }[] = [
    { key: 'bg',      label: 'Background', hint: 'Page background' },
    { key: 'surface', label: 'Surface',    hint: 'Cards, panels, nav' },
    { key: 'text',    label: 'Text',       hint: 'Primary text' },
    { key: 'muted',   label: 'Muted',      hint: 'Secondary text' },
    { key: 'primary', label: 'Primary',    hint: 'Buttons, links' },
    { key: 'accent',  label: 'Accent',     hint: 'Highlights' },
];

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Coerces untrusted colors (model output, restored state) into safe hex values. */
export const sanitizeColors = (input: any, fallback: ThemeColors = DEFAULT_PALETTE.colors): ThemeColors => {
    const pick = (key: keyof ThemeColors): string => {
        const value = input?.[key];
        return typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim() : fallback[key];
    };
    return { bg: pick('bg'), surface: pick('surface'), text: pick('text'), muted: pick('muted'), primary: pick('primary'), accent: pick('accent') };
};

export const findPalette = (name: string): Palette | undefined => PALETTES.find(p => p.name === name);

export const findTypography = (name: string): TypographyOption =>
    TYPOGRAPHY_OPTIONS.find(t => t.name === name) ?? TYPOGRAPHY_OPTIONS[0];

/** Resolves a stored theme (which may predate token colors) to concrete colors. */
export const resolveThemeColors = (theme: { palette?: string; colors?: any }): ThemeColors => {
    if (theme?.colors) return sanitizeColors(theme.colors);
    return findPalette(theme?.palette ?? '')?.colors ?? DEFAULT_PALETTE.colors;
};
