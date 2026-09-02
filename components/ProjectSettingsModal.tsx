import React, { useState, useRef, useEffect } from 'react';
import { Project, ProjectFile } from '../types/index';

interface ProjectSettingsModalProps {
  project: Project;
  files: ProjectFile[];
  onClose: () => void;
  onRenameProject: (projectId: string, newName: string) => void;
  onAddFile: (projectId: string, file: File) => void;
  onDeleteFile: (fileId: string, projectId: string) => void;
}

/**
 * A centred dialog from `md:` up, a bottom sheet on a phone — the same
 * mechanism the Memory drawer uses, so the app has one modal idiom rather than
 * three. `dvh`, never `vh`: iOS Safari's collapsing toolbar makes `vh` jump
 * mid-scroll and a modal sized in `vh` grows a scrollbar it does not need.
 */
const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({
  project,
  files,
  onClose,
  onRenameProject,
  onAddFile,
  onDeleteFile,
}) => {
  const [projectName, setProjectName] = useState(project.name);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = () => {
    if (projectName.trim() && projectName.trim() !== project.name) {
      onRenameProject(project.id, projectName.trim());
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      Array.from(event.target.files).forEach(file => onAddFile(project.id, file));
    }
  };

  const renameDisabled = !projectName.trim() || projectName.trim() === project.name;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Settings for ${project.name}`}
        className="relative w-full md:max-w-2xl flex flex-col max-h-[92dvh] md:max-h-[85dvh]
                   bg-surface rounded-t-shell md:rounded-shell
                   shadow-[inset_0_1px_0_rgb(255_255_255/0.10)]"
      >
        <header className="shrink-0 flex justify-between items-center gap-2 px-4 md:px-6 py-2
                           shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]">
          <h2 className="font-display text-lg md:text-xl tracking-[-0.02em] text-metal-100 truncate">
            Settings — <span className="meta text-base">{project.name}</span>
          </h2>
          <button ref={closeRef} onClick={onClose} aria-label="Close settings"
            className="tap flex items-center justify-center shrink-0 rounded-lg text-metal-300 text-xl leading-none
                       transition-colors duration-200 ease-fluid md:hover:text-metal-100 md:hover:bg-metal-700">
            <span aria-hidden>&times;</span>
          </button>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
          <div className="mb-6">
            <label htmlFor="projectName" className="block text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-2">
              Project name
            </label>
            <div className="flex gap-2">
                <input id="projectName" type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)}
                  className="tap flex-1 min-w-0 px-3 bg-raised rounded-lg text-sm text-metal-100 hairline focus:outline-none" />
                <button onClick={handleSave} disabled={renameDisabled}
                  className="tap shrink-0 px-4 rounded-lg bg-metal-700 text-metal-100 text-sm font-medium
                             shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]
                             transition-[background-color,transform] duration-200 ease-fluid
                             md:hover:bg-[#33333a] active:scale-[0.98]
                             disabled:opacity-35 disabled:active:scale-100 disabled:md:hover:bg-metal-700">
                  Rename
                </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-3">Files</h3>
            <button onClick={() => fileInputRef.current?.click()}
              className="tap w-full rounded-lg text-sm text-metal-300 mb-4
                         shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]
                         transition-colors duration-200 ease-fluid md:hover:text-metal-100 md:hover:bg-white/[0.04]">
              Add files
            </button>
            <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" />
            <ul className="space-y-2">
              {files.length > 0 ? files.map(file => (
                <li key={file.id} className="flex justify-between items-center gap-2 bg-raised rounded-lg pl-3">
                  <span className="meta text-xs truncate" title={file.path}>{file.path}</span>
                  {/* The one control here that loses something, and always
                      reachable: a hover-only affordance is invisible to a thumb. */}
                  <button onClick={() => onDeleteFile(file.id, project.id)} aria-label={`Delete ${file.path}`}
                    className="tap flex items-center justify-center shrink-0 rounded-lg text-metal-300 text-lg leading-none
                               transition-colors duration-200 ease-fluid md:hover:text-accent md:hover:bg-metal-700">
                    <span aria-hidden>&times;</span>
                  </button>
                </li>
              )) : ( <p className="text-sm text-metal-300 text-center">This project has no files.</p> )}
            </ul>
          </div>
        </main>

        <footer className="shrink-0 px-4 md:px-6 py-2 text-right safe-b md:pb-2
                           shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
            <button onClick={onClose}
              className="tap px-5 rounded-lg bg-transparent text-metal-300 text-sm font-medium hairline
                         transition-colors duration-200 ease-fluid md:hover:text-metal-100">
              Close
            </button>
        </footer>
      </div>
    </div>
  );
};

export default ProjectSettingsModal;
