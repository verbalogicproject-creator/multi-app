/**
 * The variety lever the generate prompt does not otherwise have.
 *
 * `server.js`'s design contract (palette hex tokens, one of five named font stacks,
 * `max-w-6xl mx-auto px-4` as *the* container) is precise about color and layout and
 * silent about three things every one of those apps still shares: how typographic
 * hierarchy feels beyond the font family, whether anything moves, and how a
 * background surface is treated. Two builds with different palettes and the same
 * silence on those three axes read as the same product wearing different colors.
 *
 * Ported from `studio-standalone/backend/routers/studio.py` (`AESTHETIC_PROMPTS`,
 * `ANTI_SLOP_PROMPT`, `SELF_REFLECTION_PROMPT`), not copied whole. Two of its five
 * dimensions are dropped on purpose, not merely unported:
 *
 *  - **`theme` (light/dark/colorful)** — multi-app already has a strictly more
 *    precise answer to this question: exact hex tokens per role, either a named
 *    palette or the user's own colour picker (`describePalette` in `server.js`). A
 *    vague "use a dark theme" layered on top could actively contradict a light
 *    palette the person chose.
 *  - **`stateManagement` (zustand/redux) and `stylingParadigm` (tailwind/css-modules/
 *    styled)** — not real choices here. Stack rule 3 mandates Tailwind v4
 *    non-negotiably (`vite.config.ts`, `tsconfig.json` and `src/index.css` are all
 *    scaffolded around it), and only `zustand` is on `providers/allowlist.js`; a
 *    picker whose other options cannot run is a dishonest picker.
 *
 * What is left — `typography`, `motion`, `background` — is exactly the set that adds
 * a real, non-conflicting degree of freedom.
 */

/** Every dimension, its UI label, and the directive text for each option. */
export const AESTHETIC_DIMENSIONS = {
    typography: {
        label: 'Typographic voice',
        options: {
            editorial: {
                label: 'Editorial',
                directive: "Give headings a distinct editorial voice: a serif or high-contrast display font from the chosen font stack, generous body line-height (leading-relaxed or looser), and a clear three-level size hierarchy. Favor restraint over decoration.",
            },
            playful: {
                label: 'Playful',
                directive: 'Give headings and key numbers a playful, expressive feel: rounder weights, slightly larger scale jumps between hierarchy levels, and room for personality in copy and iconography. Avoid stiff, corporate phrasing.',
            },
            minimal: {
                label: 'Minimal',
                directive: 'Keep typography restrained: one weight change between heading and body, tight tracking, small body text (text-sm as the default), and let whitespace carry the hierarchy instead of size jumps.',
            },
            bold: {
                label: 'Bold',
                directive: 'Make typography the loudest element on the page: heavy weights (font-extrabold or font-black) on a large display heading (text-5xl or bigger on the hero), strong size contrast between heading and body, and uppercase tracking-wide accents for labels.',
            },
        },
    },
    motion: {
        label: 'Motion',
        options: {
            subtle: {
                label: 'Subtle',
                directive: "Add restrained micro-interactions: a brief fade or scale on mount for hero content, a gentle hover state (scale or shadow, not both) on interactive elements, and Tailwind's transition utilities for state changes. Nothing should feel showy.",
            },
            rich: {
                label: 'Rich',
                directive: "Add noticeable motion: a staggered entrance for lists and cards, hover states with visible movement, and at least one animated element that makes the page feel alive (a slow gradient shift, a pulsing indicator, a transform on scroll into view). Use CSS transitions or @keyframes in src/index.css for anything Tailwind's built-in utilities cannot express — never invent a Tailwind class name that does not exist.",
            },
        },
    },
    background: {
        label: 'Background treatment',
        options: {
            gradient: {
                label: 'Gradient',
                directive: "Use gradients deliberately: a gradient hero background or gradient text on the primary heading, and a subtle gradient overlay on elevated cards. Derive gradient stops from the theme's own primary and accent tokens, not arbitrary colors.",
            },
            pattern: {
                label: 'Pattern',
                directive: 'Add a subtle background pattern behind hero or empty-state sections — a low-opacity dot grid, diagonal lines, or a repeating shape — as an inline SVG or CSS background-image. Keep it quiet enough that content stays the focus.',
            },
            glass: {
                label: 'Glass',
                directive: 'Use glassmorphism for elevated surfaces: semi-transparent backgrounds (e.g. bg-white/10), backdrop-blur, and a thin light border. Reserve it for cards or panels that sit above other content, not the whole page.',
            },
        },
    },
};

/** An emphatic, additional pass against generic output — distinct from (and
 *  stronger than) the design contract's own anti-slop line, for when a person
 *  explicitly wants the extra push. */
export const ANTI_SLOP_DIRECTIVE = "Treat these as failures, not suggestions: a Bootstrap-blue (#007bff) or Bootstrap-gray (#6c757d) anywhere; a default, unstyled-looking button or card; a layout that would look identical with the project name swapped out. Every color, spacing choice and component style must trace back to a decision this project's plan or theme actually made.";

/** Silent self-grading — the rubric asks for a revision, never a report. */
export const SELF_REFLECTION_RUBRIC = 'Before finishing, score your own output 1-5 on: visual distinctiveness (does this look custom-designed, or could it be any app?), completeness (does every interactive element actually work?), and responsiveness (does it hold up narrower than 400px?). If anything scores below 3, fix that file before moving on — do not mention the scores anywhere in your output.';

/** The directive text for every section a config turns on, in a fixed order. */
const sectionsFor = (config) => {
    if (!config) return [];
    const sections = [];
    for (const [dimension, spec] of Object.entries(AESTHETIC_DIMENSIONS)) {
        const option = spec.options[config[dimension]];
        if (option) sections.push(option.directive);
    }
    if (config.antiSlop) sections.push(ANTI_SLOP_DIRECTIVE);
    if (config.selfReflection) sections.push(SELF_REFLECTION_RUBRIC);
    return sections;
};

/**
 * The block appended to the outgoing generate prompt — empty when nothing is
 * configured, so a build that never touches this feature sees no change at all.
 *
 * Dialect-aware for the same reason `providers/prompts.js` renders one prompt five
 * ways: Claude over-formats plain text and under-weights it without structure, so it
 * gets XML tags; OpenAI's own tuning favors lean markdown sections; Gemini and the
 * open (NVIDIA-hosted) models take plain text, and the open models get it numbered
 * rather than proseline because they follow literal, enumerated rules best.
 */
export const buildAestheticDirective = (config, provider) => {
    const sections = sectionsFor(config);
    if (sections.length === 0) return '';

    if (provider === 'anthropic') {
        return '\n\n' + sections.map((s) => `<aesthetic_directive>\n${s}\n</aesthetic_directive>`).join('\n');
    }
    if (provider === 'openai') {
        return '\n\n' + sections.map((s) => `### Design directive\n${s}`).join('\n\n');
    }
    if (provider === 'nvidia') {
        return '\n\nAdditional design directives:\n' + sections.map((s, i) => `${i + 1}. ${s}`).join('\n');
    }
    return '\n\n--- Design directives ---\n' + sections.join('\n\n');
};
