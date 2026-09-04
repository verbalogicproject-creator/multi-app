import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
// The direct client remains only for the media features (image edit, video), which
// are Gemini-only and flagged off in the UI. Chat and builder calls go through providers/.
import { GoogleGenAI, Modality } from '@google/genai';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { providerForModel, usableModels, isModelUsable } from './providers/index.js';
import { getModel, modelChain, pickModel } from './providers/catalog.js';
import { toolsForRequest } from './providers/tools.js';
import { PLAN_SCHEMA, DIRECTIONS_SCHEMA, GENERATE_SCHEMA, filesArrayToRecord } from './providers/schemas.js';
import { buildSystemPrompt, builderPreamble } from './providers/prompts.js';
import { memoryRouter } from './memory/routes.js';
import * as memory from './memory/bridge.js';
import typecheckRouter from './typecheck/routes.js';
import previewRouter from './preview/routes.js';
import { clean as cleanTypecheckScratch, killAll as killTypecheckRuns } from './typecheck/runner.js';

const app = express();
const port = process.env.PORT || 8050;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

const upload = multer({ storage: multer.memoryStorage() });

// Memory is mounted before the model routes so its availability is a fact the
// UI can read, never something a builder request has to discover by failing.
app.use('/api/memory', memoryRouter);

// The typechecker, mounted for the same reason and with the same shape. Both must
// sit ahead of the `app.get('*')` SPA fallback at the bottom of this file.
app.use('/api/typecheck', typecheckRouter);
app.use('/api/preview', previewRouter);

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

// =========================================================================================
// Daily quota governor
// =========================================================================================
// Free-tier daily request ceilings. Approximate by design — they exist so the UI can warn
// before a run fails, not to be authoritative. Override with QUOTA_LIMITS as JSON.
const DEFAULT_QUOTA_LIMITS = {
    'gemini-3.7-flash': 20,
    'gemini-3.5-flash': 250,
    'gemini-3.5-flash-lite': 1000,
    'gemini-3.1-pro-preview': 25,
};
const QUOTA_LIMITS = (() => {
    try {
        return process.env.QUOTA_LIMITS ? { ...DEFAULT_QUOTA_LIMITS, ...JSON.parse(process.env.QUOTA_LIMITS) } : DEFAULT_QUOTA_LIMITS;
    } catch {
        console.warn('QUOTA_LIMITS is not valid JSON; using defaults.');
        return DEFAULT_QUOTA_LIMITS;
    }
})();

const QUOTA_FILE = path.join(__dirname, 'logs', 'quota.json');
const today = () => new Date().toISOString().slice(0, 10);

let quotaState = { date: today(), counts: {} };
try {
    const saved = JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf8'));
    if (saved?.date === quotaState.date && saved.counts) quotaState = saved;   // a new day starts clean
} catch { /* first run, or unreadable — start fresh */ }

/** Counts a served request, and its tokens when the provider reported them. Never throws. */
const recordModelCall = (model, usage) => {
    if (quotaState.date !== today()) quotaState = { date: today(), counts: {}, tokens: {} };
    if (!quotaState.tokens) quotaState.tokens = {};
    quotaState.counts[model] = (quotaState.counts[model] ?? 0) + 1;
    if (usage) {
        const bucket = quotaState.tokens[model] ?? { in: 0, out: 0 };
        bucket.in += usage.inputTokens ?? 0;
        bucket.out += usage.outputTokens ?? 0;
        quotaState.tokens[model] = bucket;
    }
    fs.promises.mkdir(path.dirname(QUOTA_FILE), { recursive: true })
        .then(() => fs.promises.writeFile(QUOTA_FILE, JSON.stringify(quotaState)))
        .catch(e => console.warn('Could not persist quota counts:', e.message));
};

app.get('/api/quota', (req, res) => {
    if (quotaState.date !== today()) quotaState = { date: today(), counts: {}, tokens: {} };
    res.json({ date: quotaState.date, counts: quotaState.counts, tokens: quotaState.tokens ?? {}, limits: QUOTA_LIMITS, models: MODELS });
});

// Selectable models, their capabilities and their fallbacks all come from the
// catalog; a provider with no API key configured is absent from it entirely.
app.get('/api/models', (req, res) => {
    res.json({ models: usableModels(), defaults: MODELS });
});


// =========================================================================================
// Backend Logic for Coding Assistant (moved from frontend)
// =========================================================================================
const geminiService = {
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
    /**
     * Streams a coding turn from whichever provider serves the chosen model.
     * Returns { model, stream } where stream yields normalized events.
     */
    generateCodingContentStream: function(history, projects, persona, useWebSearch, customStyles, lowLatencyMode, model) {
        const codingModel = pickModel(model, MODELS.coding);
        const entry = getModel(codingModel);
        const provider = providerForModel(codingModel);

        const system = buildSystemPrompt({
            provider: entry.provider,
            persona,
            projects,
            customStyles,
        });

        // Google's built-in web search replaces function tools; other providers
        // have no equivalent, so they keep their function tools either way.
        const useGoogleSearch = useWebSearch && entry.provider === 'google';

        return {
            model: codingModel,
            stream: provider.streamChat({
                model: codingModel,
                system,
                messages: history ?? [],
                tools: useGoogleSearch ? [] : toolsForRequest(Boolean(projects?.length)),
                webSearch: useGoogleSearch,
                effort: lowLatencyMode ? 'none' : 'medium',
                maxOutputTokens: 8192,
            }),
        };
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

        const chatModel = pickModel(model, MODELS.chat);
        const provider = providerForModel(chatModel);

        res.setHeader('Content-Type', 'text/plain');
        let usage = null;
        for await (const event of provider.streamChat({
            model: chatModel,
            messages: [{ author: 'user', parts: [{ text: prompt }] }],
            effort: 'low',
            maxOutputTokens: 4096,
        })) {
            if (event.usage) usage = event.usage;
            if (event.text) res.write(event.text);
        }
        recordModelCall(chatModel, usage);
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

        const { model: servingModel, stream } = geminiService.generateCodingContentStream(history, projects, persona, useWebSearch, customStyles, lowLatencyMode, model);

        res.setHeader('Content-Type', 'application/x-ndjson');

        let usage = null;
        for await (const event of stream) {
            if (event.usage) usage = event.usage;
            // Only fields the client consumes are serialized; provider response
            // objects use getters that would not survive JSON.stringify.
            const payload = {
                text: event.text ?? undefined,
                thinking: event.thinking ?? undefined,
                functionCalls: event.toolCalls ?? undefined,
                groundingMetadata: event.grounding ?? undefined,
            };
            if (payload.text !== undefined || payload.thinking !== undefined || payload.functionCalls !== undefined || payload.groundingMetadata !== undefined) {
                res.write(JSON.stringify(payload) + '\n');
            }
        }
        recordModelCall(servingModel, usage);
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
        const { text, usage } = await providerForModel(MODELS.coding).generateText({ model: MODELS.coding, prompt });
        recordModelCall(MODELS.coding, usage);
        res.json({ summary: text.trim() });
    } catch (error) {
        console.error('Dependency analysis error:', error);
        res.status(500).json({ message: 'Error analyzing dependencies.' });
    }
});

// Transient-failure resilience: retry with backoff on 429/503, then fall back to the
// next model in the list. Used by the builder endpoints (3.7-flash spikes under demand).
const TRANSIENT_STATUSES = new Set([429, 503]);
// NVIDIA reports capacity exhaustion as a plain Error with no status field
// ("ResourceExhausted: Worker local total request limit reached"), so matching on
// status alone would treat a retryable condition as fatal.
const TRANSIENT_MESSAGE = /resourceexhausted|worker local total request limit|temporarily unavailable|overloaded|capacity/i;
const isTransient = (error) =>
    TRANSIENT_STATUSES.has(error?.status) || TRANSIENT_MESSAGE.test(String(error?.message ?? ''));
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * `onServed` reports which model actually answered. Only the fallback loop knows
 * it: the caller asked for a chain, and under a transient failure the model that
 * served is not the one requested. Memory attribution is only worth recording if
 * it names the model that really ran.
 */
async function withModelFallback(models, attempt, onServed) {
    let lastError;
    for (const model of models) {
        for (let tryNo = 0; tryNo < 2; tryNo++) {
            try {
                const result = await attempt(model);
                // Only served requests count; usage is recorded by the caller when
                // the provider reports it.
                recordModelCall(model, result?.usage);
                onServed?.(model);
                return result;
            } catch (error) {
                lastError = error;
                if (!isTransient(error)) throw error;
                console.warn(`Transient failure from ${model} (attempt ${tryNo + 1}): ${String(error.message).slice(0, 80)} — backing off...`);
                await sleep(2000 * (tryNo + 1));
            }
        }
    }
    throw lastError;
}
const builderModelChain = (requested) => modelChain(pickModel(requested, MODELS.builder), MODELS.coding);
const friendlyProviderError = (error, fallbackMessage) =>
    isTransient(error)
        ? `The model is temporarily overloaded${error?.status ? ` (HTTP ${error.status})` : ''}. Please try again in a minute, or pick a different model.`
        : fallbackMessage;

/** Splits a catalog model id into the attribution the memory engine records. */
const attributionFor = (model) => (model ? { provider: getModel(model)?.provider, model } : {});

/**
 * What was asked for, next to what actually answered.
 *
 * The model dropdown holds a REQUEST. It can be "auto", which is not a model at
 * all, and under a transient failure the fallback chain serves the next model
 * instead — so the request and the answer are different facts and both are worth
 * keeping. The gap between them is itself a signal: a model that is frequently
 * asked for and frequently replaced is telling you something no single-value
 * field could.
 */
const servedPayload = (requested, served) => ({
    requestedModel: requested ?? 'auto',
    servedModel: served ?? null,
    fellBack: Boolean(served && requested && requested !== 'auto' && served !== requested),
});

// Web App Builder - Step 1: Plan
app.post('/api/builder/plan', async (req, res) => {
    try {
        const { idea, model: requestedModel, previousPlan, feedback, buildId, episodeId } = req.body;
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

        // Recall is appended to the user prompt, not to the system prompt: one
        // wording then reaches all four providers and providers/prompts.js stays
        // the only place house style is decided.
        const recalled = await memory.recallBlock({
            buildId,
            episodeId,
            task: `plan a web application: ${String(idea ?? '').slice(0, 400)}`,
            surface: isRefinement ? 'builder.refine' : 'builder.plan',
        });

        let servingModel = null;
        const { object } = await withModelFallback(
            builderModelChain(requestedModel),
            (model) =>
                providerForModel(model).generateJson({
                    model,
                    system: builderPreamble(getModel(model).provider),
                    prompt: prompt + recalled,
                    schema: PLAN_SCHEMA,
                    effort: 'medium',
                    maxOutputTokens: 8192,
                }),
            (model) => { servingModel = model; },
        );

        res.json(object);

        // Recorded after the response: memory must never be on the critical path
        // between a finished plan and the user seeing it.
        memory.appendEventSafe({
            buildId,
            episodeId,
            kind: isRefinement ? 'contract.delta' : 'planning.answer',
            surface: isRefinement ? 'builder.refine' : 'builder.plan',
            ...attributionFor(servingModel),
            payload: {
                ...servedPayload(requestedModel, servingModel),
                idea: String(idea ?? '').slice(0, 500),
                ...(isRefinement ? { feedback: feedback.trim().slice(0, 500) } : {}),
                pages: Array.isArray(object?.pages) ? object.pages.length : 0,
                components: Array.isArray(object?.components) ? object.components.length : 0,
                acceptanceCriteria: Array.isArray(object?.acceptanceCriteria) ? object.acceptanceCriteria.length : 0,
                memoryInjected: recalled !== '',
            },
        });

    } catch (error) {
        console.error('Builder plan error:', error);
        res.status(500).json({ message: friendlyProviderError(error, 'Error generating project plan.') });
    }
});

// Web App Builder - Art directions: three distinct visual proposals for the theme step
const TYPOGRAPHY_NAMES = ['Sans-serif & Friendly', 'Serif & Professional', 'Mono & Techy', 'Grotesk & Bold', 'Editorial Serif'];

app.post('/api/builder/directions', async (req, res) => {
    try {
        const { idea, plan, model: requestedModel, buildId, episodeId } = req.body;
        const prompt = `You are an art director proposing visual directions for a web product.

Product idea: "${idea ?? ''}"
${plan ? `Plan:\n${JSON.stringify({ projectName: plan.projectName, projectDescription: plan.projectDescription, pages: (plan.pages || []).map(p => p.name) }, null, 2)}` : ''}

Propose exactly three art directions that are genuinely different from one another — not three variations of the same hue. Each should take a defensible position on mood and audience (for example: restrained and editorial; warm and human; high-contrast and technical). At least one should be light and at least one dark.

For each direction give hex values for all six roles. Requirements:
- Primary text on the page background must be clearly readable (strong contrast), and so must text on surfaces.
- The primary action colour must stand out against both background and surface.
- The accent must differ from the primary in hue, not just lightness.
- Typography must be exactly one of: ${TYPOGRAPHY_NAMES.join(' | ')}.`;

        // `directionGeneration` engages the engine's art-direction bar: taste,
        // layout, copy and art-direction lessons are excluded from the CANDIDATE
        // set, not merely from the result. Past builds may inform correctness;
        // they may not decide what the next one is allowed to look like.
        const recalled = await memory.recallBlock({
            buildId,
            episodeId,
            task: `propose art directions for: ${String(idea ?? '').slice(0, 400)}`,
            directionGeneration: true,
            surface: 'builder.directions',
        });

        let servingModel = null;
        const { object } = await withModelFallback(
            builderModelChain(requestedModel),
            (model) =>
                providerForModel(model).generateJson({
                    model,
                    system: builderPreamble(getModel(model).provider),
                    prompt: prompt + recalled,
                    schema: DIRECTIONS_SCHEMA,
                    effort: 'medium',
                    maxOutputTokens: 4096,
                }),
            (model) => { servingModel = model; },
        );

        res.json(object);

        memory.appendEventSafe({
            buildId,
            episodeId,
            kind: 'planning.answer',
            surface: 'builder.directions',
            ...attributionFor(servingModel),
            payload: {
                ...servedPayload(requestedModel, servingModel),
                directions: (object?.directions ?? []).map((d) => String(d?.name ?? '').slice(0, 120)),
                memoryInjected: recalled !== '',
            },
        });
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
        const { plan, theme, model: requestedModel, buildId, episodeId } = req.body;
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
1. Vite + React 19 + TypeScript, standard layout: index.html, src/main.tsx, src/App.tsx, src/index.css, src/pages/*, src/components/*.
2. Routing with react-router-dom v6 (Routes in src/App.tsx, shared layout with nav + footer).
3. Styling with Tailwind CSS v4: src/index.css starts with '@import "tailwindcss";' and vite.config.ts uses the @tailwindcss/vite plugin. Do NOT emit tailwind.config.js or postcss.config.js.
4. package.json with correct dependencies and pinned major versions (react ^19, react-dom ^19, react-router-dom ^6, tailwindcss ^4, @tailwindcss/vite ^4, vite ^5, @vitejs/plugin-react ^4, typescript ^5) and scripts: "dev": "vite", "build": "vite build", "typecheck": "tsc --noEmit", "preview": "vite preview".
5. tsconfig.json compilerOptions must be exactly: { "target": "ES2020", "lib": ["ES2020", "DOM", "DOM.Iterable"], "module": "ESNext", "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true, "esModuleInterop": true, "skipLibCheck": true, "noEmit": true } with "include": ["src"].
6. Code must compile under strict TypeScript: every function parameter, callback parameter and prop is explicitly typed — no implicit any. With jsx react-jsx, do not import React just for JSX; import only the hooks you use.
7. Every file must be complete and syntactically valid. State lives in React hooks; interactive features (forms, filters, toggles) must actually work with local state.

**Additionally generate "preview.html"**: a single fully self-contained static HTML snapshot of the app's home page for an instant visual preview. Inline ALL of its CSS in a <style> tag (hand-written CSS reproducing the theme — do not reference Tailwind or any external resource, no JavaScript). It must faithfully show the real layout, colors, typography and content.

**Before you finish**, verify every relative import you wrote resolves to a file you also emitted, and that every package you imported appears in package.json. Escape quotes inside JSX text (setQuote("I can't do this"), never setQuote('I can't do this')) — unescaped quotes are a build failure.

**Response format:** a single JSON object of the form {"files":[{"path":"...","content":"..."}, ...]} listing every file. No markdown, no commentary.`;

        res.setHeader('Content-Type', 'application/x-ndjson');

        // On a transient failure the whole attempt restarts (progress resets to 0
        // client-side, which is harmless — events are self-describing).
        // Matches the value of each "path" field as it streams in. Provider-neutral:
        // the files array shape is identical whichever model produced it.
        const FILE_PATH_RE = /"path"\s*:\s*"([^"\\]{1,160})"/g;

        // Correctness territory: build/dependency/environment lessons are exactly
        // what a code-generation turn should hear about.
        const recalled = await memory.recallBlock({
            buildId,
            episodeId,
            task: `generate a React application: ${String(plan?.projectName ?? '').slice(0, 200)}`,
            domain: 'build',
            surface: 'builder.generate',
        });

        // Notes this project's own failures produced, which have not yet been shown
        // to help. The engine will not put them in its governed packet, and is right
        // not to -- deciding an unproven note is worth trying is the host's call, not
        // the engine's. Kept in a separate, separately-labelled block for that reason,
        // and recorded as applied so that if this attempt passes, the claim that they
        // helped is checkable instead of assumed.
        const trialled = await memory.trialBlock({ buildId, episodeId });

        let servingModel = null;
        const accumulated = await withModelFallback(builderModelChain(requestedModel), async (model) => {
            res.write(JSON.stringify({ phase: 'thinking', model }) + '\n');
            const provider = providerForModel(model);
            let acc = '';
            let usage = null;
            const seenFiles = new Set();
            for await (const event of provider.streamJson({
                model,
                system: builderPreamble(getModel(model).provider),
                prompt: prompt + recalled + trialled,
                schema: GENERATE_SCHEMA,
                effort: 'medium',
                maxOutputTokens: 65536,
            })) {
                if (event.usage) usage = event.usage;
                if (event.text) {
                    if (acc === '') res.write(JSON.stringify({ phase: 'writing', model }) + '\n');
                    acc += event.text;
                    FILE_PATH_RE.lastIndex = 0;
                    let match;
                    while ((match = FILE_PATH_RE.exec(acc)) !== null) {
                        if (!seenFiles.has(match[1])) {
                            seenFiles.add(match[1]);
                            res.write(JSON.stringify({ file: match[1] }) + '\n');
                        }
                    }
                    res.write(JSON.stringify({ progress: acc.length }) + '\n');
                }
            }
            return { text: acc, usage };
        }, (model) => { servingModel = model; });

        try {
            // The client protocol is unchanged: the files array becomes the
            // { path: content } map it has always consumed.
            const files = filesArrayToRecord(JSON.parse(accumulated.text).files);
            if (Object.keys(files).length === 0) throw new Error('no files in response');
            res.write(JSON.stringify({ files }) + '\n');

            // A candidate exists. Whether it is any GOOD is the validator's
            // verdict, which the client reports separately as
            // verification.completed — this event is deliberately not that claim.
            memory.appendEventSafe({
                buildId,
                episodeId,
                kind: 'candidate.created',
                surface: 'builder.generate',
                ...attributionFor(servingModel),
                payload: {
                    ...servedPayload(requestedModel, servingModel),
                    fileCount: Object.keys(files).length,
                    bytes: accumulated.text.length,
                    memoryInjected: recalled !== '',
                },
            });
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

/**
 * Close the memory databases on the way out.
 *
 * WAL makes an unclean exit safe, so this is not about data loss -- it is that a
 * killed process never checkpoints, so the -wal files grow and a copied database
 * is a stale one. Closing merges them back.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        try { memory.closeAll(); } catch { /* shutting down anyway */ }
        // A tsc child outlives its parent unless told otherwise, and it holds real
        // memory on a phone.
        try { killTypecheckRuns(); } catch { /* shutting down anyway */ }
        process.exit(0);
    });
}

// Anything left in the scratch tree is from a run that did not get to clean up
// after itself. Start from empty rather than inheriting it.
await cleanTypecheckScratch();

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    // Which databases this process will write to, said out loud at boot.
    // A second server on an occupied port dies with EADDRINUSE, so requests keep
    // being answered -- by the one already there, writing wherever IT was told to.
    // That cost a whole verification run before the two lines below existed.
    console.log(`Memory databases: ${memory.health().databaseDir}`);
});