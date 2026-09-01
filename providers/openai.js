import OpenAI from 'openai';
import { normalizeEffort } from './effort.js';
import { maxOutputFor } from './catalog.js';

// OpenAI adapter, built on the Responses API (the current surface for reasoning
// and tool use). Verified live: `text.format` json_schema strict and `tools` may
// be sent in the same request, so the builder can keep its tools available while
// still getting schema-constrained output.
//
// Strict json_schema requires every property to appear in `required` and
// `additionalProperties: false` everywhere — which is exactly the intersection
// dialect providers/schemas.js is already written in.

const toOpenAITools = (tools) => tools?.length ? tools.map(t => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: true,
})) : undefined;

/**
 * Neutral history -> Responses API input items. A tool call is a `function_call`
 * item and its result a `function_call_output` item; the two are paired by
 * call_id, which the neutral format does not carry, so we derive a stable one.
 */
const toInput = (messages) => {
    const items = [];
    const idFor = (name, index) => `call_${index}_${String(name).replace(/[^a-zA-Z0-9_-]/g, '')}`.slice(0, 60);

    messages.forEach((msg, index) => {
        if (msg.author === 'assistant') {
            const text = msg.parts?.find(p => p.text)?.text;
            if (text) items.push({ role: 'assistant', content: text });
            if (msg.toolCall) {
                items.push({
                    type: 'function_call',
                    call_id: idFor(msg.toolCall.name, index),
                    name: msg.toolCall.name,
                    arguments: JSON.stringify(msg.toolCall.args ?? {}),
                });
            }
        } else if (msg.author === 'tool') {
            if (!msg.toolResponse) return;
            items.push({
                type: 'function_call_output',
                call_id: idFor(msg.toolResponse.name, index - 1),
                output: JSON.stringify(msg.toolResponse.response?.content ?? {}),
            });
        } else {
            const text = (msg.parts ?? []).map(p => p.text || '').join('').trim();
            if (text) items.push({ role: 'user', content: text });
        }
    });
    return items;
};

const usageOf = (usage) => usage ? {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
} : null;

/**
 * @param {object} config
 * @param {string} config.apiKey
 * @param {string} [config.baseURL]  set for OpenAI-compatible hosts
 * @param {string} [config.id]
 */
export const createOpenAIProvider = ({ apiKey, baseURL, id = 'openai' }) => {
    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

    const requestFor = (model, effort, maxOutputTokens, extra = {}) => ({
        model,
        max_output_tokens: maxOutputFor(model, maxOutputTokens),
        // `none` is a real effort level here, so it passes through unclamped.
        reasoning: { effort: normalizeEffort(effort), summary: 'auto' },
        ...extra,
    });

    async function* streamRequest(request) {
        const stream = await client.responses.create({ ...request, stream: true });
        const pending = new Map();

        for await (const event of stream) {
            switch (event.type) {
                case 'response.output_text.delta':
                    yield { text: event.delta };
                    break;
                case 'response.reasoning_summary_text.delta':
                    yield { thinking: event.delta };
                    break;
                case 'response.output_item.added':
                    if (event.item?.type === 'function_call') {
                        pending.set(event.output_index, { name: event.item.name, args: '' });
                    }
                    break;
                case 'response.function_call_arguments.delta': {
                    const entry = pending.get(event.output_index);
                    if (entry) entry.args += event.delta;
                    break;
                }
                case 'response.output_item.done': {
                    const entry = pending.get(event.output_index);
                    if (entry) {
                        pending.delete(event.output_index);
                        const raw = event.item?.arguments ?? entry.args;
                        let args = {};
                        try { args = raw ? JSON.parse(raw) : {}; } catch { args = {}; }
                        yield { toolCalls: [{ name: entry.name, args }] };
                    }
                    break;
                }
                case 'response.completed':
                case 'response.incomplete': {
                    const usage = usageOf(event.response?.usage);
                    if (usage) yield { usage };
                    break;
                }
                default:
                    break;
            }
        }
    }

    return {
        id,

        async *streamChat({ model, system, messages, tools, effort, maxOutputTokens }) {
            yield* streamRequest(requestFor(model, effort, maxOutputTokens ?? 8192, {
                ...(system ? { instructions: system } : {}),
                input: toInput(messages),
                ...(toOpenAITools(tools) ? { tools: toOpenAITools(tools) } : {}),
            }));
        },

        async *streamJson({ model, system, prompt, schema, effort, maxOutputTokens }) {
            yield* streamRequest(requestFor(model, effort, maxOutputTokens ?? 16000, {
                ...(system ? { instructions: system } : {}),
                input: prompt,
                ...(schema ? { text: { format: { type: 'json_schema', name: 'result', strict: true, schema } } } : {}),
            }));
        },

        async generateJson({ model, system, prompt, schema, effort, maxOutputTokens }) {
            let text = '';
            let usage = null;
            for await (const event of this.streamJson({ model, system, prompt, schema, effort, maxOutputTokens })) {
                if (event.text) text += event.text;
                if (event.usage) usage = event.usage;
            }
            return { object: JSON.parse(text), usage };
        },

        async generateText({ model, prompt, maxOutputTokens }) {
            const response = await client.responses.create(
                requestFor(model, 'low', maxOutputTokens ?? 4096, { input: prompt }),
            );
            return { text: response.output_text ?? '', usage: usageOf(response.usage) };
        },
    };
};
