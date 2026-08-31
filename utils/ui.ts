import React from 'react';
import CodeBlock from '../components/CodeBlock';

export const renderTextWithCodeBlocks = (text: string): React.ReactNode[] | null => {
    if (!text) return null;
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)\n```/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(React.createElement('span', { key: lastIndex }, text.substring(lastIndex, match.index)));
      }
      const language = match[1] || '';
      const code = match[2] || '';
      parts.push(React.createElement(CodeBlock, { key: match.index, language: language, code: code.trim() }));
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(React.createElement('span', { key: lastIndex }, text.substring(lastIndex)));
    }
    return parts;
};