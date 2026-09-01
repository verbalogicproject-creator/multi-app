import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

const upload = multer({ storage: multer.memoryStorage() });

// Initialize Google GenAI
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set.");
}
const ai = new GoogleGenAI({ apiKey });

// Model registry — env-overridable so future model retirements are a config change.
// Free-tier note: gemini-3.7-flash allows only ~20 requests/day, so it is reserved
// for the builder's few heavy codegen calls; chat/coding run on gemini-3.5-flash.
const MODELS = {
    chat: process.env.MODEL_CHAT || 'gemini-3.5-flash',
    coding: process.env.MODEL_CODING || 'gemini-3.5-flash',
    builder: process.env.MODEL_BUILDER || 'gemini-3.7-flash',
    image: process.env.MODEL_IMAGE || 'gemini-3.1-flash-image',
    video: process.env.MODEL_VIDEO || 'veo-3.1-generate-preview',
};

// Models the UI may request per-call; anything else falls back to the defaults above.
const SELECTABLE_MODELS = new Set([
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.7-flash',
    'gemini-3.1-pro-preview',
]);
const pickModel = (requested, fallback) => SELECTABLE_MODELS.has(requested) ? requested : fallback;


// =========================================================================================
// Backend Logic for Coding Assistant (moved from frontend)
// =========================================================================================
const npmSearchTool = { name: 'searchNpm', parameters: { type: Type.OBJECT, description: "Search for packages on the npm registry.", properties: { packageName: { type: Type.STRING, description: "The name of the package to search for." } }, required: ['packageName'] } };
const runPythonTool = { name: 'runPython', parameters: { type: Type.OBJECT, description: "Execute Python code in a sandboxed environment. IMPORTANT: This tool is sandboxed and CANNOT access the local file system or network.", properties: { code: { type: Type.STRING, description: "The Python code to execute." } }, required: ['code'] } };
const fileSystemTools = [
    { name: 'listFiles', parameters: { type: Type.OBJECT, description: "List all files in the current project.", properties: {}, required: [] } },
    { name: 'createFile', parameters: { type: Type.OBJECT, description: "Create a new file in the project.", properties: { path: { type: Type.STRING, description: "The full path of the file to create (e.g., 'src/components/Button.tsx')." }, content: { type: Type.STRING, description: "The initial content of the file." } }, required: ['path', 'content'] } },
    { name: 'readFile', parameters: { type: Type.OBJECT, description: "Read the content of a file.", properties: { path: { type: Type.STRING, description: "The full path of the file to read." } }, required: ['path'] } },
    { name: 'updateFile', parameters: { type: Type.OBJECT, description: "Update the content of an existing file.", properties: { path: { type: Type.STRING, description: "The full path of the file to update." }, newContent: { type: Type.STRING, description: "The new content to write to the file." } }, required: ['path', 'newContent'] } },
    { name: 'deleteFile', parameters: { type: Type.OBJECT, description: "Delete a file.", properties: { path: { type: Type.STRING, description: "The full path of the file to delete." } }, required: ['path'] } }
];

const planResponseSchema = {
    type: Type.OBJECT,
    properties: {
        projectName: { type: Type.STRING, description: "A short, catchy name for the project based on the idea" },
        projectDescription: { type: Type.STRING, description: "A one-sentence description of the web app." },
        pages: {
            type: Type.ARRAY,
            description: "A list of pages for the web application.",
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "The component name for the page, e.g., HomePage" },
                    path: { type: Type.STRING, description: "The URL path for the page, e.g., /" },
                    description: { type: Type.STRING, description: "A brief description of the page's purpose." }
                },
                required: ['name', 'path', 'description']
            }
        },
        components: {
            type: Type.ARRAY,
            description: "A list of shared UI components to be created.",
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "The component name, e.g., Navbar" },
                    description: { type: Type.STRING, description: "A brief description of the component's purpose." }
                },
                required: ['name', 'description']
            }
        },
        acceptanceCriteria: {
            type: Type.ARRAY,
            description: "3-6 concrete, checkable statements describing what the finished app must do for it to be considered complete.",
            items: { type: Type.STRING }
        }
    },
    required: ['projectName', 'projectDescription', 'pages', 'components', 'acceptanceCriteria']
};


const geminiService = {
    getSystemInstruction: (persona, projectContexts, customStyles) => {
        const hasProjectContext = projectContexts && projectContexts.trim() !== "";

        const baseIntro = hasProjectContext
            ? `You are an expert AI coding assistant and software engineer. Your purpose is to help developers design, build, and refactor full applications.`
            : `You are a helpful general-purpose AI assistant. You do not have access to a file system.`;

         const getDefaultStyleInstructions = (styleName) => {
            const style = customStyles.find(s => s.name === styleName);
            return style ? style.instructions : `Provide clear, accurate, and concise responses. Balance detail with brevity.`;
        }

        let personaInstruction = '';
        if (persona.baseInstructions) {
            personaInstruction += `\n**Core Directives:**\n${persona.baseInstructions}\n`;
        }
        if (persona.composedStyles.length > 0) {
            personaInstruction += "\n**Persona Composition:**\nYou must blend the following styles according to their specified influence. The first style is your primary persona.\n";
            persona.composedStyles.forEach((style, index) => {
                const isPrimary = index === 0;
                const instructions = getDefaultStyleInstructions(style.name);
                const influence = Math.round(style.weight * 100);
                personaInstruction += `\n--- STYLE: ${style.name} (${isPrimary ? 'Primary' : 'Modifier'}, Influence: ${influence}%) ---\n${instructions}\n`;
            });
            personaInstruction += "--- END OF PERSONA COMPOSITION ---\n";
        } else {
            personaInstruction += getDefaultStyleInstructions('The Pragmatist');
        }
        
        let instruction = `${baseIntro}\n${personaInstruction}`;
        if (hasProjectContext) {
            instruction += `
**Chain of Thought Process:**
For complex requests, you MUST follow these steps: 1. Analyze Request, 2. Formulate a detailed, step-by-step plan. 3. Execute the plan using the available tools. 4. Conclude and summarize the work done.

**Available Tools:**
- \`listFiles()\`: See all files in the project.
- \`createFile(path, content)\`: Create a new file.
- \`readFile(path)\`: Read a file's content.
- \`updateFile(path, newContent)\`: Overwrite a file's content.
- \`deleteFile(path)\`: Delete a file from the project.
- \`searchNpm(packageName)\`: Find information about NPM packages.
- \`runPython(code)\`: Execute Python code in a sandbox.
- \`googleSearch\`: Use for recent events or up-to-date information.

**Project Context:**
Use the following project context to provide relevant responses.
${projectContexts}
`;
        } else {
            instruction += `
**Available Tools:**
- \`searchNpm(packageName)\`: Find information about NPM packages.
- \`runPython(code)\`: Execute Python code in a sandbox.
- \`googleSearch\`: Use for recent events or up-to-date information.

**Project Context:**
No project is loaded. You are in a general chat mode and cannot access or modify files.
`;
        }
        return instruction;
    },
    npmSearch: async (packageName) => {
         try {
            const response = await fetch(`https://registry.npmjs.org/-/v1/search?text=${packageName}&size=5`);
            if (!response.ok) throw new Error(`NPM search failed with status: ${response.status}`);
            const data = await response.json();
            return data.objects.map((o) => ({ name: o.package.name, version: o.package.version, description: o.package.description }));
        } catch (error) {
            return { error: error.message };
        }
    },
    runPythonScript: (code) => {
        // NOTE: A true sandboxed environment (like a separate container or VM) is recommended for production.
        // For this example, we'll return a placeholder acknowledging the request.
        return { stdout: `Python execution is simulated on the server. Code to run:\n${code}`, stderr: "", result: "Simulation complete." };
    },
    generateCodingContentStream: async function(history, projects, persona, useWebSearch, customStyles, lowLatencyMode, model) {
        const projectContexts = (projects || []).map(p => {
            let context = `Project: ${p.name}`;
            if (p.dependencySummary && p.dependencySummary !== 'No files to analyze.' && p.dependencySummary !== 'No major dependencies identified') {
                context += `\nDependencies: ${p.dependencySummary}`;
            }
            return context;
        }).join('\n\n');

        const systemInstruction = this.getSystemInstruction(persona, projectContexts, customStyles);
        
        const contents = history.map(msg => {
            const role = msg.author === 'assistant' ? 'model' : 'user';
            let parts = [];
            if (msg.author === 'assistant') {
                const textPart = msg.parts.find(p => p.text);
                if(textPart?.text) parts.push({ text: textPart.text });
                if (msg.toolCall) parts.push({ functionCall: msg.toolCall });
            } else if (msg.author === 'tool') {
                 if (msg.toolResponse) parts.push({ functionResponse: { name: msg.toolResponse.name, response: { content: msg.toolResponse.response.content } } });
            } else {
                parts = msg.parts.map(p => ({ text: p.text || '' }));
            }
            return { role, parts };
        }).filter(c => c.parts.length > 0 && !(c.role === 'model' && c.parts.length === 1 && c.parts[0].text === ''));

        const config = { systemInstruction };
        if (useWebSearch) {
            config.tools = [{ googleSearch: {} }];
        } else {
            const functionDeclarations = [npmSearchTool, runPythonTool];
            if (projects && projects.length > 0) {
                functionDeclarations.push(...fileSystemTools);
            }
            config.tools = [{ functionDeclarations }];
        }

        if (lowLatencyMode) {
            config.thinkingConfig = { thinkingBudget: 0 };
        }
        
        // The last message is the user's current prompt; the rest is prior history,
        // which must be passed at creation time (assigning chat.history later is a no-op).
        const lastMessage = contents.pop();
        const chat = ai.chats.create({ model: pickModel(model, MODELS.coding), config, history: contents });

        const result = await chat.sendMessageStream({ message: lastMessage.parts });
        return result;
    },
};


// =========================================================================================
// API Routes
// =========================================================================================

// Simple Chat Streaming
app.post('/api/chat-stream', async (req, res) => {
    try {
        const { prompt, model } = req.body;
        if (!prompt) {
            return res.status(400).json({ message: 'Prompt is required.' });
        }

        const chat = ai.chats.create({ model: pickModel(model, MODELS.chat) });
        const result = await chat.sendMessageStream({ message: prompt });
        
        res.setHeader('Content-Type', 'text/plain');
        for await (const chunk of result) {
            res.write(chunk.text);
        }
        res.end();
    } catch (error) {
        console.error('Chat stream error:', error);
        res.status(500).json({ message: 'Error processing chat stream.' });
    }
});

// Image Editing
app.post('/api/edit-image', upload.single('file'), async (req, res) => {
    try {
        const { prompt } = req.body;
        const file = req.file;

        if (!prompt || !file) {
            return res.status(400).json({ message: 'Prompt and file are required.' });
        }
        
        const response = await ai.models.generateContent({
            model: MODELS.image,
            contents: { parts: [{ inlineData: { data: file.buffer.toString('base64'), mimeType: file.mimetype } }, { text: prompt }] },
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        });

        const responseParts = [];
        if (response.candidates?.length) {
            for (const part of response.candidates[0].content.parts) {
                if (part.text) responseParts.push({ text: part.text });
                else if (part.inlineData) responseParts.push({ imageUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` });
            }
        }
        res.json(responseParts);

    } catch (error) {
        console.error('Image edit error:', error);
        res.status(500).json({ message: 'Error editing image.' });
    }
});


// Video Generation - Step 1: Start Generation
app.post('/api/generate-video', upload.single('file'), async (req, res) => {
    try {
        const { prompt } = req.body;
        const file = req.file;

        if (!prompt) {
            return res.status(400).json({ message: 'Prompt is required.' });
        }
        
        const imagePayload = file ? { imageBytes: file.buffer.toString('base64'), mimeType: file.mimetype } : undefined;

        const operation = await ai.models.generateVideos({
            model: MODELS.video,
            prompt: prompt,
            ...(imagePayload && { image: imagePayload }),
            config: { numberOfVideos: 1 }
        });
        
        res.json({ operationName: operation.name });

    } catch (error) {
        console.error('Video generation error:', error);
        res.status(500).json({ message: 'Error starting video generation.' });
    }
});

// Video Generation - Step 2: Poll Status
app.get('/api/video-status', async (req, res) => {
    try {
        const { operationName } = req.query;
        if (!operationName) {
             return res.status(400).json({ message: 'Operation name is required.' });
        }
        
        let operation = { name: String(operationName), done: false };
        operation = await ai.operations.getVideosOperation({ operation });

        if (operation.done) {
             const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
             if (!downloadLink) {
                return res.json({ done: true, error: "Video generation succeeded but no download link was found." });
             }
             // Instead of sending the link, we fetch the video and send it as a blob URL
             const sep = downloadLink.includes('?') ? '&' : '?';
             const videoResponse = await fetch(`${downloadLink}${sep}key=${apiKey}`);
             if (!videoResponse.ok) throw new Error(`Failed to download video: ${videoResponse.statusText}`);
             const videoBlob = await videoResponse.blob();
             const buffer = Buffer.from(await videoBlob.arrayBuffer());
             const dataUrl = `data:${videoBlob.type};base64,${buffer.toString('base64')}`;

             res.json({ done: true, videoUrl: dataUrl });
        } else {
            res.json({ done: false });
        }

    } catch (error) {
        console.error('Video status check error:', error);
        res.status(500).json({ message: 'Error checking video status.' });
    }
});

// Coding Assistant Streaming
app.post('/api/coding-chat-stream', async (req, res) => {
     try {
        const { history, projects, persona, useWebSearch, customStyles, lowLatencyMode, model } = req.body;

        const resultIterator = await geminiService.generateCodingContentStream(history, projects, persona, useWebSearch, customStyles, lowLatencyMode, model);

        res.setHeader('Content-Type', 'application/x-ndjson');
        
        for await (const chunk of resultIterator) {
            // chunk.text / chunk.functionCalls are getters on the SDK response class;
            // serialize the fields the client consumes explicitly or they are lost.
            const payload = {
                text: chunk.text ?? undefined,
                functionCalls: chunk.functionCalls ?? undefined,
                groundingMetadata: chunk.candidates?.[0]?.groundingMetadata ?? undefined,
            };
            res.write(JSON.stringify(payload) + '\n');
        }
        res.end();

    } catch (error) {
        console.error('Coding chat stream error:', error);
        res.status(500).json({ message: 'Error processing coding chat stream.' });
    }
});

app.get('/api/npm-search', async (req, res) => {
    try {
        const { packageName } = req.query;
        if (!packageName) {
            return res.status(400).json({ message: 'Package name is required.' });
        }
        const result = await geminiService.npmSearch(packageName);
        res.json(result);
    } catch (error) {
        console.error('NPM search proxy error:', error);
        res.status(500).json({ message: 'Error proxying NPM search.' });
    }
});


// Dependency Analysis
app.post('/api/analyze-dependencies', async (req, res) => {
    try {
        const { files } = req.body;
        if (!files || files.length === 0) {
            return res.json({ summary: 'No files to analyze.' });
        }
        const fileContents = files.map((f) => f.content).join('\n\n');
        const prompt = `Analyze the following code and provide a brief summary of the main dependencies, libraries, and frameworks used. List only the names, separated by commas. For example: "React, TailwindCSS, Express.js". If there are no clear dependencies, say "No major dependencies identified".\n\n${fileContents}`;
        const response = await ai.models.generateContent({ model: MODELS.coding, contents: prompt });
        res.json({ summary: response.text.trim() });
    } catch (error) {
        console.error('Dependency analysis error:', error);
        res.status(500).json({ message: 'Error analyzing dependencies.' });
    }
});

// Transient-failure resilience: retry with backoff on 429/503, then fall back to the
// next model in the list. Used by the builder endpoints (3.7-flash spikes under demand).
const TRANSIENT_STATUSES = new Set([429, 503]);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function withModelFallback(models, attempt) {
    let lastError;
    for (const model of models) {
        for (let tryNo = 0; tryNo < 2; tryNo++) {
            try {
                return await attempt(model);
            } catch (error) {
                lastError = error;
                if (!TRANSIENT_STATUSES.has(error?.status)) throw error;
                console.warn(`Transient ${error.status} from ${model} (attempt ${tryNo + 1}), backing off...`);
                await sleep(2000 * (tryNo + 1));
            }
        }
    }
    throw lastError;
}
const builderModelChain = (requested) => {
    const primary = pickModel(requested, MODELS.builder);
    return [...new Set([primary, MODELS.coding])];
};
const friendlyProviderError = (error, fallbackMessage) =>
    TRANSIENT_STATUSES.has(error?.status)
        ? `The model is temporarily overloaded (HTTP ${error.status}). Please try again in a minute.`
        : fallbackMessage;

// Web App Builder - Step 1: Plan
app.post('/api/builder/plan', async (req, res) => {
    try {
        const { idea, model: requestedModel, previousPlan, feedback } = req.body;
        const isRefinement = previousPlan && typeof feedback === 'string' && feedback.trim() !== '';

        const prompt = isRefinement
            ? `You are a senior web architect revising an existing project plan.

Original idea: "${idea}"

Current plan:
${JSON.stringify(previousPlan, null, 2)}

The user asks for these changes:
"${feedback.trim()}"

Apply the requested changes to the plan. Keep everything the feedback does not touch exactly as it is — same project name, same page names, paths, descriptions, components and acceptance criteria — so the user can see precisely what changed. Add, remove or reword only what the feedback calls for, and keep the plan coherent (for example, if a page is removed, remove components only used by it).`
            : `You are a senior web architect. A user wants to build a web application.
User's Idea: "${idea}"

Analyze the user's idea and create a logical project plan for a standard React (Vite) + TailwindCSS application. The plan should include a project name, description, a list of pages, a list of reusable components, and acceptance criteria that state what the finished app must do.`;

        const response = await withModelFallback(builderModelChain(requestedModel), (model) => ai.models.generateContent({
            model,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: planResponseSchema
            }
        }));

        res.setHeader('Content-Type', 'application/json');
        res.send(response.text);

    } catch (error) {
        console.error('Builder plan error:', error);
        res.status(500).json({ message: friendlyProviderError(error, 'Error generating project plan.') });
    }
});

// Web App Builder - Art directions: three distinct visual proposals for the theme step
const TYPOGRAPHY_NAMES = ['Sans-serif & Friendly', 'Serif & Professional', 'Mono & Techy', 'Grotesk & Bold', 'Editorial Serif'];

const hexProp = (role) => ({ type: Type.STRING, description: `Hex color for the ${role} role, e.g. #1f2937` });
const directionsResponseSchema = {
    type: Type.OBJECT,
    properties: {
        directions: {
            type: Type.ARRAY,
            description: "Exactly three genuinely different art directions.",
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "Two or three word name for the direction, e.g. 'Quiet Archive'." },
                    rationale: { type: Type.STRING, description: "One or two sentences on why this direction suits the product and who it speaks to." },
                    typography: { type: Type.STRING, description: `Exactly one of: ${TYPOGRAPHY_NAMES.join(' | ')}` },
                    colors: {
                        type: Type.OBJECT,
                        properties: {
                            bg: hexProp('page background'),
                            surface: hexProp('cards and nav surface'),
                            text: hexProp('primary text'),
                            muted: hexProp('secondary text'),
                            primary: hexProp('primary action'),
                            accent: hexProp('accent'),
                        },
                        required: ['bg', 'surface', 'text', 'muted', 'primary', 'accent'],
                    },
                },
                required: ['name', 'rationale', 'typography', 'colors'],
            },
        },
    },
    required: ['directions'],
};

app.post('/api/builder/directions', async (req, res) => {
    try {
        const { idea, plan, model: requestedModel } = req.body;
        const prompt = `You are an art director proposing visual directions for a web product.

Product idea: "${idea ?? ''}"
${plan ? `Plan:\n${JSON.stringify({ projectName: plan.projectName, projectDescription: plan.projectDescription, pages: (plan.pages || []).map(p => p.name) }, null, 2)}` : ''}

Propose exactly three art directions that are genuinely different from one another — not three variations of the same hue. Each should take a defensible position on mood and audience (for example: restrained and editorial; warm and human; high-contrast and technical). At least one should be light and at least one dark.

For each direction give hex values for all six roles. Requirements:
- Primary text on the page background must be clearly readable (strong contrast), and so must text on surfaces.
- The primary action colour must stand out against both background and surface.
- The accent must differ from the primary in hue, not just lightness.
- Typography must be exactly one of: ${TYPOGRAPHY_NAMES.join(' | ')}.`;

        const response = await withModelFallback(builderModelChain(requestedModel), (model) => ai.models.generateContent({
            model,
            contents: prompt,
            config: { responseMimeType: 'application/json', responseSchema: directionsResponseSchema },
        }));

        res.setHeader('Content-Type', 'application/json');
        res.send(response.text);
    } catch (error) {
        console.error('Builder directions error:', error);
        res.status(500).json({ message: friendlyProviderError(error, 'Error suggesting art directions.') });
    }
});

// Web App Builder - Step 2: Generate (streams NDJSON progress, then the final files object)
const BUILDER_THEME_TOKENS = {
    'Modern & Minimal': 'Background slate-50/slate-100, surfaces white, text slate-800/slate-500, primary blue-600 (hover blue-700), borders slate-200, generous whitespace, subtle shadow-sm only.',
    'Vibrant & Playful': 'Background amber-50, surfaces white with rounded-2xl, text gray-800, primary pink-500 (hover pink-600), accents violet-500 and teal-400 used sparingly, playful rounded shapes, shadow-md.',
    'Corporate & Clean': 'Background white, section alternation with gray-50, text gray-700/gray-500, primary indigo-700 (hover indigo-800), borders gray-200, dense and precise spacing, shadow-sm.',
    'Dark & Elegant': 'Background gray-950, surfaces gray-900 with border gray-800, text gray-200/gray-400, primary teal-500 (hover teal-400), no pure black or pure white, subtle ring-1 ring-gray-800 on cards.',
};
const BUILDER_TYPE_TOKENS = {
    'Sans-serif & Friendly': 'font-sans; headings font-semibold tracking-tight; body leading-relaxed.',
    'Serif & Professional': 'font-serif headings with font-sans body; headings font-medium; formal editorial feel.',
    'Mono & Techy': 'font-mono for headings, labels and data; font-sans for long body text; uppercase tracking-wide micro-labels.',
    'Grotesk & Bold': 'font-sans throughout; headings font-extrabold uppercase tracking-tighter at large sizes; body text-base leading-relaxed for contrast.',
    'Editorial Serif': 'font-serif for both headings and body; generous leading-loose body; long-form editorial rhythm with wide margins.',
};

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const COLOR_ROLES = ['bg', 'surface', 'text', 'muted', 'primary', 'accent'];
/** Accepts token colors only when every role is a valid hex value. */
const readThemeColors = (colors) => {
    if (!colors || typeof colors !== 'object') return null;
    const clean = {};
    for (const role of COLOR_ROLES) {
        const value = colors[role];
        if (typeof value !== 'string' || !HEX_RE.test(value.trim())) return null;
        clean[role] = value.trim();
    }
    return clean;
};

const describePalette = (theme) => {
    const colors = readThemeColors(theme?.colors);
    if (!colors) return BUILDER_THEME_TOKENS[theme?.palette] || BUILDER_THEME_TOKENS['Modern & Minimal'];
    return `Use these EXACT hex tokens and no substitutes — page background ${colors.bg}, surfaces/cards/nav ${colors.surface}, primary text ${colors.text}, secondary text ${colors.muted}, primary action ${colors.primary}, accent ${colors.accent}. Declare them once as CSS custom properties in src/index.css (--color-bg, --color-surface, --color-text, --color-muted, --color-primary, --color-accent), reference them through Tailwind arbitrary values (e.g. bg-[var(--color-primary)]), derive hover states by darkening the primary, and keep text contrast readable on every surface.`;
};

app.post('/api/builder/generate', async (req, res) => {
    try {
        const { plan, theme, model: requestedModel } = req.body;
        const paletteSpec = describePalette(theme);
        const typeSpec = BUILDER_TYPE_TOKENS[theme?.typography] || BUILDER_TYPE_TOKENS['Sans-serif & Friendly'];
        const prompt = `You are a senior product engineer and designer. Generate the complete, production-quality code for a web application from the plan and theme below. The result must look like a designed product, not a template.

**Project Plan:**
${JSON.stringify(plan, null, 2)}
${Array.isArray(plan?.acceptanceCriteria) && plan.acceptanceCriteria.length > 0
    ? `\n**Acceptance criteria — the generated app MUST satisfy every one of these:**\n${plan.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`
    : ''}
**Design contract (mandatory):**
- Palette: ${paletteSpec}
- Typography: ${typeSpec}
- Type scale: one hero-size heading per page (text-4xl/5xl), section headings text-2xl, body text-base, captions text-sm. Never more than three sizes on one screen.
- Spacing rhythm: sections py-16 to py-24, cards p-6, consistent gap-4/gap-6 grids. Align everything to one max-w-6xl mx-auto px-4 container.
- Components must have hover and focus-visible states, and disabled states where relevant.
- Realistic, domain-specific content everywhere: real-sounding names, numbers, dates and copy that fit the project's purpose. NEVER use "Lorem ipsum", "TODO", "placeholder", or empty stub components.
- No external images. Where an image would go, use a styled div with a gradient or an inline SVG.

**Stack rules:**
1. Vite + React 18 + TypeScript, standard layout: index.html, src/main.tsx, src/App.tsx, src/index.css, src/pages/*, src/components/*.
2. Routing with react-router-dom v6 (Routes in src/App.tsx, shared layout with nav + footer).
3. Styling with Tailwind CSS v4: src/index.css starts with '@import "tailwindcss";' and vite.config.ts uses the @tailwindcss/vite plugin. Do NOT emit tailwind.config.js or postcss.config.js.
4. package.json with correct dependencies and pinned major versions (react ^18, react-router-dom ^6, tailwindcss ^4, @tailwindcss/vite ^4, vite ^5, @vitejs/plugin-react ^4, typescript ^5) and scripts: "dev": "vite", "build": "vite build", "typecheck": "tsc --noEmit", "preview": "vite preview".
5. tsconfig.json compilerOptions must be exactly: { "target": "ES2020", "lib": ["ES2020", "DOM", "DOM.Iterable"], "module": "ESNext", "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true, "esModuleInterop": true, "skipLibCheck": true, "noEmit": true } with "include": ["src"].
6. Code must compile under strict TypeScript: every function parameter, callback parameter and prop is explicitly typed — no implicit any. With jsx react-jsx, do not import React just for JSX; import only the hooks you use.
7. Every file must be complete and syntactically valid. State lives in React hooks; interactive features (forms, filters, toggles) must actually work with local state.

**Additionally generate "preview.html"**: a single fully self-contained static HTML snapshot of the app's home page for an instant visual preview. Inline ALL of its CSS in a <style> tag (hand-written CSS reproducing the theme — do not reference Tailwind or any external resource, no JavaScript). It must faithfully show the real layout, colors, typography and content.

**Response format:** a single JSON object whose keys are file paths and values are complete file contents as strings. No markdown, no commentary.`;

        res.setHeader('Content-Type', 'application/x-ndjson');

        // On a transient failure the whole attempt restarts (progress resets to 0
        // client-side, which is harmless — events are self-describing).
        // Inside a JSON string value quotes arrive escaped (\"), so a bare "path":
        // sequence only occurs at real object keys — safe to sniff file names from.
        const FILE_KEY_RE = /"([^"\\]{1,120}\.(?:tsx|ts|css|html|json|js|svg|md))"\s*:/g;
        const accumulated = await withModelFallback(builderModelChain(requestedModel), async (model) => {
            res.write(JSON.stringify({ phase: 'thinking', model }) + '\n');
            const stream = await ai.models.generateContentStream({
                model,
                contents: prompt,
                config: { responseMimeType: 'application/json', maxOutputTokens: 65536 },
            });
            let acc = '';
            const seenFiles = new Set();
            for await (const chunk of stream) {
                if (chunk.text) {
                    if (acc === '') res.write(JSON.stringify({ phase: 'writing', model }) + '\n');
                    acc += chunk.text;
                    FILE_KEY_RE.lastIndex = 0;
                    let match;
                    while ((match = FILE_KEY_RE.exec(acc)) !== null) {
                        if (!seenFiles.has(match[1])) {
                            seenFiles.add(match[1]);
                            res.write(JSON.stringify({ file: match[1] }) + '\n');
                        }
                    }
                    res.write(JSON.stringify({ progress: acc.length }) + '\n');
                }
            }
            return acc;
        });

        try {
            const files = JSON.parse(accumulated);
            res.write(JSON.stringify({ files }) + '\n');
        } catch (parseError) {
            console.error('Builder generate: model returned malformed JSON', parseError.message);
            res.write(JSON.stringify({ error: 'The model returned malformed JSON. Please try again.' }) + '\n');
        }
        res.end();

    } catch (error) {
        console.error('Builder generate error:', error);
        const message = friendlyProviderError(error, 'Error generating project code.');
        if (res.headersSent) {
            res.write(JSON.stringify({ error: message }) + '\n');
            res.end();
        } else {
            res.status(500).json({ message });
        }
    }
});


// Health check
app.get('/healthz', (req, res) => {
    res.json({ ok: true, models: MODELS });
});

// Fallback to serving index.html for any unhandled routes (for SPA routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});