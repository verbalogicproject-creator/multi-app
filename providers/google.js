import { GoogleGenAI } from '@google/genai';
import { geminiThinking, clampEffort } from './effort.js';
import { supportedEfforts, maxOutputFor } from './catalog.js';

// Google adapter. Behaviour is deliberately identical to the pre-adapter server:
// same chat/stream calls, same tool declarations, same JSON config — only the
// call sites moved.

const toGeminiTools = (tools, webSearch) => {
    if (webSearch) return [{ googleSearch: {} }];
    if (!tools?.length) return undefined;
    return [{
        functionDeclarations: tools.map(t => ({
            name: t.name,
            // Gemini reads the description from inside `parameters`, unlike the others.
            parameters: { ...t.parameters, description: t.description },
        })),
    }];
};

/** Neutral history -> Gemini `contents`. Assistant tool calls and tool results become parts. */
const toContents = (messages) => messages.map(msg => {
    const role = msg.author === 'assistant' ? 'model' : 'user';
    let parts = [];
    if (msg.author === 'assistant') {
        const textPart = msg.parts?.find(p => p.text);
        if (textPart?.text) parts.push({ text: textPart.text });
        if (msg.toolCall) parts.push({ functionCall: msg.toolCall });
    } else if (msg.author === 'tool') {
        if (msg.toolResponse) parts.push({ functionResponse: { name: msg.toolResponse.name, response: { content: msg.toolResponse.response.content } } });
    } else {
        parts = (msg.parts ?? []).map(p => ({ text: p.text || '' }));
    }
    return { role, parts };
}).filter(c => c.parts.length > 0 && !(c.role === 'model' && c.parts.length === 1 && c.parts[0].text === ''));

const usageOf = (meta) => meta ? {
    inputTokens: meta.promptTokenCount ?? 0,
    outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
} : null;

export const createGoogleProvider = ({ apiKey }) => {
    const ai = new GoogleGenAI({ apiKey });

    const configFor = (model, effort, maxOutputTokens, extra = {}) => {
        const config = { ...extra };
        if (maxOutputTokens) config.maxOutputTokens = maxOutputFor(model, maxOutputTokens);
        const normalized = clampEffort(effort, supportedEfforts(model));
        const thinking = geminiThinking(normalized);
        // includeThoughts is only valid while thinking is on: asking for thought
        // text alongside a zero budget is rejected as an invalid argument.
        const wantsThoughts = normalized !== 'none' && extra.thinkingConfig?.includeThoughts;
        config.thinkingConfig = { ...thinking, ...(wantsThoughts ? { includeThoughts: true } : {}) };
        return config;
    };

    return {
        id: 'google',

        /** Streams a chat turn, yielding normalized events. */
        async *streamChat({ model, system, messages, tools, webSearch, effort, maxOutputTokens }) {
            const contents = toContents(messages);
            const config = configFor(model, effort, maxOutputTokens, {
                ...(system ? { systemInstruction: system } : {}),
                ...(toGeminiTools(tools, webSearch) ? { tools: toGeminiTools(tools, webSearch) } : {}),
                thinkingConfig: { includeThoughts: true },
            });

            // The final message is the current turn; everything before it is history,
            // which must be supplied at creation time.
            const last = contents.pop();
            const chat = ai.chats.create({ model, config, history: contents });
            const stream = await chat.sendMessageStream({ message: last?.parts ?? [{ text: '' }] });

            for await (const chunk of stream) {
                const event = {};
                for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
                    if (part.thought && part.text) event.thinking = (event.thinking ?? '') + part.text;
                }
                if (chunk.text) event.text = chunk.text;
                if (chunk.functionCalls?.length) event.toolCalls = chunk.functionCalls.map(c => ({ name: c.name, args: c.args ?? {} }));
                const grounding = chunk.candidates?.[0]?.groundingMetadata;
                if (grounding) event.grounding = grounding;
                const usage = usageOf(chunk.usageMetadata);
                if (usage) event.usage = usage;
                if (Object.keys(event).length) yield event;
            }
        },

        /** Streams a schema-constrained JSON generation as raw text deltas. */
        async *streamJson({ model, system, prompt, schema, effort, maxOutputTokens }) {
            const config = configFor(model, effort, maxOutputTokens, {
                ...(system ? { systemInstruction: system } : {}),
                responseMimeType: 'application/json',
                ...(schema ? { responseJsonSchema: schema } : {}),
            });
            const stream = await ai.models.generateContentStream({ model, contents: prompt, config });
            for await (const chunk of stream) {
                const event = {};
                if (chunk.text) event.text = chunk.text;
                const usage = usageOf(chunk.usageMetadata);
                if (usage) event.usage = usage;
                /* Why the model stopped. `MAX_TOKENS` here is the difference between
                   "the model wrote bad JSON" and "the model was cut off mid-sentence",
                   and dropping it is what made a budget overrun arrive disguised as a
                   quality failure for as long as it did. */
                const finishReason = chunk.candidates?.[0]?.finishReason;
                if (finishReason) event.finishReason = finishReason;
                if (Object.keys(event).length) yield event;
            }
        },

        /** One-shot schema-constrained JSON. */
        async generateJson({ model, system, prompt, schema, effort, maxOutputTokens }) {
            const config = configFor(model, effort, maxOutputTokens, {
                ...(system ? { systemInstruction: system } : {}),
                responseMimeType: 'application/json',
                ...(schema ? { responseJsonSchema: schema } : {}),
            });
            const response = await ai.models.generateContent({ model, contents: prompt, config });
            return { object: JSON.parse(response.text), usage: usageOf(response.usageMetadata) };
        },

        /** Plain text, no schema (dependency analysis). */
        async generateText({ model, prompt, maxOutputTokens }) {
            const response = await ai.models.generateContent({
                model, contents: prompt,
                config: maxOutputTokens ? { maxOutputTokens } : {},
            });
            return { text: response.text ?? '', usage: usageOf(response.usageMetadata) };
        },

        /** Media features (flagged off in the UI) stay on the native client. */
        raw: ai,
    };
};
