import React from 'react';
import { useAppContext } from '../../context/AppContext';
import ModelPicker from '../ModelPicker';
import DesignContractPreview from './DesignContractPreview';
import {
    PALETTES, TYPOGRAPHY_OPTIONS, COLOR_ROLES, CUSTOM_PALETTE_NAME,
    findTypography, resolveThemeColors, sanitizeColors,
    type ThemeColors, type ArtDirection,
} from '../../utils/palettes';

const SwatchStrip: React.FC<{ colors: ThemeColors }> = ({ colors }) => (
    <div className="flex h-12 rounded-md overflow-hidden border border-black/20">
        <div className="w-1/3" style={{ background: colors.bg }} />
        <div className="w-1/3" style={{ background: colors.surface }} />
        <div className="flex-1 flex">
            <div className="flex-1" style={{ background: colors.primary }} />
            <div className="flex-1" style={{ background: colors.accent }} />
        </div>
    </div>
);

const cardClass = (selected: boolean) =>
    `p-3 border-2 rounded-lg cursor-pointer transition-all text-left ${selected ? 'border-sky-500 ring-2 ring-sky-500/40' : 'border-gray-700 hover:border-gray-500'}`;

const Step_Theme: React.FC = () => {
    const { builderState, setBuilderState, generateWebAppCode, suggestArtDirections } = useAppContext();
    const { theme, plan, status, artDirections } = builderState;

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

    const applyDirection = (direction: ArtDirection) =>
        setBuilderState(prev => ({
            ...prev,
            theme: {
                ...prev.theme,
                palette: direction.name,
                colors: direction.colors,
                typography: findTypography(direction.typography).name,
            },
        }));

    return (
        <div className="w-full max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-white text-center">Choose a Visual Style</h2>
            <p className="mt-1 text-center text-gray-400 text-sm">
                Pick a palette and type, or let the AI propose directions. The preview below is exactly what the generator is told to build.
            </p>

            {/* Palettes */}
            <div className="mt-8">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Colour palette</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {PALETTES.map(palette => (
                        <button key={palette.name} disabled={isBusy} onClick={() => selectPalette(palette.name, palette.colors)}
                            className={cardClass(theme.palette === palette.name)}>
                            <SwatchStrip colors={palette.colors} />
                            <p className="mt-2 text-xs font-semibold text-gray-200 truncate">{palette.name}</p>
                        </button>
                    ))}
                </div>
            </div>

            {/* Custom colours */}
            <div className="mt-6 p-4 bg-gray-800/60 border border-gray-700 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-300">
                    Custom colours {theme.palette === CUSTOM_PALETTE_NAME && <span className="text-sky-400 font-normal">· active</span>}
                </h3>
                <p className="text-xs text-gray-500 mt-1 mb-3">Adjust any role to switch to a custom palette. These exact values are handed to the code generator.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {COLOR_ROLES.map(role => (
                        <label key={role.key} className="flex items-center gap-2" title={role.hint}>
                            <input
                                type="color"
                                value={colors[role.key]}
                                disabled={isBusy}
                                onChange={e => updateColor(role.key, e.target.value)}
                                className="w-9 h-9 shrink-0 bg-transparent border border-gray-600 rounded cursor-pointer"
                            />
                            <span className="min-w-0">
                                <span className="block text-xs text-gray-300">{role.label}</span>
                                <span className="block text-[10px] text-gray-500 font-mono">{colors[role.key]}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </div>

            {/* Typography */}
            <div className="mt-6">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Typography</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {TYPOGRAPHY_OPTIONS.map(option => (
                        <button key={option.name} disabled={isBusy} onClick={() => selectTypography(option.name)}
                            className={cardClass(theme.typography === option.name)}>
                            <span className="block text-2xl text-gray-100" style={{
                                fontFamily: option.headingFamily,
                                fontWeight: option.headingWeight,
                                textTransform: option.headingTransform,
                                letterSpacing: option.headingSpacing,
                            }}>Aa</span>
                            <span className="block mt-1 text-[11px] text-gray-400 leading-tight">{option.name}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Live design contract */}
            <div className="mt-8">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">Design preview</h3>
                <DesignContractPreview colors={colors} typography={typography} projectName={plan?.projectName} />
            </div>

            {/* AI art directions */}
            <div className="mt-8 p-4 bg-gray-800/60 border border-gray-700 rounded-lg">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[12rem]">
                        <h3 className="text-sm font-semibold text-gray-300">AI art directions</h3>
                        <p className="text-xs text-gray-500 mt-1">Three distinct directions tailored to your plan. Costs one model request.</p>
                    </div>
                    <button onClick={suggestArtDirections} disabled={isBusy}
                        className="px-4 py-2 bg-gray-700 text-white text-sm font-semibold rounded-md hover:bg-gray-600 disabled:opacity-50">
                        {isBusy && status.message.includes('art direction') ? 'Exploring…' : artDirections ? 'Suggest again' : 'Suggest 3 directions'}
                    </button>
                </div>

                {artDirections && artDirections.length > 0 && (
                    <div className="mt-4 grid md:grid-cols-3 gap-3">
                        {artDirections.map((direction, index) => {
                            const selected = theme.palette === direction.name;
                            return (
                                <div key={`${direction.name}-${index}`} className={cardClass(selected)}>
                                    <DesignContractPreview
                                        colors={direction.colors}
                                        typography={findTypography(direction.typography)}
                                        projectName={plan?.projectName}
                                        className="w-full h-40 rounded-md border border-gray-700 bg-white pointer-events-none"
                                    />
                                    <p className="mt-2 text-xs font-semibold text-gray-100">{direction.name}</p>
                                    <p className="text-[11px] text-gray-400 leading-snug mt-1">{direction.rationale}</p>
                                    <p className="text-[10px] text-gray-500 mt-1">{findTypography(direction.typography).name}</p>
                                    <button onClick={() => applyDirection(direction)} disabled={isBusy}
                                        className="mt-2 w-full py-1.5 bg-sky-700 text-white text-xs font-semibold rounded-md hover:bg-sky-600 disabled:opacity-50">
                                        {selected ? 'Applied ✓' : 'Use this direction'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="mt-8 flex flex-col items-center gap-4">
                <ModelPicker />
                <button
                    onClick={generateWebAppCode}
                    disabled={isBusy}
                    className="px-10 py-3 bg-sky-600 text-white font-semibold rounded-lg shadow-md hover:bg-sky-500 transition-all transform hover:scale-105 disabled:opacity-50 disabled:transform-none"
                >
                    Generate My Web App
                </button>
            </div>
        </div>
    );
};

export default Step_Theme;
