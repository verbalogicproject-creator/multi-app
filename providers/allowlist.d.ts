/**
 * Types for `allowlist.js`.
 *
 * The list has to be one runtime value shared by both halves of the app — the server
 * builds the generate prompt from it and drops `tsc` diagnostics against it, the client
 * attributes bundle failures against it — and if either side kept its own copy they would
 * drift, which is the whole failure this list was written to end. So the module stays
 * plain `.js` that Node can import directly, and this declaration is what lets the
 * TypeScript half see it.
 */

export declare const BASE_PACKAGES: string[];
export declare const OPTIONAL_PACKAGES: Record<string, string>;
export declare const PREVIEW_PACKAGES: Set<string>;
export declare const isNotADependency: (spec: string) => boolean;
export declare const packageOf: (spec: string) => string | null;
export declare const isAvailable: (spec: string) => boolean;
export declare const allowlistInstruction: () => string;
