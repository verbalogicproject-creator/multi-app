// The single source of truth for selectable models. Adding a model is one entry
// here — no code changes elsewhere.
//
// Capability flags below were probed live against this account on 2026-09-01, not
// read from vendor docs. That matters most for NVIDIA: its /v1/models endpoint
// advertises 83 models, but many return `404 Not found for account` or time out,
// so only models with a verified successful call are listed.
//
// prices are USD per 1M tokens and APPROXIMATE — they drive a rough spend
// estimate in the UI, nothing billing-critical. Override with MODEL_PRICES (JSON).

/**
 * @typedef {object} CatalogEntry
 * @property {string} id            provider-native model id
 * @property {string} provider      google | anthropic | openai | nvidia
 * @property {string} label         short name for the picker
 * @property {string} hint          one line shown on hover
 * @property {boolean} tools        supports function calling
 * @property {'native'|'prompt'} jsonMode  schema-constrained output, or prompt+validate
 * @property {boolean} thinking     emits reasoning/thinking content
 * @property {number} priceIn       USD per 1M input tokens (0 = free tier)
 * @property {number} priceOut      USD per 1M output tokens
 * @property {number} [dailyLimit]  approximate free-tier request ceiling
 * @property {string[]} fallback    models to try when this one is overloaded
 */

/** @type {CatalogEntry[]} */
const ENTRIES = [
    // ---- Google (free tier; the daily driver) -------------------------------
    // `efforts` mirrors the documented thinking_level support per model: 3.7-flash
    // and 3.1-pro-preview reject MINIMAL, so `none` must clamp up to low there.
    { id: 'gemini-3.5-flash', provider: 'google', label: '3.5 Flash', hint: 'Fast, free tier — default for chat and coding', tools: true, jsonMode: 'native', thinking: true, efforts: ['none', 'low', 'medium', 'high'], priceIn: 0, priceOut: 0, dailyLimit: 250, fallback: ['gemini-3.5-flash-lite'] },
    { id: 'gemini-3.5-flash-lite', provider: 'google', label: '3.5 Flash-Lite', hint: 'Cheapest and fastest Gemini', tools: true, jsonMode: 'native', thinking: true, efforts: ['none', 'low', 'medium', 'high'], priceIn: 0, priceOut: 0, dailyLimit: 1000, fallback: [] },
    { id: 'gemini-3.7-flash', provider: 'google', label: '3.7 Flash', hint: 'Strong coding and agentic work — low daily quota', tools: true, jsonMode: 'native', thinking: true, efforts: ['low', 'medium', 'high'], priceIn: 0, priceOut: 0, dailyLimit: 20, fallback: ['gemini-3.5-flash'] },
    { id: 'gemini-3.1-pro-preview', provider: 'google', label: '3.1 Pro (preview)', hint: 'Deepest Gemini reasoning, slowest', tools: true, jsonMode: 'native', thinking: true, efforts: ['low', 'medium', 'high'], priceIn: 0, priceOut: 0, dailyLimit: 25, fallback: ['gemini-3.7-flash', 'gemini-3.5-flash'] },

    // ---- Anthropic (paid) ---------------------------------------------------
    // Structured output uses output_config.format; 5-gen models reject the legacy
    // thinking:{type:'enabled'} budget and require adaptive thinking + effort.
    { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', label: 'Haiku 4.5', hint: 'Fastest Claude, cheapest — good default for chat', tools: true, jsonMode: 'native', thinking: true, priceIn: 1, priceOut: 5, fallback: [] },
    { id: 'claude-sonnet-5', provider: 'anthropic', label: 'Sonnet 5', hint: 'Balanced speed and intelligence, 1M context', tools: true, jsonMode: 'native', thinking: true, priceIn: 3, priceOut: 15, fallback: ['claude-haiku-4-5-20251001'] },
    { id: 'claude-opus-5', provider: 'anthropic', label: 'Opus 5', hint: 'Strongest agentic coding — expensive', tools: true, jsonMode: 'native', thinking: true, priceIn: 15, priceOut: 75, fallback: ['claude-sonnet-5'] },
    { id: 'claude-fable-5', provider: 'anthropic', label: 'Fable 5', hint: 'Top-line capability, thinking always on — expensive', tools: true, jsonMode: 'native', thinking: true, priceIn: 15, priceOut: 75, fallback: ['claude-opus-5', 'claude-sonnet-5'] },

    // ---- OpenAI (paid) ------------------------------------------------------
    // Responses API; text.format json_schema strict and tools may be sent together
    // (verified). Reasoning effort none|low|medium|high (xhigh/max also exist).
    { id: 'gpt-5.6-luna', provider: 'openai', label: '5.6 Luna', hint: 'Fastest and cheapest GPT-5.6', tools: true, jsonMode: 'native', thinking: true, priceIn: 1, priceOut: 6, fallback: [] },
    { id: 'gpt-5.6-terra', provider: 'openai', label: '5.6 Terra', hint: 'Mid-tier GPT-5.6, balanced', tools: true, jsonMode: 'native', thinking: true, priceIn: 2.5, priceOut: 15, fallback: ['gpt-5.6-luna'] },
    { id: 'gpt-5.6-sol', provider: 'openai', label: '5.6 Sol', hint: 'Deepest OpenAI reasoning — expensive', tools: true, jsonMode: 'native', thinking: true, priceIn: 5, priceOut: 30, fallback: ['gpt-5.6-terra', 'gpt-5.6-luna'] },

    // ---- NVIDIA NIM (free credits) -----------------------------------------
    // OpenAI-compatible. Every entry below returned a successful live call on
    // 2026-09-01 with the measured latency noted. Models advertised by /v1/models
    // but unavailable to this account (404/410/timeout) are deliberately absent:
    // deepseek-v4-flash & -pro (timeout >120s), gpt-oss-20b/120b (timeout),
    // gemma-3-4b/12b, nemotron-70b, kimi-k2.6, mistral-* (404), qwen3-coder,
    // phi-4-mini (410 end-of-life).
    { id: 'meta/llama-3.2-11b-vision-instruct', provider: 'nvidia', label: 'Llama 3.2 11B', hint: 'Free, ~0.6s — fastest option for quick tests', tools: true, jsonMode: 'native', thinking: false, priceIn: 0, priceOut: 0, fallback: [] },
    { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', provider: 'nvidia', label: 'Nemotron Nano 3', hint: 'Free reasoning model, ~1.6s', tools: true, jsonMode: 'native', thinking: true, priceIn: 0, priceOut: 0, fallback: ['meta/llama-3.2-11b-vision-instruct'] },
    { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', provider: 'nvidia', label: 'Nemotron Lightning', hint: 'Free reasoning model, ~3.9s', tools: true, jsonMode: 'native', thinking: true, priceIn: 0, priceOut: 0, fallback: ['meta/llama-3.2-11b-vision-instruct'] },
    { id: 'minimaxai/minimax-m3', provider: 'nvidia', label: 'MiniMax M3', hint: 'Free, ~6s, JSON and tools', tools: true, jsonMode: 'native', thinking: false, priceIn: 0, priceOut: 0, fallback: ['meta/llama-3.2-11b-vision-instruct'] },
    { id: 'moonshotai/kimi-k3', provider: 'nvidia', label: 'Kimi K3', hint: 'Free, large context, reasoning — ~7s', tools: true, jsonMode: 'native', thinking: true, priceIn: 0, priceOut: 0, fallback: ['minimaxai/minimax-m3'] },
];

const PRICE_OVERRIDES = (() => {
    try { return process.env.MODEL_PRICES ? JSON.parse(process.env.MODEL_PRICES) : {}; }
    catch { console.warn('MODEL_PRICES is not valid JSON; ignoring.'); return {}; }
})();

export const PROVIDER_LABELS = { google: 'Google Gemini', anthropic: 'Anthropic Claude', openai: 'OpenAI', nvidia: 'NVIDIA (free)' };

/** Provider -> env var holding its key. A provider with no key is hidden entirely. */
export const PROVIDER_KEYS = {
    google: () => process.env.GEMINI_API_KEY || process.env.API_KEY,
    anthropic: () => process.env.ANTHROPIC_API_KEY,
    openai: () => process.env.OPENAI_API_KEY,
    nvidia: () => process.env.NVIDIA_API_KEY,
};

export const isProviderEnabled = (provider) => Boolean(PROVIDER_KEYS[provider]?.());

export const CATALOG = ENTRIES.map(e => ({ ...e, ...(PRICE_OVERRIDES[e.id] ?? {}) }));

const BY_ID = new Map(CATALOG.map(e => [e.id, e]));

export const getModel = (id) => BY_ID.get(id) ?? null;

/** Reasoning efforts a model accepts; empty means "all of them". */
export const supportedEfforts = (id) => BY_ID.get(id)?.efforts ?? [];

/** Catalog entries whose provider has a key configured. */
export const enabledModels = () => CATALOG.filter(e => isProviderEnabled(e.provider));

export const isSelectable = (id) => {
    const entry = BY_ID.get(id);
    return Boolean(entry && isProviderEnabled(entry.provider));
};

/** Resolves a requested model to a usable one, falling back to the surface default. */
export const pickModel = (requested, fallbackId) => isSelectable(requested) ? requested : fallbackId;

/**
 * Ordered attempt list for a model: itself, its declared fallbacks, then the
 * surface default — deduped, and filtered to providers that are configured.
 */
export const modelChain = (modelId, defaultId) => {
    const chain = [modelId, ...(getModel(modelId)?.fallback ?? []), defaultId, ...(getModel(defaultId)?.fallback ?? [])];
    return [...new Set(chain)].filter(id => id && isSelectable(id));
};

export const isPaid = (id) => {
    const entry = getModel(id);
    return Boolean(entry && (entry.priceIn > 0 || entry.priceOut > 0));
};

/** Rough USD cost of a call, for the spend estimate shown before expensive runs. */
export const estimateCost = (id, inputTokens, outputTokens) => {
    const entry = getModel(id);
    if (!entry) return 0;
    return (inputTokens / 1e6) * entry.priceIn + (outputTokens / 1e6) * entry.priceOut;
};
