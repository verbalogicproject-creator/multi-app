/**
 * Types for `aesthetic.js`. See `allowlist.d.ts` for why this stays plain `.js`
 * with a hand-written declaration: the server builds prompts from it and the
 * client (`Step_Theme.tsx`) renders pickers from the same data, and a second copy
 * of the dimension labels in either place is exactly the drift this avoids.
 */

export interface AestheticOption {
    label: string;
    directive: string;
}

export interface AestheticDimension {
    label: string;
    options: Record<string, AestheticOption>;
}

export declare const AESTHETIC_DIMENSIONS: {
    typography: AestheticDimension;
    motion: AestheticDimension;
    background: AestheticDimension;
};

export declare const ANTI_SLOP_DIRECTIVE: string;
export declare const SELF_REFLECTION_RUBRIC: string;

export interface AestheticConfig {
    typography?: string;
    motion?: string;
    background?: string;
    antiSlop?: boolean;
    selfReflection?: boolean;
}

export declare const buildAestheticDirective: (
    config: AestheticConfig | null | undefined,
    provider: string | undefined,
) => string;
