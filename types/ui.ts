/**
 * Shell-level UI vocabulary.
 *
 * `Surface` lives here rather than beside the dock because it is no longer only the
 * dock's business: the builder's hand-off to the IDE has to name a destination, and a
 * context that imports a type from a component is the wrong direction of dependency.
 *
 * Chat and Build were one slot until the dock arrived — the label flipped between them
 * depending on a rail tab, which meant the thing you tapped and the thing you got were
 * decided in two different places. They are separate destinations now.
 *
 * Memory is deliberately absent. It stays the right-hand drawer `DESIGN.md §1` locks it
 * as, reachable from every destination rather than being one, so the accent dot works
 * from anywhere.
 */
export type Surface = 'projects' | 'chat' | 'build' | 'code' | 'preview' | 'harness';

/** Dock order, left to right. */
export const SURFACE_ORDER: Surface[] = ['projects', 'chat', 'build', 'code', 'preview', 'harness'];

export const SURFACE_LABEL: Record<Surface, string> = {
    projects: 'Projects',
    chat: 'Chat',
    build: 'Build',
    code: 'Code',
    preview: 'Preview',
    harness: 'Harness',
};
