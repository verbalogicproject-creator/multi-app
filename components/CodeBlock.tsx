import React, { useState } from 'react';

const CodeBlock: React.FC<{ language: string, code: string }> = ({ language, code }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="bg-ground rounded-card my-2 relative hairline overflow-hidden">
            <div className="flex justify-between items-center pl-4 pr-1 bg-surface shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]">
                <span className="meta text-xs">{language || 'code'}</span>
                <button onClick={handleCopy}
                    aria-label={copied ? 'Copied' : 'Copy code'}
                    className="tap flex items-center justify-center gap-1 px-3 rounded-lg text-xs text-metal-300
                               transition-colors duration-200 ease-fluid md:hover:text-metal-100 md:hover:bg-metal-700">
                    <svg xmlns="http://www.w3.org/2000/svg" aria-hidden className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
            <pre className="p-4 overflow-x-auto text-sm text-metal-200 font-mono">
                <code>{code}</code>
            </pre>
        </div>
    );
};

export default CodeBlock;
