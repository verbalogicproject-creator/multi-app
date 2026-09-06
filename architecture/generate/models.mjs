#!/usr/bin/env node
// Generates ../models-adapters.json directly from providers/catalog.js.
//
// Why this exists as a generator and not a hand-typed file: README.md's provider
// table (3.5 Flash, 3.5 Flash-Lite, 3.7 Flash, 3.1 Pro) was already missing two
// models (3.6 Flash, 3.8 Flash) that catalog.js actually has, found by diffing the
// two by hand during the architecture audit. A hand-typed second copy of the
// catalog will drift again the next time a model is added. This script is the
// fix: the catalog section below is *imported*, never retyped.
//
// Run: node architecture/generate/models.mjs
// Verify (no write, exit 1 on drift): node architecture/generate/models.mjs --verify

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    CATALOG,
    PROVIDER_LABELS,
    isProviderEnabled,
} from '../../providers/catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'models-adapters.json');
const ROOT = path.join(__dirname, '..', '..');

// --- Hand-authored declarations: what mechanically-generated catalog data can't
// say for itself. Each cites the file:line where the mechanism actually lives, so
// this list is checkable against the source it describes rather than trusted on
// its own authority. Update this array in the same commit that changes the cited
// line, per HARNESS.md's own rule for its declaration table.
const ADAPTER_QUIRKS = [
    {
        provider: 'google',
        statement: 'Gemini 3.x rejects the legacy thinkingBudget field (including 0 to disable); effort maps to a thinkingLevel enum instead, and "none" maps to MINIMAL rather than a zero budget.',
        mechanism: { file: 'providers/effort.js', line: 30, note: 'geminiThinking()' },
        level: 'gate',
    },
    {
        provider: 'google',
        statement: 'gemini-3.7-flash and gemini-3.1-pro-preview reject the MINIMAL thinking level that the flash models accept; an unsupported level is a hard 400, not a silent downgrade, so effort is clamped to the nearest supported level before the request is sent.',
        mechanism: { file: 'providers/effort.js', line: 19, note: 'clampEffort()' },
        level: 'gate',
    },
    {
        provider: 'anthropic',
        statement: '5-gen Claude models (sonnet-5, opus-5, fable-5) require adaptive thinking plus output_config.effort; the legacy {type:"enabled", budget_tokens} form is rejected with a 400.',
        mechanism: { file: 'providers/anthropic.js', line: 8, note: 'reasoningFor()' },
        level: 'gate',
    },
    {
        provider: 'anthropic',
        statement: 'claude-haiku-4-5 is the reverse of the 5-gen models: output_config.effort itself returns a 400 ("does not support the effort parameter"), so it needs a manual budget_tokens instead.',
        mechanism: { file: 'providers/anthropic.js', line: 10, note: 'reasoningFor()' },
        level: 'gate',
    },
    {
        provider: 'anthropic',
        statement: 'claude-fable-5 has thinking always on; no thinking config is sent for it at all.',
        mechanism: { file: 'providers/anthropic.js', line: 68, note: 'reasoningFor(), style === "always-on"' },
        level: 'lint',
    },
    {
        provider: 'openai',
        statement: 'The OpenAI adapter is built on the Responses API, not Chat Completions; "none" is a real, unclamped effort level there.',
        mechanism: { file: 'providers/openai.js', line: 5, note: "requestFor(), reasoning: { effort: normalizeEffort(effort) }" },
        level: 'gate',
    },
    {
        provider: 'nvidia',
        statement: 'NVIDIA reasoning models emit reasoning_content before content; a tight max_tokens lets reasoning consume the whole completion budget and starve the actual answer, so reasoning needs extra headroom.',
        mechanism: { file: 'providers/nvidia.js', line: 9, note: 'header comment + streamChat()' },
        level: 'gap',
    },
    {
        provider: 'nvidia',
        statement: 'NVIDIA models cannot be constrained to a JSON schema server-side (no schema-constrained decoding); response_format:{type:"json_object"} only guarantees syntactic JSON, so the schema is described in the prompt text instead and validated after the fact.',
        mechanism: { file: 'providers/nvidia.js', line: 112, note: 'schemaPrompt()' },
        level: 'gap',
    },
    {
        provider: 'all',
        statement: 'Effort support is not uniform even within one provider; an unsupported level is a hard 400 for every adapter, never a graceful degrade, which is why every adapter calls clampEffort before sending a request.',
        mechanism: { file: 'providers/effort.js', line: 12, note: 'clampEffort()' },
        level: 'lint',
    },
];

// --- The local on-device RAG stack (Termux/llama.cpp), reported by the user for
// the planned memory-recall upgrade. Nothing in this repo calls these ports yet —
// labelled `gap`/`planned`, never `mechanism`, because there is no code here to
// cite. See memory-system-ladder.json for how this connects to the lesson ladder.
const LOCAL_RAG_STACK = {
    status: 'planned — not wired into providers/ or memory/ yet',
    purpose: 'On-device semantic recall for the graph-memory lesson ladder (embedding-based, replacing/augmenting the current rule/keyword-based lookup in memory/proposals.js).',
    runtime: 'llama.cpp servers on Termux/Android, on-device, no cloud call',
    components: [
        { role: 'generator', model: 'qwen2.5-3b-instruct-q4_0', ctx: 16384, cacheReuse: 512, endpoint: '127.0.0.1:8147', backend: 'HTP0' },
        { role: 'reranker', model: 'bge-reranker-v2-m3-q8', batch: 2048, endpoint: '127.0.0.1:8144', backend: 'HTP0' },
        { role: 'embedder', model: 'embeddinggemma-300m-q8', ctx: 4096, batch: 1024, endpoint: '127.0.0.1:8145', backend: 'GPUOpenCL' },
        { role: 'classifier', note: 'local proxy fanning out to the reranker', endpoint: '127.0.0.1:8148' },
    ],
    recommendedSampling: { temperature: 0.7, topP: 0.8, topK: 20, note: 'Qwen official guidance; native context 32K' },
    mechanism: null,
    level: 'gap',
};

function buildCatalog() {
    const providers = Object.keys(PROVIDER_LABELS).map((id) => ({
        id,
        label: PROVIDER_LABELS[id],
        enabledOnThisMachine: isProviderEnabled(id),
        adapterFile: `providers/${id}.js`,
        modelCount: CATALOG.filter((m) => m.provider === id).length,
        models: CATALOG.filter((m) => m.provider === id),
    }));

    return {
        $schema: 'declaration-v1',
        generatedBy: 'architecture/generate/models.mjs',
        generatedFrom: 'providers/catalog.js (CATALOG, PROVIDER_LABELS, isProviderEnabled — imported directly, not retyped)',
        note: 'Do not hand-edit the "providers" section below; re-run the generator instead. Hand-edit ADAPTER_QUIRKS and LOCAL_RAG_STACK in generate/models.mjs, then re-run.',
        providers,
        adapterQuirks: ADAPTER_QUIRKS,
        localRagStack: LOCAL_RAG_STACK,
    };
}

const output = buildCatalog();
const json = JSON.stringify(output, null, 2) + '\n';

if (process.argv.includes('--verify')) {
    if (!existsSync(OUT)) {
        console.error('FAIL models-adapters.json does not exist — run without --verify first');
        process.exit(1);
    }
    const onDisk = readFileSync(OUT, 'utf8');
    if (onDisk === json) {
        console.log('ok models-adapters.json matches providers/catalog.js');
        process.exit(0);
    }
    console.error('FAIL models-adapters.json is stale against providers/catalog.js — re-run: node architecture/generate/models.mjs');
    process.exit(1);
}

writeFileSync(OUT, json);
console.log(`wrote ${path.relative(ROOT, OUT)} (${output.providers.reduce((n, p) => n + p.modelCount, 0)} models across ${output.providers.length} providers)`);
