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

// A Record<path, content> map cannot be expressed in a strict schema (arbitrary keys),
// so generation returns an array and the server converts it back to the map the
// client protocol already expects.
export const GENERATE_SCHEMA = obj({
    files: arr(obj({
        path: str("Full file path relative to the project root, e.g. 'src/App.tsx'."),
        content: str('The complete file contents.'),
    }), 'Every file of the generated project.'),
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
