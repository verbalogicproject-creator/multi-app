// Live per-provider contract tests. Deliberately uses only the cheapest model of
// each provider — expensive tiers share the same code path.
import 'dotenv/config';
import { providerForModel } from '../providers/index.js';
import { toolsForRequest } from '../providers/tools.js';
import { PLAN_SCHEMA } from '../providers/schemas.js';
import { buildSystemPrompt, builderPreamble } from '../providers/prompts.js';
import { getModel } from '../providers/catalog.js';

const MODELS = process.argv.slice(2);
if (!MODELS.length) {
    console.error('usage: node scripts/smoke-providers.mjs <model-id> [<model-id>...]');
    process.exit(2);
}

let failures = 0;
const pass = (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const fail = (m) => { console.log(`  \x1b[31m✘\x1b[0m ${m}`); failures++; };

for (const model of MODELS) {
    const entry = getModel(model);
    console.log(`\n=== ${model} (${entry?.provider ?? 'unknown'}) ===`);
    if (!entry) { fail('not in catalog'); continue; }
    const provider = providerForModel(model);
    const system = buildSystemPrompt({ provider: entry.provider, persona: { baseInstructions: '', composedStyles: [] }, projects: [], customStyles: [] });

    // 1. streaming text + usage
    try {
        let text = '', thinking = 0, usage = null;
        for await (const e of provider.streamChat({
            model, system, messages: [{ author: 'user', parts: [{ text: 'Reply with exactly: STREAM-OK' }] }],
            tools: [], effort: 'low', maxOutputTokens: 2048,
        })) {
            if (e.text) text += e.text;
            if (e.thinking) thinking += e.thinking.length;
            if (e.usage) usage = { in: (usage?.in ?? 0) + e.usage.inputTokens, out: Math.max(usage?.out ?? 0, e.usage.outputTokens) };
        }
        text.includes('STREAM-OK') ? pass(`stream text (thinking ${thinking}c, usage in=${usage?.in} out=${usage?.out})`)
                                   : fail(`stream text -> "${text.trim().slice(0, 40)}"`);
        if (!usage) fail('no usage reported (cost tracking would be blind)');
    } catch (e) { fail(`stream: ${String(e.message).replace(/\s+/g, ' ').slice(0, 110)}`); }

    // 2. tool call emitted
    let toolCall = null;
    try {
        for await (const e of provider.streamChat({
            model, system, messages: [{ author: 'user', parts: [{ text: 'Look up the npm package "react" using the searchNpm tool.' }] }],
            tools: toolsForRequest(false), effort: 'low', maxOutputTokens: 2048,
        })) {
            if (e.toolCalls?.length) toolCall = e.toolCalls[0];
        }
        toolCall ? pass(`tool call: ${toolCall.name}(${JSON.stringify(toolCall.args)})`) : fail('no tool call emitted');
    } catch (e) { fail(`tools: ${String(e.message).replace(/\s+/g, ' ').slice(0, 110)}`); }

    // 3. tool RESULT round-trip — the history shape that breaks most adapters
    if (toolCall) {
        try {
            let text = '';
            for await (const e of provider.streamChat({
                model, system,
                messages: [
                    { author: 'user', parts: [{ text: 'Look up the npm package "react" using the searchNpm tool.' }] },
                    { author: 'assistant', parts: [{ text: '' }], toolCall },
                    { author: 'tool', parts: [], toolResponse: { name: toolCall.name, response: { content: [{ name: 'react', version: '19.2.8' }] } } },
                    { author: 'user', parts: [{ text: 'What version did the tool report? Reply with the number only.' }] },
                ],
                tools: toolsForRequest(false), effort: 'low', maxOutputTokens: 2048,
            })) {
                if (e.text) text += e.text;
            }
            text.includes('19.2.8') ? pass('tool result round-trip (model read the result back)')
                                    : fail(`tool result round-trip -> "${text.trim().slice(0, 50)}"`);
        } catch (e) { fail(`round-trip: ${String(e.message).replace(/\s+/g, ' ').slice(0, 110)}`); }
    }

    // 4. schema-constrained JSON
    try {
        const { object, usage } = await provider.generateJson({
            model, system: builderPreamble(entry.provider),
            prompt: 'Plan a one-page countdown timer app.',
            schema: PLAN_SCHEMA, effort: 'low', maxOutputTokens: 8192,
        });
        const ok = typeof object?.projectName === 'string' && Array.isArray(object?.pages) && Array.isArray(object?.acceptanceCriteria);
        ok ? pass(`schema JSON: "${object.projectName}", ${object.pages.length} pages, ${object.acceptanceCriteria.length} criteria (out=${usage?.outputTokens})`)
           : fail(`schema JSON shape: ${JSON.stringify(object).slice(0, 90)}`);
    } catch (e) { fail(`schema JSON: ${String(e.message).replace(/\s+/g, ' ').slice(0, 110)}`); }
}

console.log(failures === 0 ? '\n\x1b[32mALL PROVIDER CONTRACT TESTS PASSED\x1b[0m' : `\n\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`);
process.exit(failures === 0 ? 0 : 1);
