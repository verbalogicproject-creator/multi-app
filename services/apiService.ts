
import { CustomAiStyle, Message, MessagePart, Persona, Project, ProjectFile } from "../types/index";
import { updateProject as updateProjectInStorage } from "./geminiService";
import type { GenerateResult } from '../types/build';

export interface CatalogModel {
    id: string;
    provider: string;
    providerLabel: string;
    label: string;
    hint: string;
    thinking: boolean;
    tools: boolean;
    priceIn: number;
    priceOut: number;
    dailyLimit: number | null;
    paid: boolean;
}

/** The models this backend can actually serve right now (providers with keys configured). */
export const getModels = async (): Promise<{ models: CatalogModel[]; defaults: Record<string, string> } | null> => {
    try {
        const response = await fetch('/api/models');
        return response.ok ? await response.json() : null;
    } catch {
        return null;
    }
};

export interface QuotaSnapshot {
    date: string;
    counts: Record<string, number>;
    tokens: Record<string, { in: number; out: number }>;
    limits: Record<string, number>;
    models: Record<string, string>;
}

/** Today's per-model request counts. Returns null when the backend is unreachable. */
export const getQuota = async (): Promise<QuotaSnapshot | null> => {
    try {
        const response = await fetch('/api/quota');
        return response.ok ? await response.json() : null;
    } catch {
        return null;
    }
};

export const sendMessageStream = async (prompt: string, onChunk: (chunk: string) => void): Promise<void> => {
    const response = await fetch('/api/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
    });
    if (!response.ok || !response.body) throw new Error('Failed to get streaming response from server.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk(decoder.decode(value));
    }
};

export const editImage = async (prompt: string, file: File): Promise<MessagePart[]> => {
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('file', file);
    const response = await fetch('/api/edit-image', { method: 'POST', body: formData });
    if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Image editing failed.'); }
    return response.json();
};

export const generateVideo = async (augmentedPrompt: string, file: File | null, _duration: number, _aspectRatio: string, updateStatus: (status: string) => void): Promise<MessagePart[]> => {
    updateStatus("Preparing video generation request...");
    const formData = new FormData();
    formData.append('prompt', augmentedPrompt);
    if (file) formData.append('file', file);
    updateStatus("Sending request to Veo model...");
    const initialResponse = await fetch('/api/generate-video', { method: 'POST', body: formData });
    if (!initialResponse.ok) { const error = await initialResponse.json(); throw new Error(error.message || 'Failed to start video generation.'); }
    const { operationName } = await initialResponse.json();
    updateStatus("Video generation in progress... this can take a few minutes.");
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        const statusResponse = await fetch(`/api/video-status?operationName=${operationName}`);
        if (!statusResponse.ok) throw new Error('Failed to get video generation status.');
        const statusResult = await statusResponse.json();
        if (statusResult.done) {
            updateStatus("Video generated! Preparing for display...");
            if (statusResult.error) throw new Error(statusResult.error);
            return [{ videoUrl: statusResult.videoUrl }];
        }
    }
};

export const generateCodingContentStream = async (history: Message[], projects: Project[], persona: Persona, useWebSearch: boolean, customStyles: CustomAiStyle[], lowLatencyMode: boolean, model?: string): Promise<ReadableStream<Uint8Array>> => {
    const response = await fetch('/api/coding-chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history, projects, persona, useWebSearch, customStyles, lowLatencyMode, model }),
    });
    if (!response.ok || !response.body) { const error = await response.json(); throw new Error(error.message || 'Failed to get streaming response from server.'); }
    return response.body;
};

export const npmSearch = async (packageName: string): Promise<any> => {
    const response = await fetch(`/api/npm-search?packageName=${encodeURIComponent(packageName)}`);
    if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'NPM search failed.'); }
    return response.json();
};

export const updateProjectDependencies = async (project: Project, files: ProjectFile[]): Promise<Project> => {
    if (files.length === 0) {
        project.dependencySummary = 'No files to analyze.';
        await updateProjectInStorage(project);
        return project;
    }
    const response = await fetch('/api/analyze-dependencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
    });
    if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Failed to analyze dependencies.'); }
    const { summary } = await response.json();
    project.dependencySummary = summary;
    await updateProjectInStorage(project);
    return project;
};

// Web App Builder API Calls

/**
 * Links a builder request to its memory cluster, so the server-side taps can
 * attribute what they record and the recall step knows which build to read.
 * Omitted, or carrying a null `buildId`, means memory is off for this call — the
 * server treats a missing id as "do not record" rather than as an error.
 */
export interface MemoryRef {
    buildId: string | null;
    episodeId?: string | null;
}

const memoryFields = (ref?: MemoryRef): { buildId?: string; episodeId?: string | null } =>
    ref?.buildId ? { buildId: ref.buildId, episodeId: ref.episodeId ?? null } : {};

export const suggestArtDirections = async (idea: string, plan: any, model?: string, memory?: MemoryRef): Promise<any[]> => {
    const response = await fetch('/api/builder/directions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, plan, model, ...memoryFields(memory) }),
    });
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.message || 'Failed to suggest art directions.'); }
    const data = await response.json();
    return Array.isArray(data?.directions) ? data.directions : [];
};

export const generateWebAppPlan = async (idea: string, model?: string, refine?: { previousPlan: any; feedback: string }, memory?: MemoryRef): Promise<any> => {
    const response = await fetch('/api/builder/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, model, ...refine, ...memoryFields(memory) }),
    });
    if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Failed to generate web app plan.'); }
    return response.json();
};

export interface BuilderProgressEvent {
    progress?: number;   // total characters generated so far
    file?: string;       // a file path Gemini just started writing
    phase?: 'thinking' | 'writing';
    model?: string;      // which model is serving this attempt (fallback-aware)
}

export const generateWebAppCode = async (plan: any, theme: any, model?: string, onProgress?: (event: BuilderProgressEvent) => void, memory?: MemoryRef): Promise<GenerateResult> => {
    const response = await fetch('/api/builder/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, theme, model, ...memoryFields(memory) }),
    });
    if (!response.ok || !response.body) { const error = await response.json().catch(() => ({})); throw new Error(error.message || 'Failed to generate web app code.'); }

    // NDJSON stream: {phase}/{file}/{progress} events during generation, then {files} or {error}.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let carry = '';
    let files: Record<string, string> | null = null;
    let truncated = false;
    let salvagedCount = 0;
    let finishReason: string | null = null;

    const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.error) throw new Error(event.error);
        if (event.files) {
            files = event.files;
            /* A truncated result still carries files. This flag is what stops them
               being mistaken for a finished candidate downstream. */
            truncated = event.truncated === true;
            salvagedCount = event.salvagedCount ?? 0;
            finishReason = event.finishReason ?? null;
        } else if (onProgress) onProgress(event as BuilderProgressEvent);
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = (carry + decoder.decode(value, { stream: true })).split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) handleLine(line);
    }
    const tail = carry + decoder.decode();
    if (tail.trim()) handleLine(tail);

    if (!files) throw new Error('Generation stream ended without a result. Please try again.');
    return { files, truncated, salvagedCount, finishReason };
};