// One internal reasoning scale mapped onto four providers whose units disagree:
// Anthropic uses an effort enum (5-gen) or a token budget (4.5-gen), OpenAI an
// effort enum, Gemini a thinking level, NVIDIA a boolean toggle plus headroom.

/** @typedef {'none'|'low'|'medium'|'high'} Effort */

export const EFFORTS = ['none', 'low', 'medium', 'high'];
export const DEFAULT_EFFORT = 'medium';

export const normalizeEffort = (value) => EFFORTS.includes(value) ? value : DEFAULT_EFFORT;

/**
 * Clamps an effort to what a model actually accepts. Support is not uniform even
 * within one provider — gemini-3.7-flash and 3.1-pro-preview reject the MINIMAL
 * thinking level that the flash models allow — and an unsupported level is a hard
 * 400, not a silent downgrade.
 */
export const clampEffort = (effort, supported) => {
    const wanted = normalizeEffort(effort);
    if (!supported?.length || supported.includes(wanted)) return wanted;
    // Walk up to the next supported level, then down, so we never silently
    // spend far more reasoning than asked for without exhausting cheaper options.
    const order = EFFORTS.slice(EFFORTS.indexOf(wanted) + 1).concat(EFFORTS.slice(0, EFFORTS.indexOf(wanted)).reverse());
    return order.find(e => supported.includes(e)) ?? supported[0];
};

/**
 * Gemini 3.x replaced numeric budgets with thinkingLevel; sending the legacy
 * `thinkingBudget` (including 0 to disable) is rejected as an invalid argument,
 * so `none` maps to the MINIMAL level rather than a zero budget.
 */
export const geminiThinking = (effort) =>
    ({ none: { thinkingLevel: 'MINIMAL' }, low: { thinkingLevel: 'LOW' }, medium: { thinkingLevel: 'MEDIUM' }, high: { thinkingLevel: 'HIGH' } }[effort]);

/** Anthropic 5-gen: adaptive thinking + effort. There is no way to disable thinking, so `none` maps to the lowest effort. */
export const anthropicEffort = (effort) => ({ low: 'low', medium: 'medium', high: 'high', none: 'low' }[effort]);

/**
 * Anthropic 4.5-gen (haiku-4-5) still uses manual budgets, which must be >= 1024
 * and strictly less than max_tokens.
 */
export const anthropicBudget = (effort, maxTokens) => {
    if (effort === 'none') return null;
    const wanted = { low: 1024, medium: 4096, high: 16384 }[effort];
    const ceiling = Math.max(1024, Math.floor(maxTokens * 0.6));
    return Math.min(wanted, ceiling);
};

/** OpenAI exposes none/low/medium/high/xhigh/max; we use the lower four. */
export const openaiEffort = (effort) => effort;

/**
 * NVIDIA reasoning models emit reasoning_content before content, and a tight
 * max_tokens lets reasoning consume the whole completion budget — leaving the
 * answer empty. NVIDIA's own model cards size max_tokens above the reasoning
 * budget plus a grace period, so we add headroom rather than trusting the caller.
 */
export const nvidiaReasoning = (effort, maxTokens) => {
    if (effort === 'none') return { enableThinking: false, maxTokens };
    const headroom = { low: 2048, medium: 8192, high: 16384 }[effort];
    return { enableThinking: true, maxTokens: maxTokens + headroom };
};
