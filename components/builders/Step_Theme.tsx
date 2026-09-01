import React from 'react';
import { useAppContext } from '../../context/AppContext';
import ModelPicker from '../ModelPicker';
import QuotaBadge, { modelForSurface, remainingFor } from '../QuotaBadge';
import DesignContractPreview from './DesignContractPreview';
import * as apiService from '../../services/apiService';
import {
    PALETTES, TYPOGRAPHY_OPTIONS, COLOR_ROLES, CUSTOM_PALETTE_NAME,
    findTypography, resolveThemeColors, sanitizeColors,
    type ThemeColors, type ArtDirection,
} from '../../utils/palettes';

const SwatchStrip: React.FC<{ colors: ThemeColors }> = ({ colors }) => (
    <div className="flex h-11 rounded-md overflow-hidden">
        <div className="w-1/3" style={{ background: colors.bg }} />
        <div className="w-1/3" style={{ background: colors.surface }} />
        <div className="flex-1 flex">
            <div className="flex-1" style={{ background: colors.primary }} />
            <div className="flex-1" style={{ background: colors.accent }} />
        </div>
    </div>
);

/**
 * Selection is state you caused, not something that needs you — so it is carried
 * by value and weight, never by the accent. Orange on this screen would mean the
 * builder wanted something, and choosing a palette is not that.
 */
const tile = (selected: boolean) =>
    [
        'p-3 rounded-[--radius-card] text-left tap',
        'transition-[background-color,box-shadow] duration-200 ease-[--ease-fluid]',
        'active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100',
        selected
            ? 'bg-raised shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]'
            : 'bg-white/[0.04] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)] md:hover:bg-white/[0.07]',
    ].join(' ');

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-3">{children}</h3>
);

const Step_Theme: React.FC = () => {
    const { builderState, setBuilderState, generateWebAppCode, suggestArtDirections, noteDirectionSelected, selectedModel, catalog, modelDefaults } = useAppContext();
    const { theme, plan, status, artDirections } = builderState;

    // Generation is by far the most expensive action here: it is the one call that
    // can run to tens of thousands of output tokens. Warn either when a free-tier
    // budget is nearly spent, or when the run will actually cost money.
    const handleGenerate = async () => {
        const quota = await apiService.getQuota();
        const modelId = modelForSurface(modelDefaults, selectedModel, 'builder');
        const entry = catalog.find(m => m.id === modelId);

        if (entry?.paid) {
            // A full project generation is typically 50-80K output tokens.
            const estimate = (70000 / 1e6) * entry.priceOut + (4000 / 1e6) * entry.priceIn;
            const shown = estimate >= 0.01 ? `about $${estimate.toFixed(2)}` : 'under $0.01';
            if (!window.confirm(`${entry.label} is a paid model. Generating a full project will cost ${shown} (rough estimate). Continue?`)) return;
        } else {
            const left = remainingFor(quota, modelId);
            if (left !== null && left <= 2) {
                const message = left === 0
                    ? `Today's free-tier budget for ${modelId} looks used up, so this will probably fail. Try anyway?`
                    : `Only ${left} free-tier request${left === 1 ? '' : 's'} left today for ${modelId}. Generate anyway?`;
                if (!window.confirm(message)) return;
            }
        }
        generateWebAppCode();
    };

    const colors = resolveThemeColors(theme);
    const typography = findTypography(theme.typography);
    const isBusy = status.isLoading;

    const selectPalette = (name: string, paletteColors: ThemeColors) =>
        setBuilderState(prev => ({ ...prev, theme: { ...prev.theme, palette: name, colors: paletteColors } }));

    const updateColor = (role: keyof ThemeColors, value: string) =>
        setBuilderState(prev => ({
            ...prev,
            theme: {
                ...prev.theme,
                palette: CUSTOM_PALETTE_NAME,
                colors: sanitizeColors({ ...resolveThemeColors(prev.theme), [role]: value }),
            },
        }));

    const selectTypography = (name: string) =>
        setBuilderState(prev => ({ ...prev, theme: { ...prev.theme, typography: name } }));

    const applyDirection = (direction: ArtDirection, index: number) => {
        // Which of the three proposals actually won — the only place that is knowable.
        noteDirectionSelected(direction, index);
        setBuilderState(prev => ({
            ...prev,
            theme: {
                ...prev.theme,
                palette: direction.name,
                colors: direction.colors,
                typography: findTypography(direction.typography).name,
            },
        }));
    };

    return (
        <div className="w-full max-w-4xl mx-auto px-4 md:px-6 py-10 md:py-14">
            <h2 className="font-display text-2xl md:text-3xl tracking-[-0.03em] text-metal-100 text-center">
                Choose a Visual Style
            </h2>
            <p className="mt-2 text-center text-metal-300 text-sm max-w-lg mx-auto">
                Pick a palette and type, or let the AI propose directions. The preview below is exactly what the generator is told to build.
            </p>

            {/* Palettes */}
            <div className="mt-8 md:mt-10">
                <SectionLabel>Colour palette</SectionLabel>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                    {PALETTES.map(palette => (
                        <button key={palette.name} disabled={isBusy} onClick={() => selectPalette(palette.name, palette.colors)}
                            aria-pressed={theme.palette === palette.name}
                            className={tile(theme.palette === palette.name)}>
                            <SwatchStrip colors={palette.colors} />
                            <p className="mt-2 text-xs font-medium text-metal-200 truncate">{palette.name}</p>
                        </button>
                    ))}
                </div>
            </div>

            {/* Custom colours */}
            <div className="mt-6 p-5 md:p-6 rounded-[--radius-card] bg-surface hairline">
                <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300">
                    Custom colours
                    {theme.palette === CUSTOM_PALETTE_NAME && (
                        <span className="ml-2 normal-case tracking-normal text-metal-200 font-normal">· active</span>
                    )}
                </h3>
                <p className="text-xs text-metal-400 mt-2 mb-4">
                    Adjust any role to switch to a custom palette. These exact values are handed to the code generator.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {COLOR_ROLES.map(role => (
                        <label key={role.key} className="flex items-center gap-3 cursor-pointer" title={role.hint}>
                            <input
                                type="color"
                                value={colors[role.key]}
                                disabled={isBusy}
                                onChange={e => updateColor(role.key, e.target.value)}
                                aria-label={role.label}
                                className="w-11 h-11 shrink-0 bg-transparent rounded-lg cursor-pointer
                                           shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)] disabled:opacity-40"
                            />
                            <span className="min-w-0">
                                <span className="block text-xs text-metal-200">{role.label}</span>
                                <span className="block text-[11px] text-metal-400 font-mono">{colors[role.key]}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </div>

            {/* Typography */}
            <div className="mt-6">
                <SectionLabel>Typography</SectionLabel>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {TYPOGRAPHY_OPTIONS.map(option => (
                        <button key={option.name} disabled={isBusy} onClick={() => selectTypography(option.name)}
                            aria-pressed={theme.typography === option.name}
                            className={tile(theme.typography === option.name)}>
                            <span className="block text-2xl text-metal-100" style={{
                                fontFamily: option.headingFamily,
                                fontWeight: option.headingWeight,
                                textTransform: option.headingTransform,
                                letterSpacing: option.headingSpacing,
                            }}>Aa</span>
                            <span className="block mt-1 text-[11px] text-metal-300 leading-tight">{option.name}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Live design contract — a hero surface, so it earns the bezel */}
            <div className="mt-8 md:mt-10">
                <SectionLabel>Design preview</SectionLabel>
                <div className="bezel-shell">
                    <div className="bezel-core overflow-hidden">
                        <DesignContractPreview colors={colors} typography={typography} projectName={plan?.projectName} />
                    </div>
                </div>
            </div>

            {/* AI art directions */}
            <div className="mt-8 md:mt-10 p-5 md:p-6 rounded-[--radius-card] bg-surface hairline">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex-1 min-w-[12rem]">
                        <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300">AI art directions</h3>
                        <p className="text-xs text-metal-400 mt-2">Three distinct directions tailored to your plan. Costs one model request.</p>
                    </div>
                    <button onClick={suggestArtDirections} disabled={isBusy}
                        className="tap px-5 rounded-lg bg-metal-700 text-metal-100 text-sm font-medium
                                   shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                                   transition-[background-color,transform] duration-200 ease-[--ease-fluid]
                                   md:hover:bg-[#33333a] active:scale-[0.98]
                                   disabled:opacity-40 disabled:active:scale-100">
                        {isBusy && status.message.includes('art direction') ? 'Exploring…' : artDirections ? 'Suggest again' : 'Suggest 3 directions'}
                    </button>
                </div>

                {artDirections && artDirections.length > 0 && (
                    <div className="mt-5 grid md:grid-cols-3 gap-4">
                        {artDirections.map((direction, index) => {
                            const selected = theme.palette === direction.name;
                            return (
                                <div key={`${direction.name}-${index}`}
                                    className={[
                                        'p-3 rounded-[--radius-card] flex flex-col',
                                        selected
                                            ? 'bg-raised shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]'
                                            : 'bg-white/[0.04] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]',
                                    ].join(' ')}>
                                    <DesignContractPreview
                                        colors={direction.colors}
                                        typography={findTypography(direction.typography)}
                                        projectName={plan?.projectName}
                                        className="w-full h-40 rounded-md bg-white pointer-events-none overflow-hidden"
                                    />
                                    <p className="mt-3 text-sm font-medium text-metal-100">{direction.name}</p>
                                    <p className="text-xs text-metal-300 leading-snug mt-1 flex-1">{direction.rationale}</p>
                                    <p className="text-[11px] text-metal-400 mt-2 font-mono">{findTypography(direction.typography).name}</p>
                                    <button onClick={() => applyDirection(direction, index)} disabled={isBusy}
                                        className="tap mt-3 w-full rounded-lg text-sm font-medium
                                                   transition-[background-color,transform] duration-200 ease-[--ease-fluid]
                                                   active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100
                                                   bg-metal-700 text-metal-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                                                   md:hover:bg-[#33333a]">
                                        {selected ? 'Applied' : 'Use this direction'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="mt-8 md:mt-10 flex flex-col items-center gap-4">
                <div className="flex items-center gap-3">
                    <ModelPicker />
                    <QuotaBadge surface="builder" />
                </div>
                <button
                    onClick={handleGenerate}
                    disabled={isBusy}
                    className="tap w-full sm:w-auto px-10 rounded-xl bg-metal-700 text-metal-100 font-medium
                               shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]
                               transition-[background-color,transform] duration-200 ease-[--ease-fluid]
                               md:hover:bg-[#33333a] active:scale-[0.98]
                               disabled:opacity-40 disabled:active:scale-100"
                >
                    Generate My Web App
                </button>
            </div>
        </div>
    );
};

export default Step_Theme;
