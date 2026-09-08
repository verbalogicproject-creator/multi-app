import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * The editor's surface, in tokens only.
 *
 * DESIGN.md §2 says colour is decided in one place, and §6 says a signal that
 * needs a *third* job beyond attention and chrome has to find it somewhere
 * other than the palette. Syntax is exactly such a signal, so this theme spends
 * no hue on it: structure is carried by value and weight, the same two axes the
 * chat turns use. The accent is left untouched and unspent — which is what makes
 * it available to mean "this line has a type error" in the next stage.
 */
export const editorTheme = EditorView.theme(
    {
        '&': {
            height: '100%',
            backgroundColor: 'var(--color-ground)',
            color: 'var(--color-metal-200)',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
        },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.55', overflow: 'auto' },
        /* `.cm-gutters` is height:100% of the flex line, which is sized by
           `.cm-content` — so without this the gutter's hairline stops where the
           document does and hangs in mid-air below it. Found by looking at it;
           nothing else would have. */
        '.cm-content': { padding: '0.75rem 0', minHeight: '100%' },
        '.cm-line': { padding: '0 1rem 0 0.5rem' },

        /* Cursor and selection are state you caused, so they are value, never
           accent. (DESIGN.md §1.) */
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-metal-100)', borderLeftWidth: '2px' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
            backgroundColor: 'var(--color-metal-700)',
        },
        '.cm-selectionMatch': { backgroundColor: 'var(--color-raised)' },
        '.cm-activeLine': { backgroundColor: 'var(--color-surface)' },

        '.cm-gutters': {
            backgroundColor: 'var(--color-ground)',
            color: 'var(--color-metal-400)',
            border: 'none',
            /* A hairline instead of a rail: the gutter belongs to the same plane. */
            boxShadow: 'inset -1px 0 0 rgb(255 255 255 / 0.06)',
        },
        '.cm-activeLineGutter': {
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-metal-200)',
        },
        '.cm-foldGutter .cm-gutterElement': { color: 'var(--color-metal-400)' },

        '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
            backgroundColor: 'var(--color-metal-700)',
            color: 'var(--color-metal-100)',
        },
        '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': {
            /* An unclosed bracket is the one thing in here that needs you. */
            color: 'var(--color-accent-soft)',
        },

        '.cm-panels': {
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-metal-200)',
            fontFamily: 'var(--font-sans)',
        },
        '.cm-panels.cm-panels-bottom': { borderTop: 'none', boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.06)' },
        '.cm-textfield': {
            backgroundColor: 'var(--color-ground)',
            color: 'var(--color-metal-100)',
            border: 'none',
            boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.10)',
            borderRadius: '0.5rem',
        },
        '.cm-button': {
            backgroundColor: 'var(--color-metal-700)',
            backgroundImage: 'none',
            color: 'var(--color-metal-100)',
            border: 'none',
            borderRadius: '0.5rem',
        },
        '.cm-searchMatch': { backgroundColor: 'var(--color-metal-700)' },
        '.cm-searchMatch.cm-searchMatch-selected': {
            backgroundColor: 'var(--color-metal-500)',
            color: 'var(--color-metal-100)',
        },

        /* The accent, finally spent. Nothing else in this theme carries hue, so an
           underline here is the only coloured thing on the surface — which is the
           entire reason it was held back. */
        '.cm-lintRange-error': {
            /* A wavy underline drawn as a background image, because a border would
               change the line box and reflow the text it is marking. */
            backgroundImage: 'none',
            textDecoration: 'underline wavy var(--color-accent-soft)',
            textDecorationSkipInk: 'none',
            textUnderlineOffset: '0.2em',
        },
        '.cm-lintRange-warning': {
            textDecoration: 'underline wavy var(--color-metal-400)',
            textDecorationSkipInk: 'none',
            textUnderlineOffset: '0.2em',
        },
        '.cm-lint-marker': { width: '0.7em', height: '0.7em' },
        '.cm-lint-marker-error': { content: 'none', backgroundColor: 'var(--color-accent-strong)', borderRadius: '50%' },
        '.cm-lint-marker-warning': { content: 'none', backgroundColor: 'var(--color-metal-400)', borderRadius: '50%' },

        '.cm-tooltip': {
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-metal-200)',
            border: 'none',
            borderRadius: '0.5rem',
            boxShadow: '0 8px 24px rgb(0 0 0 / 0.45), inset 0 0 0 1px rgb(255 255 255 / 0.08)',
        },
        '.cm-tooltip .cm-tooltip-arrow:before, .cm-tooltip .cm-tooltip-arrow:after': { borderTopColor: 'transparent', borderBottomColor: 'transparent' },
        '.cm-diagnostic': {
            padding: '0.5rem 0.75rem',
            fontFamily: 'var(--font-sans)',
            fontSize: '0.8125rem',
            lineHeight: '1.4',
            /* The default is a thick coloured left border. The hairline is this
               app's idiom for the same job. */
            borderLeft: 'none',
            boxShadow: 'inset 1px 0 0 var(--color-accent-strong)',
            whiteSpace: 'pre-wrap',
        },
        '.cm-diagnostic-warning': { boxShadow: 'inset 1px 0 0 var(--color-metal-400)' },
        '.cm-diagnosticSource': { fontFamily: 'var(--font-mono)', opacity: '0.7', fontSize: '0.75rem' },
    },
    { dark: true },
);

/**
 * Monochrome syntax. Three usable values and two weights, which is more
 * separation than it sounds: keywords read as structure, strings and numbers as
 * content, punctuation and comments recede.
 */
export const editorHighlight = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: 'var(--color-metal-100)', fontWeight: '600' },
    { tag: [t.typeName, t.className, t.namespace, t.standard(t.tagName), t.tagName], color: 'var(--color-metal-100)', fontWeight: '500' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--color-metal-100)' },
    { tag: [t.self, t.bool, t.null, t.atom, t.number, t.integer, t.float, t.unit], color: 'var(--color-metal-200)', fontWeight: '500' },
    { tag: [t.string, t.special(t.string), t.regexp, t.escape, t.character], color: 'var(--color-metal-200)' },
    { tag: [t.variableName, t.definition(t.variableName), t.propertyName, t.attributeName, t.labelName], color: 'var(--color-metal-200)' },
    { tag: [t.attributeValue], color: 'var(--color-metal-200)' },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.paren, t.brace, t.squareBracket, t.angleBracket, t.derefOperator], color: 'var(--color-metal-300)' },
    { tag: [t.meta, t.processingInstruction], color: 'var(--color-metal-300)' },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--color-metal-300)', fontStyle: 'italic' },
    { tag: [t.heading], color: 'var(--color-metal-100)', fontWeight: '600' },
    { tag: [t.link, t.url], color: 'var(--color-metal-200)', textDecoration: 'underline' },
    { tag: [t.emphasis], fontStyle: 'italic' },
    { tag: [t.strong], fontWeight: '600' },
    { tag: [t.strikethrough], textDecoration: 'line-through' },
    { tag: [t.invalid], color: 'var(--color-accent-soft)' },
]);
