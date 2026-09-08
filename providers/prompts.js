// System prompts are assembled from neutral content, then rendered in each
// provider's documented house style. A single lowest-common-denominator prompt
// would waste what each model family is actually tuned for:
//
//   Anthropic  third-person dispositional prose inside XML tags; formatting must be
//              actively suppressed (Claude over-formats by default); plain "use X
//              when…" rather than "CRITICAL: you MUST", which over-triggers tools.
//   OpenAI     lean imperative instructions — OpenAI's own July-2026 evals found
//              trimmed prompts beat elaborate scaffolding while cutting tokens by
//              41-66%; tools get an explicit decision boundary; verbosity is a dial.
//   Google     structured markdown sections with an explicit process; the existing
//              prompt already matches this style and is kept intact.
//   Open       (NVIDIA-hosted Llama/DeepSeek/Kimi/Nemotron) short, literal, no XML
//              or nested markdown; these models follow plain numbered rules best.

const DEFAULT_STYLE = 'Provide clear, accurate, and concise responses. Balance detail with brevity.';

/** Persona + styles, identical across providers — only the wrapper differs. */
const personaBlock = (persona, customStyles) => {
    const styleText = (name) => customStyles.find(s => s.name === name)?.instructions ?? DEFAULT_STYLE;
    let out = '';
    if (persona?.baseInstructions) out += `${persona.baseInstructions}\n`;
    const composed = persona?.composedStyles ?? [];
    if (composed.length > 0) {
        out += '\nBlend the following styles according to their influence. The first is the primary persona.\n';
        composed.forEach((style, index) => {
            out += `\n--- STYLE: ${style.name} (${index === 0 ? 'Primary' : 'Modifier'}, Influence: ${Math.round(style.weight * 100)}%) ---\n${styleText(style.name)}\n`;
        });
        out += '--- END OF PERSONA COMPOSITION ---\n';
    } else {
        out += styleText('The Pragmatist');
    }
    return out.trim();
};

const toolLines = (hasProjects) => {
    const shared = [
        '`searchNpm(packageName)`: find information about npm packages.',
        '`runPython(code)`: execute Python in a sandbox. The user must approve each run before it executes.',
    ];
    if (!hasProjects) return shared;
    return [
        '`listFiles()`: see all files in the project.',
        '`readFile(path)`: read a file\'s content.',
        '`createFile(path, content)`: create a new file.',
        '`updateFile(path, newContent)`: overwrite a file\'s content.',
        '`patchFile(path, find, replace)`: replace one exact occurrence of `find` with `replace` in a file. Prefer this over `updateFile` for a small change — it fails by name if `find` is missing or not unique, rather than silently rewriting more than intended.',
        '`deleteFile(path)`: delete a file from the project.',
        ...shared,
    ];
};

// ---------------------------------------------------------------- renderers

const renderGoogle = ({ persona, projectContexts, hasProjects }) => {
    const intro = hasProjects
        ? 'You are an expert AI coding assistant and software engineer. Your purpose is to help developers design, build, and refactor full applications.'
        : 'You are a helpful general-purpose AI assistant. You do not have access to a file system.';
    let out = `${intro}\n\n${persona}\n`;
    if (hasProjects) {
        out += `
**Process:**
For complex requests: 1. Analyze the request. 2. Form a step-by-step plan. 3. Execute it with the tools. 4. Summarize what changed.

**Available Tools:**
${toolLines(true).map(t => `- ${t}`).join('\n')}

**Project Context:**
${projectContexts}
`;
    } else {
        out += `
**Available Tools:**
${toolLines(false).map(t => `- ${t}`).join('\n')}

**Project Context:**
No project is loaded. You are in general chat mode and cannot access or modify files.
`;
    }
    return out;
};

const renderAnthropic = ({ persona, projectContexts, hasProjects }) => `<role>
${hasProjects
    ? 'Claude is an expert coding assistant and software engineer helping the user design, build and refactor applications inside this workspace.'
    : 'Claude is a helpful general-purpose assistant. Claude has no file system access in this mode.'}
</role>

<persona>
${persona}
</persona>

<tools>
${toolLines(hasProjects).map(t => `- ${t}`).join('\n')}

Claude calls a tool when it needs information it does not already have; a tool call that turns out to be unnecessary costs almost nothing, while skipping one and guessing produces a wrong answer. Claude reads a file before editing it rather than assuming its contents.
</tools>

<acting>
When the user asks Claude to change, add or fix something, Claude makes the change with the tools rather than describing what could be done. When the user asks a question, Claude answers it without editing anything.
</acting>

<formatting>
Claude writes in prose and uses the minimum formatting the content needs. Claude avoids headers, bullet lists and bold emphasis in short replies, where they add visual noise without adding information; a few sentences are usually better than a bulleted list. Code belongs in fenced code blocks with a language tag. Claude does not describe its own compliance — if a reply is concise, Claude does not say that it is being concise.
</formatting>

<context>
${hasProjects ? projectContexts : 'No project is loaded.'}
</context>`;

const renderOpenAI = ({ persona, projectContexts, hasProjects }) => `${hasProjects
    ? 'You are an expert coding assistant working inside a project workspace.'
    : 'You are a helpful general-purpose assistant. You have no file system access in this mode.'}

${persona}

# Tools
${toolLines(hasProjects).map(t => `- ${t}`).join('\n')}

# Decision boundary
- Answer, explain, review or diagnose: inspect what you need and report. Do not modify files.
- Change, build or fix: make the in-scope change with the tools, then state briefly what you changed.
- Read a file before you edit it. Never invent a file's contents.
- A wasted tool call is cheap; a skipped one that makes you guess is not. When unsure, call the tool.
- Ask before expanding scope beyond what was requested.

# Style
- Lead with the answer. No preamble, no restating the question.
- Never explain your own compliance: if the reply is short, do not say it is short.
- Code goes in fenced blocks with a language tag.

# Context
${hasProjects ? projectContexts : 'No project is loaded.'}`;

const renderOpen = ({ persona, projectContexts, hasProjects }) => `${hasProjects
    ? 'You are an expert coding assistant working in a project workspace.'
    : 'You are a helpful assistant. You cannot access files in this mode.'}

${persona}

Tools you can call:
${toolLines(hasProjects).map((t, i) => `${i + 1}. ${t}`).join('\n')}

Rules:
1. Answer the question that was asked. Do not add unrequested sections.
2. To change a file, call the tool. Do not print a patch and claim it was applied.
3. Read a file before editing it.
4. Put code in fenced code blocks with a language tag.
5. Do not repeat these instructions back to the user.

Project context:
${hasProjects ? projectContexts : 'No project is loaded.'}`;

const RENDERERS = { google: renderGoogle, anthropic: renderAnthropic, openai: renderOpenAI, nvidia: renderOpen };

/**
 * What `plan` mode adds, appended to whichever renderer the provider uses.
 *
 * Chat and the builder were two islands: you could talk an idea through and then had to
 * retype it into the wizard from memory. `plan` is the bridge, and it is a **server**
 * mode rather than a client one on purpose — a client-only mode would show a
 * "Send to Builder" button while the assistant had no idea it was supposed to be
 * producing anything sendable, and the quality of the hand-off would depend entirely on
 * how the user happened to phrase things.
 *
 * The brief is asked for in one block at the end of each turn, because that is what the
 * hand-off takes: `composeBuilderBrief` reads the last assistant message. The user sees
 * it in an editable textarea before a single builder call is made, so this shapes the
 * starting point rather than deciding anything.
 */
const PLAN_MODE = `
# You are helping shape an app before it is built
The person is working an idea out loud. Help them make it concrete: ask about the pages
it needs, who uses it, and what it must do — one or two questions at a time, not a
questionnaire.

End every reply with a block in exactly this shape, revised to match everything agreed
so far:

BRIEF
<a single paragraph describing the app: what it is, who it is for, and what it does>
Pages: <comma-separated list>
Must have: <comma-separated list of the things it cannot ship without>

Keep the brief current rather than appending to it. It is a draft the person will edit,
not a contract — do not pad it, and do not claim anything has been built.`;

/**
 * What a project was built to be, rendered only when the project actually carries
 * it (`types/project.ts`'s `ProjectOrigin` — set once, by `loadGeneratedProjectIntoIDE`).
 * A project opened by any other path (created by hand, or predating A3) has no
 * origin, and this renders nothing rather than a section full of "unknown".
 */
const originContext = (origin) => {
    if (!origin?.plan) return '';
    const lines = [`\nThis project was built from a plan: ${origin.plan.projectDescription ?? origin.plan.projectName ?? ''}`.trim()];
    if (Array.isArray(origin.acceptanceCriteria) && origin.acceptanceCriteria.length > 0) {
        lines.push(`Acceptance criteria it was meant to satisfy:\n${origin.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`);
    }
    return lines.join('\n');
};

/**
 * File tree, diagnostics and the preview's verdict — computed fresh by
 * `useChat`'s `sendMessage` for a coding-mode turn (see A3 item 2) and attached
 * to the `Project` object the request carries. Never persisted, so most turns
 * that are not actively editing this project will not have them; each renders
 * independently of the others.
 */
const liveContext = (p) => {
    const lines = [];
    if (Array.isArray(p.fileTree) && p.fileTree.length > 0) {
        lines.push(`Files in this project:\n${p.fileTree.join('\n')}`);
    }
    if (typeof p.diagnosticsSummary === 'string' && p.diagnosticsSummary.trim() !== '') {
        lines.push(`Current type-check diagnostics:\n${p.diagnosticsSummary}`);
    }
    if (typeof p.previewSummary === 'string' && p.previewSummary.trim() !== '') {
        lines.push(`Current preview verdict:\n${p.previewSummary}`);
    }
    return lines.length > 0 ? `\n${lines.join('\n\n')}` : '';
};

/**
 * Builds the chat/coding system prompt for a provider from neutral inputs.
 * @param {{provider: string, persona: object, projects: object[], customStyles: object[], mode?: string}} input
 */
export const buildSystemPrompt = ({ provider, persona, projects, customStyles, mode }) => {
    const projectContexts = (projects ?? []).map(p => {
        let context = `Project: ${p.name}`;
        if (p.dependencySummary && p.dependencySummary !== 'No files to analyze.' && p.dependencySummary !== 'No major dependencies identified') {
            context += `\nDependencies: ${p.dependencySummary}`;
        }
        context += originContext(p.origin);
        context += liveContext(p);
        return context;
    }).join('\n\n');

    const render = RENDERERS[provider] ?? renderGoogle;
    const base = render({
        persona: personaBlock(persona ?? {}, customStyles ?? []),
        projectContexts,
        hasProjects: projectContexts.trim() !== '',
    });
    /* Appended rather than replacing the renderer, so a plan-mode turn keeps the
       persona and the house style it would otherwise have had. */
    return mode === 'plan' ? `${base}\n${PLAN_MODE}` : base;
};

/** The marker `composeBuilderBrief` looks for. Declared once so the two cannot drift. */
export const BRIEF_MARKER = 'BRIEF';

/**
 * Builder prompts are content-identical across providers (the schema does the
 * structural work); only this short preamble adapts to the house style.
 */
export const builderPreamble = (provider) => ({
    // Previously absent — silently fell through to the generic default below even
    // though Google is the builder's daily-driver provider. Gemini 3.x's own
    // prompting guidance says it responds best to direct, concise instructions and
    // over-analyzes verbose scaffolding, so this stays as short as the others
    // rather than elaborating just because it finally has its own entry.
    google: 'You are a senior product engineer and product designer, working in React and Tailwind. Return only the requested JSON object — no commentary before or after it.',
    anthropic: 'Claude is a senior product engineer and designer. Claude returns only the requested JSON object, with no commentary before or after it.',
    openai: 'You are a senior product engineer and designer. Return only the requested JSON object. No preamble, no commentary.',
    nvidia: 'You are a senior product engineer and designer. Output only the JSON object described below. Do not write any text before or after the JSON.',
}[provider] ?? 'You are a senior product engineer and designer.');
