import React, { useMemo } from 'react';
import { ThemeColors, TypographyOption } from '../../utils/palettes';
import { buildDesignContractHtml } from '../../utils/designContract';

interface DesignContractPreviewProps {
    colors: ThemeColors;
    typography: TypographyOption;
    projectName?: string;
    className?: string;
}

/**
 * Renders the design tokens as a real page inside a fully sandboxed iframe
 * (no scripts, no network) so a direction can be judged before generating code.
 */
const DesignContractPreview: React.FC<DesignContractPreviewProps> = ({ colors, typography, projectName, className }) => {
    const html = useMemo(
        () => buildDesignContractHtml(colors, typography, projectName),
        [colors.bg, colors.surface, colors.text, colors.muted, colors.primary, colors.accent, typography.name, projectName],
    );

    return (
        <iframe
            sandbox=""
            srcDoc={html}
            title={`Design preview${projectName ? ` for ${projectName}` : ''}`}
            className={className ?? 'w-full h-[26rem] rounded-lg border border-gray-700 bg-white'}
        />
    );
};

export default DesignContractPreview;
