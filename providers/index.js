import { createGoogleProvider } from './google.js';
import { CATALOG, PROVIDER_KEYS, PROVIDER_LABELS, getModel, isProviderEnabled } from './catalog.js';

// Lazily constructed provider clients, keyed by provider id. Only providers with
// a configured key are ever instantiated, so a missing OPENAI_API_KEY simply
// means those models are absent from the picker rather than a startup failure.

const FACTORIES = {
    google: createGoogleProvider,
    // anthropic / openai / nvidia are registered as their adapters land.
};

const instances = new Map();

export const getProvider = (providerId) => {
    if (instances.has(providerId)) return instances.get(providerId);

    const factory = FACTORIES[providerId];
    if (!factory) throw new Error(`No adapter is registered for provider "${providerId}".`);

    const apiKey = PROVIDER_KEYS[providerId]?.();
    if (!apiKey) throw new Error(`${PROVIDER_LABELS[providerId] ?? providerId} is not configured (missing API key).`);

    const instance = factory({ apiKey });
    instances.set(providerId, instance);
    return instance;
};

/** Resolves a model id to the adapter that serves it. */
export const providerForModel = (modelId) => {
    const entry = getModel(modelId);
    if (!entry) throw new Error(`Unknown model "${modelId}".`);
    return getProvider(entry.provider);
};

/** True when an adapter exists AND the provider is configured. */
export const isModelUsable = (modelId) => {
    const entry = getModel(modelId);
    return Boolean(entry && FACTORIES[entry.provider] && isProviderEnabled(entry.provider));
};

/** Catalog view for the client: only models that are actually callable right now. */
export const usableModels = () => CATALOG.filter(e => isModelUsable(e.id)).map(e => ({
    id: e.id,
    provider: e.provider,
    providerLabel: PROVIDER_LABELS[e.provider] ?? e.provider,
    label: e.label,
    hint: e.hint,
    thinking: e.thinking,
    tools: e.tools,
    priceIn: e.priceIn,
    priceOut: e.priceOut,
    dailyLimit: e.dailyLimit ?? null,
    paid: e.priceIn > 0 || e.priceOut > 0,
}));

export { PROVIDER_LABELS };
