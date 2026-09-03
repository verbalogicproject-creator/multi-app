import type { Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';

/**
 * Four grammars, chosen because they are what the builder actually emits.
 * An unknown extension gets no grammar rather than a wrong one — plain mono is
 * honest, whereas highlighting Python as JavaScript is a lie the eye believes.
 */
export function languageFor(path: string): Extension {
    const dot = path.lastIndexOf('.');
    const ext = dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
    switch (ext) {
        case 'ts':
        case 'mts':
        case 'cts':
            return javascript({ typescript: true });
        case 'tsx':
            return javascript({ typescript: true, jsx: true });
        case 'jsx':
            return javascript({ jsx: true });
        case 'js':
        case 'mjs':
        case 'cjs':
            return javascript();
        case 'json':
            return json();
        case 'css':
            return css();
        case 'html':
        case 'htm':
        case 'svg':
            return html();
        default:
            return [];
    }
}
