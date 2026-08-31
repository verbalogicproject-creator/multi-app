export interface Project {
  id: string;
  name: string;
  createdAt: number;
  dependencySummary?: string;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string; // File path relative to project root, e.g., "src/components/Button.tsx"
  content: string; // File content as a string
  type: string; // MIME type
  createdAt: number;
}
