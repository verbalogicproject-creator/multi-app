import React, { useState, useRef } from 'react';
import { Project, ProjectFile } from '../types/index';

interface ProjectSettingsModalProps {
  project: Project;
  files: ProjectFile[];
  onClose: () => void;
  onRenameProject: (projectId: string, newName: string) => void;
  onAddFile: (projectId: string, file: File) => void;
  onDeleteFile: (fileId: string, projectId: string) => void;
}

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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl border border-gray-700 flex flex-col max-h-[90vh]">
        <header className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-sky-400">Settings for "{project.name}"</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">&times;</button>
        </header>

        <main className="p-6 overflow-y-auto">
          <div className="mb-6">
            <label htmlFor="projectName" className="block text-sm font-medium text-gray-300 mb-2">Project Name</label>
            <div className="flex gap-2">
                <input id="projectName" type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="flex-1 p-2 bg-gray-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                <button onClick={handleSave} disabled={!projectName.trim() || projectName.trim() === project.name} className="p-2 bg-sky-600 rounded-md hover:bg-sky-500 transition-colors text-sm font-semibold disabled:bg-gray-600 disabled:cursor-not-allowed">Rename</button>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-200 mb-3">Manage Files</h3>
            <button onClick={() => fileInputRef.current?.click()} className="w-full text-center p-2 mb-4 bg-gray-600 hover:bg-sky-700 rounded-md text-sm transition-colors">Add More Files</button>
            <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" />
            <ul className="text-sm space-y-2">
              {files.length > 0 ? files.map(file => (
                <li key={file.id} className="flex justify-between items-center bg-gray-900 p-2 rounded-md">
                  <span className="truncate" title={file.path}>{file.path}</span>
                  <button onClick={() => onDeleteFile(file.id, project.id)} className="text-gray-500 hover:text-red-400 font-bold px-2">&times;</button>
                </li>
              )) : ( <p className="text-gray-500 text-center italic text-sm">This project has no files.</p> )}
            </ul>
          </div>
        </main>
        
        <footer className="p-4 border-t border-gray-700 text-right">
            <button onClick={onClose} className="px-4 py-2 bg-gray-600 rounded-md hover:bg-gray-500 transition-colors text-sm font-semibold">Close</button>
        </footer>
      </div>
    </div>
  );
};

export default ProjectSettingsModal;