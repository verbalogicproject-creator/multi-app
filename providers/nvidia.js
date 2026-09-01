import OpenAI from 'openai';
import { nvidiaReasoning, normalizeEffort } from './effort.js';

// NVIDIA NIM adapter. The endpoint is OpenAI-compatible, so it reuses the OpenAI
// SDK with a base-URL swap — but it speaks Chat Completions, not the Responses
// API, and differs in three ways that each caused a real failure in testing:
//
//   1. Reasoning models emit `reasoning_content` BEFORE `content`. With a tight
//      max_tokens the reasoning consumes the whole completion budget and the
//      answer comes back empty — reproduced on kimi-k3 at max_tokens 16.
//      nvidiaReasoning() adds headroom on top of the caller's budget.
//   2. Reasoning is toggled through chat_template_kwargs, not a standard field.
//   3. There is no schema-constrained decoding — `response_format:
//      {type:'json_object'}` guarantees syntactic JSON only, so the schema is
//      described in the prompt and the result is validated by the caller.

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

const toNvidiaTools = (tools) => tools?.length ? tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
})) : undefined;

const toMessages = (system, messages) => {
    const out = system ? [{ role: 'system', content: system }] : [];
    const idFor = (name, index) => `call_${index}_${String(name).replace(/[^a-zA-Z0-9_-]/g, '')}`.slice(0, 60);

    messages.forEach((msg, index) => {
        if (msg.author === 'assistant') {
            const text = msg.parts?.find(p => p.text)?.text ?? '';
            if (msg.toolCall) {
                out.push({
                    role: 'assistant',
                    content: text || null,
                    tool_calls: [{
                        id: idFor(msg.toolCall.name, index),
                        type: 'function',
                        function: { name: msg.toolCall.name, arguments: JSON.stringify(msg.toolCall.args ?? {}) },
                    }],
                });
            } else if (text) {
                out.push({ role: 'assistant', content: text });
            }
        } else if (msg.author === 'tool') {
            if (!msg.toolResponse) return;
            out.push({
                role: 'tool',
                tool_call_id: idFor(msg.toolResponse.name, index - 1),
                content: JSON.stringify(msg.toolResponse.response?.content ?? {}),
            });
        } else {
            const text = (msg.parts ?? []).map(p => p.text || '').join('').trim();
            if (text) out.push({ role: 'user', content: text });
        }
    });
    return out;
};

const usageOf = (usage) => usage ? {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
} : null;

export const createNvidiaProvider = ({ apiKey }) => {
    const client = new OpenAI({ apiKey, baseURL: BASE_URL });

    const requestFor = (model, effort, maxOutputTokens, extra = {}) => {
        const { enableThinking, maxTokens } = nvidiaReasoning(normalizeEffort(effort), maxOutputTokens);
        return {
            model,
            max_tokens: maxTokens,
            chat_template_kwargs: { thinking: enableThinking, enable_thinking: enableThinking },
            ...extra,
        };
    };

    async function* streamRequest(request) {
        const stream = await client.chat.completions.create({ ...request, stream: true, stream_options: { include_usage: true } });
        const pending = new Map();

        for await (const chunk of stream) {
            const choice = chunk.choices?.[0];
            const delta = choice?.delta;
            if (delta?.reasoning_content) yield { thinking: delta.reasoning_content };
            if (delta?.content) yield { text: delta.content };

            for (const call of delta?.tool_calls ?? []) {
                const entry = pending.get(call.index) ?? { name: '', args: '' };
                if (call.function?.name) entry.name = call.function.name;
                if (call.function?.arguments) entry.args += call.function.arguments;
                pending.set(call.index, entry);
            }
            if (choice?.finish_reason === 'tool_calls') {
                for (const entry of pending.values()) {
                    let args = {};
                    try { args = entry.args ? JSON.parse(entry.args) : {}; } catch { args = {}; }
                    yield { toolCalls: [{ name: entry.name, args }] };
                }
                pending.clear();
            }
            const usage = usageOf(chunk.usage);
            if (usage) yield { usage };
        }
    }

    /** These models cannot be constrained to a schema, so it is described instead. */
    const schemaPrompt = (prompt, schema) => schema
        ? `${prompt}\n\nRespond with a single JSON object matching this JSON Schema exactly. Output only the JSON — no markdown fences, no commentary.\n\n${JSON.stringify(schema)}`
        : prompt;

    return {
        id: 'nvidia',

        async *streamChat({ model, system, messages, tools, effort, maxOutputTokens }) {
            yield* streamRequest(requestFor(model, effort, maxOutputTokens ?? 8192, {
                messages: toMessages(system, messages),
                ...(toNvidiaTools(tools) ? { tools: toNvidiaTools(tools) } : {}),
            }));
        },

        async *streamJson({ model, system, prompt, schema, effort, maxOutputTokens }) {
            yield* streamRequest(requestFor(model, effort, maxOutputTokens ?? 16000, {
                messages: toMessages(system, [{ author: 'user', parts: [{ text: schemaPrompt(prompt, schema) }] }]),
                response_format: { type: 'json_object' },
            }));
        },

        async generateJson({ model, system, prompt, schema, effort, maxOutputTokens }) {
            let text = '';
            let usage = null;
            for await (const event of this.streamJson({ model, system, prompt, schema, effort, maxOutputTokens })) {
                if (event.text) text += event.text;
                if (event.usage) usage = event.usage;
            }
            // Without constrained decoding a model may still wrap JSON in prose or
            // fences, so recover the outermost object rather than failing outright.
            try {
                return { object: JSON.parse(text), usage };
            } catch {
                const start = text.indexOf('{');
                const end = text.lastIndexOf('}');
                if (start === -1 || end <= start) throw new Error('Model did not return JSON.');
                return { object: JSON.parse(text.slice(start, end + 1)), usage };
            }
        },

        async generateText({ model, prompt, maxOutputTokens }) {
            const response = await client.chat.completions.create(
                requestFor(model, 'none', maxOutputTokens ?? 4096, { messages: [{ role: 'user', content: prompt }] }),
            );
            return { text: response.choices?.[0]?.message?.content ?? '', usage: usageOf(response.usage) };
        },
    };
};
