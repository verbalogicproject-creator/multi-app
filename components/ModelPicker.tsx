import React from 'react';
import { useAppContext } from '../context/AppContext';
import type { CatalogModel } from '../services/apiService';

const AUTO_HINT = 'Recommended defaults: a fast model for chat, a stronger one for the builder';

/** "$1 / $6 per 1M" for paid models, "free" otherwise. */
const priceLabel = (model: CatalogModel) =>
    model.paid ? `$${model.priceIn} in / $${model.priceOut} out per 1M tokens` : 'free tier';

const ModelPicker: React.FC<{ compact?: boolean }> = ({ compact }) => {
    const { selectedModel, setSelectedModel, catalog } = useAppContext();

    const current = catalog.find(m => m.id === selectedModel);
    const title = current ? `${current.hint} — ${priceLabel(current)}` : AUTO_HINT;

    // Preserve catalog order within each provider; the backend already orders
    // them cheapest/fastest first.
    const groups: { label: string; models: CatalogModel[] }[] = [];
    for (const model of catalog) {
        const group = groups.find(g => g.label === model.providerLabel);
        if (group) group.models.push(model);
        else groups.push({ label: model.providerLabel, models: [model] });
    }

    return (
        <label className={`flex items-center gap-2 ${compact ? '' : 'justify-center'}`} title={title}>
            <span className="hidden md:inline text-xs text-metal-300 whitespace-nowrap">Model</span>
            <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                className="tap bg-raised hairline text-metal-100 text-xs rounded-md px-2 max-w-[9rem] md:max-w-[13rem] focus:outline-none"
            >
                <option value="auto" title={AUTO_HINT}>Auto</option>
                {groups.map(group => (
                    <optgroup key={group.label} label={group.label}>
                        {group.models.map(model => (
                            <option key={model.id} value={model.id} title={`${model.hint} — ${priceLabel(model)}`}>
                                {model.label}{model.paid ? ' · $' : ''}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
        </label>
    );
};

export default ModelPicker;
