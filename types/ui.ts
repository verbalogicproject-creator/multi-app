/**
 * Shell-level UI vocabulary.
 *
 * `MobileSurface` lives here rather than beside the tab bar because it is no
 * longer only the tab bar's business: the builder's hand-off to the IDE has to
 * name a destination, and a context that imports a type from a component is the
 * wrong direction of dependency.
 */

/** Which of the phone's three destinations is showing. Ignored from `md:` up. */
export type MobileSurface = 'projects' | 'main' | 'code';
