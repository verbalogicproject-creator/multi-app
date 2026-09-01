import Anthropic from '@anthropic-ai/sdk';
import { anthropicEffort, anthropicBudget, clampEffort } from './effort.js';
import { thinkingStyle, maxOutputFor } from './catalog.js';

// Anthropic adapter.
//
// Three things here are model-generation-specific and were each verified live:
//   - 5-gen models take `thinking: {type:'adaptive'}` + `output_config.effort`;
//     the legacy `{type:'enabled', budget_tokens}` is rejected with a 400.
//   - haiku-4.5 is the reverse: `output_config.effort` returns 400 ("does not
//     support the effort parameter") and it needs a manual budget instead.
//   - fable-5 has thinking always on, so no thinking config is sent at all.
// Structured output uses `output_config.format`, not tool-forcing, and may be
// combined with tools in the same request.

const toAnthropicTools = (tools) => tools?.length ? tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
})) : undefined;

/**
 * Neutral history -> Anthropic messages. Tool calls become tool_use blocks and
 * tool results tool_result blocks, which must reference the same id — we derive
 * a stable id per tool name since the neutral format does not carry one.
 */
const toMessages = (messages) => {
    const out = [];
    const idFor = (name, index) => `call_${index}_${String(name).replace(/[^a-zA-Z0-9_-]/g, '')}`.slice(0, 60);

    messages.forEach((msg, index) => {
        if (msg.author === 'assistant') {
            const content = [];
            const text = msg.parts?.find(p => p.text)?.text;
            if (text) content.push({ type: 'text', text });
            if (msg.toolCall) {
                content.push({ type: 'tool_use', id: idFor(msg.toolCall.name, index), name: msg.toolCall.name, input: msg.toolCall.args ?? {} });
            }
            if (content.length) out.push({ role: 'assistant', content });
        } else if (msg.author === 'tool') {
            if (!msg.toolResponse) return;
            // The matching tool_use was emitted by the previous assistant turn.
            const content = JSON.stringify(msg.toolResponse.response?.content ?? {});
            out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: idFor(msg.toolResponse.name, index - 1), content }] });
        } else {
            const text = (msg.parts ?? []).map(p => p.text || '').join('').trim();
            if (text) out.push({ role: 'user', content: text });
        }
    });

    // The API requires the conversation to open with a user turn.
    while (out.length && out[0].role !== 'user') out.shift();
    return out;
};

const usageOf = (usage) => usage ? {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
} : null;

export const createAnthropicProvider = ({ apiKey }) => {
    const client = new Anthropic({ apiKey });

    /** Per-generation reasoning config. */
    const reasoningFor = (model, effort, maxTokens) => {
        const style = thinkingStyle(model);
        const wanted = clampEffort(effort, []);
        if (style === 'always-on') return {};                       // thinking is not configurable
        if (style === 'budget') {
            const budget = anthropicBudget(wanted, maxTokens);
            return budget ? { thinking: { type: 'enabled', budget_tokens: budget } } : {};
        }
        return {
            thinking: { type: 'adaptive', display: 'summarized' },
            output_config: { effort: anthropicEffort(wanted) },
        };
    };

    /** Merges reasoning config with any output_config the caller needs (e.g. a schema). */
    const buildRequest = (model, effort, requestedTokens, extra = {}) => {
        const maxTokens = maxOutputFor(model, requestedTokens);
        const reasoning = reasoningFor(model, effort, maxTokens);
        const outputConfig = { ...(reasoning.output_config ?? {}), ...(extra.output_config ?? {}) };
        return {
            model,
            max_tokens: maxTokens,
            ...extra,
            ...(reasoning.thinking ? { thinking: reasoning.thinking } : {}),
            ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        };
    };

    async function* streamRequest(request) {
        const stream = client.messages.stream(request);
        const pendingToolCalls = new Map();

        for await (const event of stream) {
            if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                pendingToolCalls.set(event.index, { name: event.content_block.name, json: '' });
            } else if (event.type === 'content_block_delta') {
                const delta = event.delta;
                if (delta.type === 'text_delta') yield { text: delta.text };
                else if (delta.type === 'thinking_delta') yield { thinking: delta.thinking };
                else if (delta.type === 'input_json_delta') {
                    const pending = pendingToolCalls.get(event.index);
                    if (pending) pending.json += delta.partial_json;
                }
            } else if (event.type === 'content_block_stop') {
                const pending = pendingToolCalls.get(event.index);
                if (pending) {
                    pendingToolCalls.delete(event.index);
                    let args = {};
                    // Escaping varies by model, so always parse rather than string-match.
                    try { args = pending.json ? JSON.parse(pending.json) : {}; } catch { args = {}; }
                    yield { toolCalls: [{ name: pending.name, args }] };
                }
            } else if (event.type === 'message_start') {
                const usage = usageOf(event.message?.usage);
                if (usage) yield { usage };
            } else if (event.type === 'message_delta' && event.usage) {
                yield { usage: { inputTokens: 0, outputTokens: event.usage.output_tokens ?? 0 } };
            }
        }
    }

    return {
        id: 'anthropic',

        async *streamChat({ model, system, messages, tools, effort, maxOutputTokens }) {
            const request = buildRequest(model, effort, maxOutputTokens ?? 8192, {
                ...(system ? { system } : {}),
                messages: toMessages(messages),
                ...(toAnthropicTools(tools) ? { tools: toAnthropicTools(tools) } : {}),
            });
            yield* streamRequest(request);
        },

        async *streamJson({ model, system, prompt, schema, effort, maxOutputTokens }) {
            const request = buildRequest(model, effort, maxOutputTokens ?? 16000, {
                ...(system ? { system } : {}),
                messages: [{ role: 'user', content: prompt }],
                ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
            });
            yield* streamRequest(request);
        },

        async generateJson({ model, system, prompt, schema, effort, maxOutputTokens }) {
            let text = '';
            let usage = { inputTokens: 0, outputTokens: 0 };
            for await (const event of this.streamJson({ model, system, prompt, schema, effort, maxOutputTokens })) {
                if (event.text) text += event.text;
                if (event.usage) {
                    usage = {
                        inputTokens: event.usage.inputTokens || usage.inputTokens,
                        outputTokens: event.usage.outputTokens || usage.outputTokens,
                    };
                }
            }
            return { object: JSON.parse(text), usage };
        },

        async generateText({ model, prompt, maxOutputTokens }) {
            const response = await client.messages.create(
                buildRequest(model, 'low', maxOutputTokens ?? 4096, { messages: [{ role: 'user', content: prompt }] }),
            );
            const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
            return { text, usage: usageOf(response.usage) };
        },
    };
};
