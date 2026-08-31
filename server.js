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
const MODELS = {
    chat: process.env.MODEL_CHAT || 'gemini-2.5-flash',
    coding: process.env.MODEL_CODING || 'gemini-2.5-flash',
    builder: process.env.MODEL_BUILDER || 'gemini-2.5-flash',
    image: process.env.MODEL_IMAGE || 'gemini-2.5-flash-image',
    video: process.env.MODEL_VIDEO || 'veo-3.1-generate-preview',
};


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
        }
    },
    required: ['projectName', 'projectDescription', 'pages', 'components']
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
    generateCodingContentStream: async function(history, projects, persona, useWebSearch, customStyles, lowLatencyMode) {
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
        const chat = ai.chats.create({ model: MODELS.coding, config, history: contents });

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
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ message: 'Prompt is required.' });
        }
        
        const chat = ai.chats.create({ model: MODELS.chat });
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
        const { history, projects, persona, useWebSearch, customStyles, lowLatencyMode } = req.body;
        
        const resultIterator = await geminiService.generateCodingContentStream(history, projects, persona, useWebSearch, customStyles, lowLatencyMode);

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

// Web App Builder - Step 1: Plan
app.post('/api/builder/plan', async (req, res) => {
    try {
        const { idea } = req.body;
        const prompt = `You are a senior web architect. A user wants to build a web application.
User's Idea: "${idea}"

Analyze the user's idea and create a logical project plan for a standard React (Vite) + TailwindCSS application. The plan should include a project name, description, a list of pages, and a list of reusable components.`;
        
        const response = await ai.models.generateContent({
            model: MODELS.builder,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: planResponseSchema
            }
        });

        res.setHeader('Content-Type', 'application/json');
        res.send(response.text);

    } catch (error) {
        console.error('Builder plan error:', error);
        res.status(500).json({ message: 'Error generating project plan.' });
    }
});

// Web App Builder - Step 2: Generate
app.post('/api/builder/generate', async (req, res) => {
    try {
        const { plan, theme } = req.body;
        const prompt = `You are an expert React developer using Vite and TailwindCSS.
Your task is to generate the complete code for a web application based on the provided project plan and theme.
You MUST generate all necessary files, including package.json, vite.config.ts, index.html, App.tsx, main.tsx, and all specified pages and components.

**Project Plan:**
${JSON.stringify(plan, null, 2)}

**Theme:**
- Color Palette: ${theme.palette}
- Typography: ${theme.typography}

**Instructions:**
1.  **File Structure:** Use a standard Vite React layout (e.g., 'src/pages', 'src/components').
2.  **Routing:** Use 'react-router-dom' for page navigation. Set it up in 'App.tsx'.
3.  **Styling:** Use TailwindCSS classes for all styling. Add the tailwind.config.js and postcss.config.js files.
4.  **Content:** Use placeholder text and images where necessary, but make them relevant to the project's purpose.
5.  **Response Format:** Your response MUST be a single JSON object where keys are the full file paths (e.g., 'src/components/Navbar.tsx') and values are the complete code for that file as a string.

Example Response:
{
  "package.json": "...",
  "index.html": "...",
  "src/main.tsx": "...",
  "src/App.tsx": "...",
  "src/pages/HomePage.tsx": "...",
  ...etc
}

Now, generate the complete project.`;

        const response = await ai.models.generateContent({ model: MODELS.builder, contents: prompt, config: { responseMimeType: 'application/json' } });
        
        res.setHeader('Content-Type', 'application/json');
        res.send(response.text);

    } catch (error) {
        console.error('Builder generate error:', error);
        res.status(500).json({ message: 'Error generating project code.' });
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