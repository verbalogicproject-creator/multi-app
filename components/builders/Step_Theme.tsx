import React from 'react';
import { useAppContext } from '../../context/AppContext';

const themeOptions = {
    palettes: {
        "Modern & Minimal": { bg: "bg-slate-100", text: "text-slate-800", primary: "bg-blue-600" },
        "Vibrant & Playful": { bg: "bg-yellow-50", text: "text-gray-800", primary: "bg-pink-500" },
        "Corporate & Clean": { bg: "bg-white", text: "text-gray-700", primary: "bg-indigo-700" },
        "Dark & Elegant": { bg: "bg-gray-900", text: "text-gray-200", primary: "bg-teal-500" },
    },
    typographies: {
        "Sans-serif & Friendly": "font-sans",
        "Serif & Professional": "font-serif",
        "Mono & Techy": "font-mono",
    }
};

const ThemeCard: React.FC<{ title: string, selected: boolean, onClick: () => void, children: React.ReactNode }> = ({ title, selected, onClick, children }) => (
    <div
        onClick={onClick}
        className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${selected ? 'border-sky-500 ring-2 ring-sky-500/50' : 'border-gray-700 hover:border-gray-500'}`}
    >
        <p className="font-semibold mb-2">{title}</p>
        <div className="h-16 rounded-md overflow-hidden">{children}</div>
    </div>
);

const Step_Theme: React.FC = () => {
    const { builderState, setBuilderState, generateWebAppCode } = useAppContext();
    const { theme } = builderState;

    const handleSelect = (type: 'palette' | 'typography', value: string) => {
        setBuilderState(prev => ({ ...prev, theme: { ...prev.theme, [type]: value } }));
    };

    return (
        <div className="w-full max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-white text-center">Choose a Visual Style</h2>
            <p className="mt-1 text-center text-gray-400">Select a color palette and font style to define the look and feel.</p>

            <div className="mt-8 space-y-6">
                <div>
                    <h3 className="text-lg font-semibold mb-3">Color Palette</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {Object.entries(themeOptions.palettes).map(([name, colors]) => (
                            <ThemeCard key={name} title={name} selected={theme.palette === name} onClick={() => handleSelect('palette', name)}>
                                <div className={`w-full h-full flex items-end p-2 ${colors.bg} ${colors.text}`}>
                                    <div className={`w-8 h-8 rounded-full ${colors.primary}`}></div>
                                </div>
                            </ThemeCard>
                        ))}
                    </div>
                </div>
                <div>
                    <h3 className="text-lg font-semibold mb-3">Typography</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {Object.entries(themeOptions.typographies).map(([name, fontClass]) => (
                             <ThemeCard key={name} title={name} selected={theme.typography === name} onClick={() => handleSelect('typography', name)}>
                                <div className={`w-full h-full flex items-center justify-center bg-gray-800 ${fontClass}`}>
                                    <p className="text-2xl text-gray-300">Aa</p>
                                 </div>
                             </ThemeCard>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-10 text-center">
                <button
                    onClick={generateWebAppCode}
                    className="px-10 py-3 bg-sky-600 text-white font-semibold rounded-lg shadow-md hover:bg-sky-500 transition-all transform hover:scale-105"
                >
                    Generate My Web App
                </button>
            </div>
        </div>
    );
};

export default Step_Theme;
