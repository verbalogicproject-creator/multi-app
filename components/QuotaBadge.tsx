import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import * as apiService from '../services/apiService';
import type { CatalogModel, QuotaSnapshot } from '../services/apiService';

/** Which model a given surface would actually use, honouring the picker. */
export const modelForSurface = (
    defaults: Record<string, string> | undefined,
    selectedModel: string,
    surface: 'chat' | 'builder',
): string => {
    if (selectedModel !== 'auto') return selectedModel;
    return defaults?.[surface] ?? (surface === 'builder' ? 'gemini-3.7-flash' : 'gemini-3.5-flash');
};

/** Free-tier requests left today, or null when the model has no request ceiling. */
export const remainingFor = (quota: QuotaSnapshot | null, model: string): number | null => {
    const limit = quota?.limits?.[model];
    if (typeof limit !== 'number') return null;
    return Math.max(0, limit - (quota?.counts?.[model] ?? 0));
};

/** Approximate USD spent today on a paid model. */
export const spentOn = (quota: QuotaSnapshot | null, entry: CatalogModel | undefined): number => {
    if (!entry) return 0;
    const used = quota?.tokens?.[entry.id];
    if (!used) return 0;
    return (used.in / 1e6) * entry.priceIn + (used.out / 1e6) * entry.priceOut;
};

const money = (usd: number) => usd >= 0.01 ? `$${usd.toFixed(2)}` : usd > 0 ? '<$0.01' : '$0.00';

interface QuotaBadgeProps {
    surface?: 'chat' | 'builder';
    className?: string;
}

/**
 * Free-tier models show requests left (the 20/day builder model is easy to
 * exhaust unknowingly); paid models show what they have cost today instead,
 * since they have spend rather than a request ceiling.
 */
const QuotaBadge: React.FC<QuotaBadgeProps> = ({ surface = 'chat', className }) => {
    const { selectedModel, quotaTick, catalog, modelDefaults } = useAppContext();
    const [quota, setQuota] = useState<QuotaSnapshot | null>(null);

    useEffect(() => {
        let cancelled = false;
        apiService.getQuota().then(snapshot => { if (!cancelled) setQuota(snapshot); });
        return () => { cancelled = true; };
    }, [quotaTick]);

    if (!quota) return null;

    const modelId = modelForSurface(modelDefaults, selectedModel, surface);
    const entry = catalog.find(m => m.id === modelId);
    const label = entry?.label ?? modelId.replace(/^gemini-/, '').replace(/-preview$/, '');
    const base = 'text-[11px] px-2 py-1 rounded-md border whitespace-nowrap';

    if (entry?.paid) {
        const spent = spentOn(quota, entry);
        const calls = quota.counts?.[modelId] ?? 0;
        return (
            <span
                className={className ?? `${base} text-gray-400 border-gray-600`}
                title={`${calls} request${calls === 1 ? '' : 's'} today on ${modelId}, roughly ${money(spent)} at $${entry.priceIn}/$${entry.priceOut} per 1M tokens. Estimate only.`}
            >
                {label} · ~{money(spent)} today
            </span>
        );
    }

    const left = remainingFor(quota, modelId);
    if (left === null) return null;

    const tone = left === 0 ? 'text-red-400 border-red-500/40'
        : left <= 3 ? 'text-amber-400 border-amber-500/40'
        : 'text-gray-400 border-gray-600';

    return (
        <span
            className={className ?? `${base} ${tone}`}
            title={`${quota.counts[modelId] ?? 0} of ~${quota.limits[modelId]} free-tier requests used today for ${modelId} (resets daily).`}
        >
            {label} · {left} left
        </span>
    );
};

export default QuotaBadge;
