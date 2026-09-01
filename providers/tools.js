// Tool definitions in plain JSON Schema, declared once and translated per provider.
// Written to the strict intersection dialect every provider accepts: every property
// listed in `required`, `additionalProperties: false`, no length/range keywords.

const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

export const NPM_SEARCH_TOOL = {
    name: 'searchNpm',
    description: 'Search for packages on the npm registry.',
    parameters: obj({ packageName: str('The name of the package to search for.') }, ['packageName']),
};

export const RUN_PYTHON_TOOL = {
    name: 'runPython',
    description: 'Execute Python code in a sandboxed environment. IMPORTANT: This tool is sandboxed and CANNOT access the local file system or network.',
    parameters: obj({ code: str('The Python code to execute.') }, ['code']),
};

export const FILE_SYSTEM_TOOLS = [
    { name: 'listFiles', description: 'List all files in the current project.', parameters: obj({}, []) },
    { name: 'createFile', description: 'Create a new file in the project.', parameters: obj({ path: str("The full path of the file to create (e.g., 'src/components/Button.tsx')."), content: str('The initial content of the file.') }, ['path', 'content']) },
    { name: 'readFile', description: "Read the content of a file.", parameters: obj({ path: str('The full path of the file to read.') }, ['path']) },
    { name: 'updateFile', description: 'Update the content of an existing file.', parameters: obj({ path: str('The full path of the file to update.'), newContent: str('The new content to write to the file.') }, ['path', 'newContent']) },
    { name: 'deleteFile', description: 'Delete a file.', parameters: obj({ path: str('The full path of the file to delete.') }, ['path']) },
];

/** The tool set for a coding turn: file tools only appear when a project is selected. */
export const toolsForRequest = (hasProjects) =>
    hasProjects ? [NPM_SEARCH_TOOL, RUN_PYTHON_TOOL, ...FILE_SYSTEM_TOOLS] : [NPM_SEARCH_TOOL, RUN_PYTHON_TOOL];
