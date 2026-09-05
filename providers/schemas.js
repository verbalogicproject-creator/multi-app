// Structured-output schemas, declared once in the strict intersection dialect that
// Gemini (responseJsonSchema), OpenAI (text.format strict) and Anthropic
// (output_config.format) all accept:
//   - every property listed in `required` (no optionals; model absence as nullable)
//   - `additionalProperties: false` on every object
//   - no minLength/maxLength/minimum/maximum/pattern (rejected in strict modes)

const obj = (properties, description) => ({
    type: 'object',
    description,
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
});
const str = (description) => ({ type: 'string', description });
const bool = (description) => ({ type: 'boolean', description });
const arr = (items, description) => ({ type: 'array', description, items });

export const PLAN_SCHEMA = obj({
    projectName: str('A short, catchy name for the project based on the idea.'),
    projectDescription: str('A one-sentence description of the web app.'),
    pages: arr(obj({
        name: str('The component name for the page, e.g., HomePage'),
        path: str('The URL path for the page, e.g., /'),
        description: str("A brief description of the page's purpose."),
    }), 'A list of pages for the web application.'),
    components: arr(obj({
        name: str('The component name, e.g., Navbar'),
        description: str("A brief description of the component's purpose."),
    }), 'A list of shared UI components to be created.'),
    acceptanceCriteria: arr(str('One concrete, checkable statement.'),
        '3-6 concrete, checkable statements describing what the finished app must do for it to be considered complete.'),
    /**
     * The shape every page and component must agree on, decided once instead of
     * guessed separately by each of them.
     *
     * Without this, a photo's `location` and `date` are invented independently by
     * whichever file needs them next, and by the fourth file three different guesses
     * exist for the same conceptual object — measured on a real build: six files,
     * six independent shapes for `PhotoItem`, `ServicePackage` and `ClientReview`,
     * ~50 type errors from disagreement alone. `scaffoldFor` writes this into
     * `src/types.ts` verbatim, so it is frozen before a single file is requested —
     * the same move that made the Router structural instead of remembered.
     */
    entities: arr(obj({
        name: str('The TypeScript interface name for this shared data shape, e.g. PhotoItem. PascalCase.'),
        fields: arr(obj({
            name: str('Field name, e.g. location'),
            type: str('The TypeScript type: string, number, boolean, or a union of string literals like "square" | "portrait" | "landscape".'),
        }), "Every field this shape has — every field any page or component will need from it. Omitting one here is the mistake this section exists to prevent."),
    }), 'The shared data shapes referenced by more than one page or component — a photo, a review, a booking. Leave empty for an app with no shared data model.'),
});

const COLOR_ROLES = {
    bg: str('Hex color for the page background, e.g. #1f2937'),
    surface: str('Hex color for cards and nav surfaces.'),
    text: str('Hex color for primary text.'),
    muted: str('Hex color for secondary text.'),
    primary: str('Hex color for the primary action.'),
    accent: str('Hex color for the accent.'),
};

export const DIRECTIONS_SCHEMA = obj({
    directions: arr(obj({
        name: str("Two or three word name for the direction, e.g. 'Quiet Archive'."),
        rationale: str('One or two sentences on why this direction suits the product and who it speaks to.'),
        typography: str('Exactly one of the allowed typography option names.'),
        colors: obj(COLOR_ROLES, 'The six colour role tokens.'),
    }), 'Exactly three genuinely different art directions.'),
});

/**
 * The manifest: what the project is made of, before any of it is written.
 *
 * Asking for this separately is what removes the output ceiling. A whole app in one
 * response reliably exceeds the budget — measured at ~54k output tokens against a
 * 65,536 cap, shared with thinking — but a list of paths and one-line purposes is a
 * couple of thousand tokens whatever the app's size, and each file afterwards is
 * bounded by the size of that one file.
 *
 * It also makes a build resumable: the manifest says what should exist, so what is
 * missing is a set difference rather than a guess.
 */
export const MANIFEST_SCHEMA = obj({
    files: arr(obj({
        path: str("Full file path relative to the project root, e.g. 'src/pages/HomePage.tsx'."),
        purpose: str('One line: what this file contains. No code.'),
        /* Measured, not anticipated: with `purpose` alone, sixteen files written by
           sixteen requests agreed on every path and still produced 28 type errors —
           `types/tide.ts` exported `CoastalStation` while `Header.tsx` imported
           `Station`, and `App.tsx` default-imported a named export. Paths were never
           the hard part. The contract is. */
        exports: arr(str("One export, e.g. 'default HomePage' or 'CoastalStation'."),
            'Every name this file exports. Prefix the default export with "default". Config and CSS files export nothing.'),
    }), 'Every file the project needs, including config, entry points, pages and components.'),
});

/** One file, written on its own. The unit that made the ceiling unreachable. */
export const FILE_SCHEMA = obj({
    path: str('The path this file was asked for, repeated back unchanged.'),
    content: str('The complete file contents.'),
});

// A Record<path, content> map cannot be expressed in a strict schema (arbitrary keys),
// so generation returns an array and the server converts it back to the map the
// client protocol already expects.
export const GENERATE_SCHEMA = obj({
    files: arr(obj({
        path: str("Full file path relative to the project root, e.g. 'src/App.tsx'."),
        content: str('The complete file contents.'),
    }), 'Every file of the generated project.'),
});

/**
 * The acceptance-criteria self-check.
 *
 * Not a gate — a model judging its own output is not an independent observer, so this
 * can never be the thing that decides whether a build passes. What it is: an honest
 * self-report, structured so the server can tell satisfied from unsatisfied without
 * parsing prose. See `server.js`'s `/api/builder/check-acceptance` and
 * `HARNESS.md` for why this is labelled rather than trusted.
 */
export const ACCEPTANCE_CHECK_SCHEMA = obj({
    results: arr(obj({
        criterion: str('The acceptance criterion being judged, repeated back unchanged.'),
        satisfied: bool('Whether the generated code actually satisfies this criterion.'),
        evidence: str('One sentence: what in the code makes this true or false. Name a file if relevant.'),
    }), 'One entry per acceptance criterion given, in the same order.'),
});

/**
 * `/api/builder/edit` — a natural-language change against an already-generated
 * project. Only the files that actually need to change, not the whole project:
 * the model is given every current file as context and asked to return the
 * ones it touched, the same "return only what changed" contract
 * `REFINE_SYSTEM_PROMPT` already uses for the coding chat's own refine path.
 */
export const EDIT_SCHEMA = obj({
    files: arr(obj({
        path: str("The path of a file that needs to change, matching an existing path exactly."),
        content: str('The complete new content of that file.'),
    }), 'Only the files that need to change. A file not listed here is left exactly as it was.'),
    summary: str('One or two sentences: what changed and why.'),
});

/** Converts the generated files array back into the { path: content } map the client expects. */
export const filesArrayToRecord = (files) => {
    const record = {};
    for (const file of Array.isArray(files) ? files : []) {
        if (file && typeof file.path === 'string' && typeof file.content === 'string') {
            record[file.path] = file.content;
        }
    }
    return record;
};
