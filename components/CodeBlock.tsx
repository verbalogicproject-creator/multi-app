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
        <div className="bg-gray-900 rounded-md my-2 relative border border-gray-700 shadow-md">
            <div className="flex justify-between items-center px-4 py-1 bg-gray-800 rounded-t-md">
                <span className="text-xs font-semibold text-gray-400">{language || 'code'}</span>
                <button onClick={handleCopy} className="text-xs text-sky-400 hover:text-white flex items-center transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>
            <pre className="p-4 overflow-x-auto text-sm text-gray-200">
                <code>{code}</code>
            </pre>
        </div>
    );
};

export default CodeBlock;