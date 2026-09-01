import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import * as apiService from '../services/apiService';
import type { QuotaSnapshot } from '../services/apiService';

/** Which model a given surface would actually use, honouring the picker. */
export const modelForSurface = (quota: QuotaSnapshot | null, selectedModel: string, surface: 'chat' | 'builder'): string => {
    if (selectedModel !== 'auto') return selectedModel;
    return quota?.models?.[surface] ?? (surface === 'builder' ? 'gemini-3.7-flash' : 'gemini-3.5-flash');
};

export const remainingFor = (quota: QuotaSnapshot | null, model: string): number | null => {
    const limit = quota?.limits?.[model];
    if (typeof limit !== 'number') return null;
    return Math.max(0, limit - (quota?.counts?.[model] ?? 0));
};

const shortName = (model: string) => model.replace(/^gemini-/, '').replace(/-preview$/, '');

interface QuotaBadgeProps {
    surface?: 'chat' | 'builder';
    className?: string;
}

/**
 * Shows how many requests today's free-tier budget has left for the model this
 * surface would use — the 20/day builder model is easy to exhaust unknowingly.
 */
const QuotaBadge: React.FC<QuotaBadgeProps> = ({ surface = 'chat', className }) => {
    const { selectedModel, quotaTick } = useAppContext();
    const [quota, setQuota] = useState<QuotaSnapshot | null>(null);

    useEffect(() => {
        let cancelled = false;
        apiService.getQuota().then(snapshot => { if (!cancelled) setQuota(snapshot); });
        return () => { cancelled = true; };
    }, [quotaTick]);

    if (!quota) return null;

    const model = modelForSurface(quota, selectedModel, surface);
    const left = remainingFor(quota, model);
    if (left === null) return null;

    const limit = quota.limits[model];
    const tone = left === 0 ? 'text-red-400 border-red-500/40'
        : left <= 3 ? 'text-amber-400 border-amber-500/40'
        : 'text-gray-400 border-gray-600';

    return (
        <span
            className={className ?? `text-[11px] px-2 py-1 rounded-md border whitespace-nowrap ${tone}`}
            title={`${quota.counts[model] ?? 0} of ~${limit} free-tier requests used today for ${model} (resets daily).`}
        >
            {shortName(model)} · {left} left
        </span>
    );
};

export default QuotaBadge;
