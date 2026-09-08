/**
 * What a project was meant to be, carried from the builder wizard onto the
 * project `loadGeneratedProjectIntoIDE` creates from it — set once, at
 * creation, persisted the same way `dependencySummary` is. Without this the
 * project reaching the IDE has no memory of the plan or acceptance criteria
 * that were approved for it; see A3 in the plan.
 */
export interface ProjectOrigin {
  plan: any;
  theme: any;
  acceptanceCriteria: string[];
  buildId: string | null;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  dependencySummary?: string;
  origin?: ProjectOrigin;
  /**
   * Everything below is computed fresh by `useChat`'s `sendMessage` for a
   * single coding-mode turn and attached to the `Project` object the request
   * carries — never persisted, never read back from storage. Optional so a
   * `projects.map(p => ...)` anywhere else in the app that does not compute
   * them is unaffected; `buildSystemPrompt`'s `projectContexts` renders each
   * one only when present. See A3 item 2.
   */
  fileTree?: string[];
  diagnosticsSummary?: string;
  previewSummary?: string;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string; // File path relative to project root, e.g., "src/components/Button.tsx"
  content: string; // File content as a string
  type: string; // MIME type
  createdAt: number;
}
