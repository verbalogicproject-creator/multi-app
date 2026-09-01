import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Project, ProjectFile, CustomAiStyle, Persona, Agent, AiResponseStyle } from '../types/index';
import * as storageService from '../services/geminiService';
import * as apiService from '../services/apiService';
import * as buildStorage from '../services/buildStorage';
import type { SavedBuild } from '../services/buildStorage';
import { DEFAULT_PALETTE, sanitizeColors, type ArtDirection, type ThemeColors } from '../utils/palettes';
import { generateUniqueId } from '../utils/common';
import { createProjectZip } from '../utils/export';

// Add builder types
export interface WebAppBuilderState {
    isActive: boolean;
    currentStep: number;
    idea: string;
    plan: any | null;
    theme: {
        palette: string;
        typography: string;
        colors?: ThemeColors;      // concrete tokens; absent on builds saved before the token picker
    };
    generatedFiles: Record<string, string> | null;
    artDirections: ArtDirection[] | null;
    savedBuildId: string | null;   // links this build to its entry in the saved library
    status: {
        message: string;
        isLoading: boolean;
        log: string[];
    };
}

const initialBuilderState: WebAppBuilderState = {
    isActive: false,
    currentStep: 0,
    idea: '',
    plan: null,
    theme: { palette: DEFAULT_PALETTE.name, typography: 'Sans-serif & Friendly', colors: DEFAULT_PALETTE.colors },
    generatedFiles: null,
    artDirections: null,
    savedBuildId: null,
    status: { message: '', isLoading: false, log: [] },
};

/**
 * Rebuilds builder state from localStorage. Generation itself is never persisted
 * mid-flight, so a state restored at step 4 without files means the run was cut
 * short (reload/crash) — recover to the theme step rather than a dead spinner.
 */
let restoredBuilderCache: WebAppBuilderState | null = null;
/** Restores once per page load; shared by the builder state and the initial tab. */
const getRestoredBuilderState = (): WebAppBuilderState => {
    if (!restoredBuilderCache) restoredBuilderCache = restoreBuilderState();
    return restoredBuilderCache;
};

const restoreBuilderState = (): WebAppBuilderState => {
    const persisted = buildStorage.loadBuilderState();
    if (!persisted) return initialBuilderState;

    const interrupted = persisted.currentStep === 4 && !persisted.generatedFiles;
    return {
        ...initialBuilderState,
        ...persisted,
        // Stored tokens are re-validated: a hand-edited or truncated value must not
        // reach the preview or the code generator.
        theme: {
            ...initialBuilderState.theme,
            ...persisted.theme,
            colors: persisted.theme?.colors ? sanitizeColors(persisted.theme.colors) : initialBuilderState.theme.colors,
        },
        artDirections: Array.isArray(persisted.artDirections) ? persisted.artDirections : null,
        savedBuildId: persisted.savedBuildId ?? null,
        currentStep: interrupted ? 3 : persisted.currentStep,
        status: {
            isLoading: false,
            log: [],
            message: interrupted ? 'That generation was interrupted. Your plan and theme are intact — generate again when ready.' : '',
        },
    };
};


const defaultPersona: Persona = {
    id: 'default',
    name: 'Default',
    baseInstructions: '',
    composedStyles: [{ name: 'The Pragmatist', weight: 1 }]
};

const defaultCustomStyles: CustomAiStyle[] = [
    {
        id: 'default-pragmatist',
        name: 'The Pragmatist',
        instructions: "You are a pragmatic, code-first assistant. Prioritize functional, efficient code snippets. Keep explanations brief and technical. Assume an experienced developer audience.",
        isDefault: true,
    },
    {
        id: 'default-muse',
        name: 'The Muse',
        instructions: "Your primary role is to spark creativity. When a user presents an idea, your first response should be to ask insightful, guiding questions. Help them explore alternatives and unseen possibilities. Use the Socratic method. For example, if they ask for a button, you might ask, 'What feeling should this button evoke in the user? What if the button's state changed based on user interaction in an unexpected way?' Only provide code after this exploratory phase.",
        isDefault: true,
    },
    {
        id: 'default-mentor',
        name: 'The Mentor',
        instructions: "You are a tutor. When a user asks for code, provide it, but your main goal is to teach. Explain the underlying principles, the 'why' behind the code. Discuss trade-offs, alternative approaches, and link to relevant concepts or documentation. Use analogies to explain complex topics. Ensure the user understands the solution, not just how to copy it.",
        isDefault: true,
    },
    {
        id: 'default-visionary',
        name: 'The Visionary',
        instructions: "You are a principal engineer who thinks two steps ahead. When a user requests a feature, first fully grasp their core intent. Then, instead of implementing it literally, design a more robust, scalable, or innovative solution that anticipates future needs. For example, if they ask for a simple list, you might propose a virtualized, searchable, and sortable list component. Present your advanced alternative first, clearly explaining its long-term benefits before offering the simpler solution as an option.",
        isDefault: true,
    }
];

type AppTab = 'projects' | 'agents' | 'ai-settings' | 'tools';

interface AppContextType {
    projects: Project[];
    selectedProjectIds: Set<string>;
    filesByProject: Map<string, ProjectFile[]>;
    activeProjectView: string | null;
    editingProject: Project | null;
    isProjectPanelCollapsed: boolean;
    analyzingProjects: Set<string>;
    activeTab: AppTab;
    setActiveTab: React.Dispatch<React.SetStateAction<AppTab>>;
    handleCreateProject: (name: string) => Promise<Project>;
    handleDeleteProject: (id: string) => Promise<void>;
    handleToggleProjectSelection: (id: string) => void;
    handleViewProjectFiles: (id: string) => Promise<void>;
    handleAddFile: (projectId: string, file: File) => Promise<void>;
    handleDeleteFile: (fileId: string, projectId: string) => Promise<void>;
    aiCreateFile: (projectId: string, path: string, content: string) => Promise<ProjectFile>;
    aiUpdateFile: (projectId: string, path: string, newContent: string) => Promise<ProjectFile | null>;
    aiDeleteFile: (projectId: string, path: string) => Promise<boolean>;
    handleSaveFileContent: (projectId: string, fileId: string, newContent: string) => Promise<void>;
    handleOpenProjectSettings: (project: Project) => Promise<void>;
    handleCloseProjectSettings: () => void;
    handleRenameProject: (projectId: string, newName: string) => Promise<void>;
    handleToggleProjectPanel: () => void;
    setSelectedProjectIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    useWebSearch: boolean;
    setUseWebSearch: React.Dispatch<React.SetStateAction<boolean>>;
    lowLatencyMode: boolean;
    setLowLatencyMode: React.Dispatch<React.SetStateAction<boolean>>;
    selectedModel: string;                 // 'auto' or a concrete Gemini model id
    setSelectedModel: (model: string) => void;
    customAiStyles: CustomAiStyle[];
    handleAddCustomStyle: (name: string, instructions: string) => Promise<void>;
    handleUpdateCustomStyle: (id: string, name: string, instructions: string) => Promise<void>;
    handleDeleteCustomStyle: (id: string) => Promise<void>;
    personas: Persona[];
    selectedPersonaId: string | null;
    handleSelectPersona: (personaId: string | null) => void;
    handleSavePersona: (name: string, config: Omit<Persona, 'id' | 'name'>) => Promise<void>;
    handleDeletePersona: (personaId: string) => Promise<void>;
    activePersona: Persona;
    setActivePersona: React.Dispatch<React.SetStateAction<Persona>>;
    agents: Agent[];
    activeAgentId: string | null;
    handleAddAgent: (name: string, personaId: string, projectId: string) => Promise<void>;
    handleUpdateAgent: (agentId: string, name: string, personaId: string, projectId: string) => Promise<void>;
    handleDeleteAgent: (agentId: string) => Promise<void>;
    handleSelectAgent: (agentId: string | null) => void;
    globalError: string | null;
    setGlobalError: React.Dispatch<React.SetStateAction<string | null>>;

    // Web App Builder context
    builderState: WebAppBuilderState;
    setBuilderState: React.Dispatch<React.SetStateAction<WebAppBuilderState>>;
    startWebAppBuild: () => void;
    resetWebAppBuild: () => void;
    generateWebAppPlan: () => Promise<void>;
    refineWebAppPlan: (currentPlan: any, feedback: string) => Promise<void>;
    suggestArtDirections: () => Promise<void>;
    generateWebAppCode: () => Promise<void>;
    loadGeneratedProjectIntoIDE: () => Promise<void>;
    exportGeneratedProject: () => Promise<void>;
    savedBuilds: SavedBuild[];
    saveCurrentBuild: (name: string, asCopy?: boolean) => void;
    loadSavedBuild: (id: string) => void;
    removeSavedBuild: (id: string) => void;
    exportSavedBuild: (id: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
    const [filesByProject, setFilesByProject] = useState<Map<string, ProjectFile[]>>(new Map());
    const [activeProjectView, setActiveProjectView] = useState<string | null>(null);
    const [editingProject, setEditingProject] = useState<Project | null>(null);
    const [isProjectPanelCollapsed, setIsProjectPanelCollapsed] = useState(false);
    const [analyzingProjects, setAnalyzingProjects] = useState<Set<string>>(new Set());
    // Land on the builder when a build was in progress, so a reload never looks like data loss.
    const [activeTab, setActiveTab] = useState<AppTab>(() => getRestoredBuilderState().isActive ? 'tools' : 'projects');
    
    const [useWebSearch, setUseWebSearch] = useState(false);
    const [lowLatencyMode, setLowLatencyMode] = useState(false);
    const [selectedModel, setSelectedModelState] = useState<string>(() => {
        try { return localStorage.getItem('gemini_selected_model') || 'auto'; } catch { return 'auto'; }
    });
    const setSelectedModel = (model: string) => {
        setSelectedModelState(model);
        try { localStorage.setItem('gemini_selected_model', model); } catch { /* non-fatal */ }
    };
    const [customAiStyles, setCustomAiStyles] = useState<CustomAiStyle[]>([]);
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
    const [activePersona, setActivePersona] = useState<Persona>(defaultPersona);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

    const [globalError, setGlobalError] = useState<string | null>(null);

    const [builderState, setBuilderState] = useState<WebAppBuilderState>(getRestoredBuilderState);
    const [savedBuilds, setSavedBuilds] = useState<SavedBuild[]>(() => buildStorage.getSavedBuilds());

    // Persist the durable half of builder state. Deliberately keyed on content
    // fields only — `status` churns on every streaming progress event and must
    // not trigger a localStorage write per chunk.
    const { isActive: builderIsActive, currentStep: builderStep, idea: builderIdea,
            plan: builderPlan, theme: builderTheme, generatedFiles: builderFiles,
            artDirections: builderDirections, savedBuildId: builderSavedId } = builderState;
    useEffect(() => {
        const failure = buildStorage.saveBuilderState({
            isActive: builderIsActive,
            currentStep: builderStep,
            idea: builderIdea,
            plan: builderPlan,
            theme: builderTheme,
            generatedFiles: builderFiles,
            artDirections: builderDirections,
            savedBuildId: builderSavedId,
        });
        if (failure) setGlobalError(failure);
    }, [builderIsActive, builderStep, builderIdea, builderPlan, builderTheme, builderFiles, builderDirections, builderSavedId]);

    useEffect(() => {
        const loadInitialData = async () => {
            const loadedProjects = await storageService.getProjects();
            const userStyles = await storageService.getCustomAiStyles();
            setProjects(loadedProjects);
            setCustomAiStyles([...defaultCustomStyles, ...userStyles]);
            setPersonas(await storageService.getPersonas());
            setAgents(await storageService.getAgents());
        };
        loadInitialData();
    }, []);

    useEffect(() => {
        if (selectedPersonaId) {
            const foundPersona = personas.find(p => p.id === selectedPersonaId);
            if (foundPersona) setActivePersona(foundPersona);
        }
    }, [selectedPersonaId, personas]);

    const analyzeDependencies = useCallback(async (projectId: string) => {
        setAnalyzingProjects(prev => new Set(prev).add(projectId));
        try {
            const project = projects.find(p => p.id === projectId);
            if (!project) return;
            const files = await storageService.getFilesByProject(projectId);
            const updatedProject = await apiService.updateProjectDependencies(project, files);
            setProjects(prev => prev.map(p => p.id === projectId ? updatedProject : p));
        } catch (error) {
            console.error("Failed to analyze dependencies:", error);
            setGlobalError("Failed to analyze project dependencies.");
        } finally {
            setAnalyzingProjects(prev => {
                const newSet = new Set(prev);
                newSet.delete(projectId);
                return newSet;
            });
        }
    }, [projects]);
    
    const handleCreateProject = async (name: string): Promise<Project> => {
        const newProject: Project = { id: generateUniqueId(), name, createdAt: Date.now() };
        await storageService.addProject(newProject);
        setProjects((prev: Project[]) => [...prev, newProject]);
        return newProject;
    };
    const handleDeleteProject = async (id: string) => {
        await storageService.deleteProject(id);
        setProjects((prev: Project[]) => prev.filter(p => p.id !== id));
        setSelectedProjectIds((prev: Set<string>) => { const newSet = new Set(prev); newSet.delete(id); return newSet; });
        setFilesByProject((prev: Map<string, ProjectFile[]>) => { const newMap = new Map(prev); newMap.delete(id); return newMap; });
        if (activeProjectView === id) setActiveProjectView(null);
    };
    const handleToggleProjectSelection = (id: string) => {
        setSelectedProjectIds((prev: Set<string>) => { 
            const newSet = new Set(prev); 
            if (newSet.has(id)) newSet.delete(id); 
            else newSet.add(id); 
            return newSet; 
        });
    };
    const handleViewProjectFiles = async (id: string) => {
        if (activeProjectView === id) {
            setActiveProjectView(null);
        } else {
            setActiveProjectView(id);
            if (!filesByProject.has(id)) {
                const files = await storageService.getFilesByProject(id);
                setFilesByProject((prev: Map<string, ProjectFile[]>) => new Map(prev).set(id, files));
            }
        }
    };
    const handleAddFile = async (projectId: string, file: File) => {
        const content = await storageService.readFileAsText(file);
        const newFile: ProjectFile = { id: generateUniqueId(), projectId, path: file.name, type: file.type, content, createdAt: Date.now() };
        await storageService.addFile(newFile);
        setFilesByProject((prev: Map<string, ProjectFile[]>) => new Map(prev).set(projectId, [...(prev.get(projectId) || []), newFile]));
        await analyzeDependencies(projectId);
    };
    const handleDeleteFile = async (fileId: string, projectId: string) => {
        await storageService.deleteFile(fileId, projectId);
        setFilesByProject((prev: Map<string, ProjectFile[]>) => new Map(prev).set(projectId, (prev.get(projectId) || []).filter(f => f.id !== fileId)));
        await analyzeDependencies(projectId);
    };

    const aiCreateFile = async (projectId: string, path: string, content: string): Promise<ProjectFile> => {
        const newFile: ProjectFile = { id: generateUniqueId(), projectId, path, content, type: 'text/plain', createdAt: Date.now() };
        await storageService.addFile(newFile);
        setFilesByProject((prev: Map<string, ProjectFile[]>) => new Map(prev).set(projectId, [...(prev.get(projectId) || []), newFile]));
        await analyzeDependencies(projectId);
        return newFile;
    };

    const aiUpdateFile = async (projectId: string, path: string, newContent: string): Promise<ProjectFile | null> => {
        const projectFiles = filesByProject.get(projectId) || (await storageService.getFilesByProject(projectId));
        if (!Array.isArray(projectFiles)) return null;
        const fileToUpdate = projectFiles.find(f => f.path === path);
        if (!fileToUpdate) return null;
        const updatedFile = { ...fileToUpdate, content: newContent };
        await storageService.updateFile(projectId, updatedFile);
        setFilesByProject((prev: Map<string, ProjectFile[]>) => new Map(prev).set(projectId, projectFiles.map(f => f.id === updatedFile.id ? updatedFile : f)));
        await analyzeDependencies(projectId);
        return updatedFile;
    };
    
    const aiDeleteFile = async (projectId: string, path: string): Promise<boolean> => {
        const projectFiles = filesByProject.get(projectId) || (await storageService.getFilesByProject(projectId));
        if (!Array.isArray(projectFiles)) return false;
        const fileToDelete = projectFiles.find(f => f.path === path);
        if (!fileToDelete) return false;
        await handleDeleteFile(fileToDelete.id, projectId);
        return true;
    };

    const handleSaveFileContent = async (projectId: string, fileId: string, newContent: string) => {
        const projectFiles = filesByProject.get(projectId) || [];
        const fileToUpdate = projectFiles.find(f => f.id === fileId);
        if (!fileToUpdate) return;
        const updatedFile = { ...fileToUpdate, content: newContent };
        await storageService.updateFile(projectId, updatedFile);
        setFilesByProject((prev: Map<string, ProjectFile[]>) => {
            const newMap = new Map(prev);
            const newFiles = (newMap.get(projectId) || []).map(f => f.id === fileId ? updatedFile : f);
            newMap.set(projectId, newFiles);
            return newMap;
        });
    };
    
    const handleOpenProjectSettings = async (project: Project) => {
        const files = await storageService.getFilesByProject(project.id);
        setFilesByProject((prev: Map<string, ProjectFile[]>) => new Map(prev).set(project.id, files));
        setEditingProject(project);
    };
    const handleCloseProjectSettings = () => setEditingProject(null);
    const handleRenameProject = async (projectId: string, newName: string) => {
        const project = projects.find(p => p.id === projectId);
        if (project) {
            const updatedProject = { ...project, name: newName };
            await storageService.updateProject(updatedProject);
            setProjects((prev: Project[]) => prev.map(p => p.id === projectId ? updatedProject : p));
            if (editingProject?.id === projectId) setEditingProject(updatedProject);
        }
    };
    const handleToggleProjectPanel = () => setIsProjectPanelCollapsed(prev => !prev);
    
    // AI & Persona Handlers
    const handleAddCustomStyle = async (name: string, instructions: string) => {
      const newStyle: CustomAiStyle = { id: generateUniqueId(), name, instructions, isDefault: false };
      await storageService.addCustomAiStyle(newStyle);
      const userStyles = await storageService.getCustomAiStyles();
      setCustomAiStyles([...defaultCustomStyles, ...userStyles]);
    };
    const handleUpdateCustomStyle = async (id: string, name: string, instructions: string) => {
      const styleToUpdate = customAiStyles.find(s => s.id === id);
      if (styleToUpdate?.isDefault) return;
      await storageService.updateCustomAiStyle({ id, name, instructions });
      const userStyles = await storageService.getCustomAiStyles();
      setCustomAiStyles([...defaultCustomStyles, ...userStyles]);
      setPersonas(await storageService.getPersonas());
    };
    const handleDeleteCustomStyle = async (id: string) => {
      const styleToDelete = customAiStyles.find(s => s.id === id);
      if (styleToDelete?.isDefault) return;
      await storageService.deleteCustomAiStyle(id);
      const userStyles = await storageService.getCustomAiStyles();
      setCustomAiStyles([...defaultCustomStyles, ...userStyles]);
      setPersonas(await storageService.getPersonas());
    };
    const handleSelectPersona = (personaId: string | null) => {
        if (activeAgentId) return;
        if (personaId === null) {
            setActivePersona(defaultPersona);
        }
        setSelectedPersonaId(personaId);
    };
    const handleSavePersona = async (name: string, config: Omit<Persona, 'id' | 'name'>) => {
        if (selectedPersonaId) {
            const updated = { ...config, id: selectedPersonaId, name };
            await storageService.updatePersona(updated);
            setPersonas((prev: Persona[]) => prev.map(p => p.id === selectedPersonaId ? updated : p));
        } else {
            const newPersona = { ...config, id: generateUniqueId(), name };
            await storageService.addPersona(newPersona);
            setPersonas((prev: Persona[]) => [...prev, newPersona]);
            setSelectedPersonaId(newPersona.id);
        }
    };
    const handleDeletePersona = async (personaId: string) => {
        try {
            await storageService.deletePersona(personaId);
            setPersonas((prev: Persona[]) => prev.filter(p => p.id !== personaId));
            if (selectedPersonaId === personaId) setSelectedPersonaId(null);
        } catch (error) {
            // FIX: Safely handle the 'unknown' type of the caught error by checking if it's an instance of Error to access its message, or converting to a string as a fallback.
            if (error instanceof Error) {
                setGlobalError(error.message);
            } else {
                setGlobalError(String(error));
            }
        }
    };

    // Agent Handlers
    const handleAddAgent = async (name: string, personaId: string, projectId: string) => {
        const newAgent: Agent = { id: generateUniqueId(), name, personaId, projectId };
        await storageService.addAgent(newAgent);
        setAgents((prev: Agent[]) => [...prev, newAgent]);
    };
    const handleUpdateAgent = async (agentId: string, name: string, personaId: string, projectId: string) => {
        const updated = { id: agentId, name, personaId, projectId };
        await storageService.updateAgent(updated);
        setAgents((prev: Agent[]) => prev.map(a => a.id === agentId ? updated : a));
    };
    const handleDeleteAgent = async (agentId: string) => {
        await storageService.deleteAgent(agentId);
        setAgents((prev: Agent[]) => prev.filter(a => a.id !== agentId));
        if (activeAgentId === agentId) setActiveAgentId(null);
    };
    const handleSelectAgent = (agentId: string | null) => {
        setActiveAgentId(agentId);
        if (agentId) {
            const agent = agents.find(a => a.id === agentId);
            if (agent) {
                setSelectedProjectIds(new Set([agent.projectId]));
                setSelectedPersonaId(agent.personaId);
            }
            setActiveTab('projects');
        } else {
            setSelectedProjectIds(new Set());
            setSelectedPersonaId(null);
        }
    };

    // Builder Handlers
    const startWebAppBuild = () => { setBuilderState({ ...initialBuilderState, isActive: true, currentStep: 1 }); };
    const resetWebAppBuild = () => setBuilderState(initialBuilderState);
    const generateWebAppPlan = async () => {
        setBuilderState(prev => ({ ...prev, status: { ...prev.status, isLoading: true, message: 'AI is analyzing your idea and creating a blueprint...' }}));
        try {
            const plan = await apiService.generateWebAppPlan(builderState.idea, selectedModel === 'auto' ? undefined : selectedModel);
            setBuilderState(prev => ({ ...prev, plan, status: { ...prev.status, isLoading: false, message: '' }, currentStep: 2 }));
        } catch (e: any) {
            setGlobalError(`Failed to generate plan: ${e.message}`);
            setBuilderState(prev => ({ ...prev, status: { ...prev.status, isLoading: false, message: 'An error occurred.' }}));
        }
    };
    /** Asks Gemini for three distinct visual directions for the current project. */
    const suggestArtDirections = async () => {
        setBuilderState(prev => ({ ...prev, status: { ...prev.status, isLoading: true, message: 'Exploring art directions…' } }));
        try {
            const raw = await apiService.suggestArtDirections(
                builderState.idea,
                builderState.plan,
                selectedModel === 'auto' ? undefined : selectedModel,
            );
            // Model output is untrusted: every colour is re-validated as hex before use.
            const artDirections: ArtDirection[] = raw.slice(0, 3).map((d: any) => ({
                name: String(d?.name ?? 'Untitled direction'),
                rationale: String(d?.rationale ?? ''),
                typography: String(d?.typography ?? 'Sans-serif & Friendly'),
                colors: sanitizeColors(d?.colors),
            }));
            setBuilderState(prev => ({ ...prev, artDirections, status: { ...prev.status, isLoading: false, message: '' } }));
        } catch (e: any) {
            setGlobalError(`Failed to suggest art directions: ${e.message}`);
            setBuilderState(prev => ({ ...prev, status: { ...prev.status, isLoading: false, message: '' } }));
        }
    };

    /** Sends the current (possibly hand-edited) plan back to Gemini with change requests. */
    const refineWebAppPlan = async (currentPlan: any, feedback: string) => {
        setBuilderState(prev => ({ ...prev, status: { ...prev.status, isLoading: true, message: 'Revising the blueprint…' } }));
        try {
            const plan = await apiService.generateWebAppPlan(
                builderState.idea,
                selectedModel === 'auto' ? undefined : selectedModel,
                { previousPlan: currentPlan, feedback },
            );
            setBuilderState(prev => ({ ...prev, plan, status: { ...prev.status, isLoading: false, message: 'Blueprint revised.' } }));
        } catch (e: any) {
            setGlobalError(`Failed to revise plan: ${e.message}`);
            setBuilderState(prev => ({ ...prev, status: { ...prev.status, isLoading: false, message: '' } }));
        }
    };

    const generateWebAppCode = async () => {
        setBuilderState(prev => ({ ...prev, currentStep: 4, status: { isLoading: true, message: 'Contacting Gemini…', log: [] } }));
        try {
            const files = await apiService.generateWebAppCode(builderState.plan, builderState.theme, selectedModel === 'auto' ? undefined : selectedModel, (event) => {
                setBuilderState(prev => {
                    let message = prev.status.message;
                    let log = prev.status.log;
                    if (event.phase === 'thinking') {
                        message = `${event.model ?? 'Gemini'} is thinking about the architecture…`;
                        log = [];  // a fresh attempt (retry/fallback) restarts the file log
                    } else if (event.phase === 'writing') {
                        message = `${event.model ?? 'Gemini'} is writing code…`;
                    }
                    if (event.progress) message = `Writing code… ${(event.progress / 1024).toFixed(1)} KB`;
                    if (event.file && !log.includes(event.file)) log = [...log, event.file];
                    return { ...prev, status: { ...prev.status, message, log } };
                });
            });
            // Auto-save immediately so a reload can never lose a finished build.
            let savedId: string | null = null;
            try {
                const saved = buildStorage.saveBuild({
                    name: builderState.plan?.projectName || 'Untitled build',
                    idea: builderState.idea,
                    plan: builderState.plan,
                    theme: builderState.theme,
                    generatedFiles: files,
                });
                savedId = saved.id;
                setSavedBuilds(buildStorage.getSavedBuilds());
            } catch (saveError: any) {
                setGlobalError(`Build generated, but could not be saved to your library: ${saveError.message}`);
            }
            setBuilderState(prev => ({ ...prev, generatedFiles: files, savedBuildId: savedId, status: { ...prev.status, isLoading: false, message: 'Generation complete!' }, currentStep: 5 }));
        } catch (e: any) {
            setGlobalError(`Failed to generate code: ${e.message}`);
            setBuilderState(prev => ({ ...prev, status: { ...prev.status, isLoading: false, message: 'An error occurred during code generation.' }}));
        }
    };
    const loadGeneratedProjectIntoIDE = async () => {
        if (!builderState.generatedFiles || !builderState.plan.projectName) return;
        const newProject = await handleCreateProject(builderState.plan.projectName);
        for (const [path, content] of Object.entries(builderState.generatedFiles)) {
            await aiCreateFile(newProject.id, path, content);
        }
        resetWebAppBuild();
        setActiveTab('projects');
        handleSelectAgent(null); // Ensure no agent is active
        handleToggleProjectSelection(newProject.id); // Select the new project
    };

    const exportGeneratedProject = async () => {
        if (!builderState.generatedFiles || !builderState.plan.projectName) return;
        await createProjectZip(builderState.generatedFiles, builderState.plan.projectName);
    };

    // Saved build library
    const saveCurrentBuild = (name: string, asCopy = false) => {
        if (!builderState.generatedFiles) return;
        try {
            const saved = buildStorage.saveBuild({
                name: name.trim() || 'Untitled build',
                idea: builderState.idea,
                plan: builderState.plan,
                theme: builderState.theme,
                generatedFiles: builderState.generatedFiles,
            }, asCopy ? null : builderState.savedBuildId);
            setSavedBuilds(buildStorage.getSavedBuilds());
            setBuilderState(prev => ({ ...prev, savedBuildId: saved.id, status: { ...prev.status, message: `Saved as "${saved.name}"` } }));
        } catch (e: any) {
            setGlobalError(e.message);
        }
    };

    const loadSavedBuild = (id: string) => {
        const build = buildStorage.getSavedBuilds().find(b => b.id === id);
        if (!build) { setGlobalError('That saved build could no longer be found.'); return; }
        setBuilderState({
            ...initialBuilderState,
            isActive: true,
            currentStep: 5,
            idea: build.idea ?? '',
            plan: build.plan,
            theme: build.theme ?? initialBuilderState.theme,
            generatedFiles: build.generatedFiles,
            savedBuildId: build.id,
            status: { isLoading: false, log: [], message: `Loaded "${build.name}"` },
        });
        setActiveTab('tools');
    };

    const removeSavedBuild = (id: string) => {
        setSavedBuilds(buildStorage.deleteSavedBuild(id));
        setBuilderState(prev => prev.savedBuildId === id ? { ...prev, savedBuildId: null } : prev);
    };

    const exportSavedBuild = async (id: string) => {
        const build = buildStorage.getSavedBuilds().find(b => b.id === id);
        if (!build) { setGlobalError('That saved build could no longer be found.'); return; }
        await createProjectZip(build.generatedFiles, build.name);
    };

    const value = {
        projects, selectedProjectIds, filesByProject, activeProjectView, editingProject, isProjectPanelCollapsed, analyzingProjects,
        activeTab, setActiveTab,
        handleCreateProject, handleDeleteProject, handleToggleProjectSelection, handleViewProjectFiles, handleAddFile, handleDeleteFile,
        aiCreateFile, aiUpdateFile, aiDeleteFile,
        handleSaveFileContent, handleOpenProjectSettings, handleCloseProjectSettings, handleRenameProject, handleToggleProjectPanel,
        setSelectedProjectIds,
        useWebSearch, setUseWebSearch, lowLatencyMode, setLowLatencyMode,
        selectedModel, setSelectedModel,
        customAiStyles, handleAddCustomStyle, handleUpdateCustomStyle, handleDeleteCustomStyle,
        personas, selectedPersonaId, handleSelectPersona, handleSavePersona, handleDeletePersona,
        activePersona, setActivePersona,
        agents, activeAgentId, handleAddAgent, handleUpdateAgent, handleDeleteAgent, handleSelectAgent,
        globalError, setGlobalError,
        builderState, setBuilderState, startWebAppBuild, resetWebAppBuild, generateWebAppPlan, refineWebAppPlan, suggestArtDirections, generateWebAppCode, loadGeneratedProjectIntoIDE, exportGeneratedProject,
        savedBuilds, saveCurrentBuild, loadSavedBuild, removeSavedBuild, exportSavedBuild,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
};