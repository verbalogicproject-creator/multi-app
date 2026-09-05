import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { Project, ProjectFile, CustomAiStyle, Persona, Agent, AiResponseStyle } from '../types/index';
import * as storageService from '../services/geminiService';
import * as apiService from '../services/apiService';
import type { CatalogModel } from '../services/apiService';
import type { Surface } from '../types/ui';
import * as buildStorage from '../services/buildStorage';
import type { SavedBuild } from '../services/buildStorage';
import * as memoryService from '../services/memoryService';
import { runTypecheck } from '../services/typecheckService';
import { previewVerdict } from '../services/previewVerdict';
import type { EpisodeOutcome, MemoryEvent, MemoryEvidence } from '../services/memoryService';
import { DEFAULT_PALETTE, sanitizeColors, type ArtDirection, type ThemeColors } from '../utils/palettes';
import { validateBuild, type BuildValidation } from '../utils/validateBuild';
import { generateUniqueId } from '../utils/common';
import { createProjectZip } from '../utils/export';

export interface BuildEvent {
    ts: number;
    event: string;
}

const MAX_EVIDENCE = 50;
/** Appends to the build's evidence trail, keeping only the most recent entries. */
const withEvidence = (evidence: BuildEvent[], event: string): BuildEvent[] =>
    [...evidence, { ts: Date.now(), event }].slice(-MAX_EVIDENCE);

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
    // A fresh generation lands here first and is only promoted once it passes
    // validation, so a bad run can never overwrite a good build.
    candidateFiles: Record<string, string> | null;
    validation: BuildValidation | null;
    artDirections: ArtDirection[] | null;
    // Time-ordered record of what was asked, decided and produced for this build.
    evidence: BuildEvent[];
    savedBuildId: string | null;   // links this build to its entry in the saved library
    /**
     * This build's link to the memory engine. `buildId` names its database;
     * `episodeId` is set ONLY while an episode is open, so a stale one found at
     * startup is an attempt a reload cut short. `lastOutcome` is how the next
     * attempt knows it is a repair rather than a first try.
     */
    memory: {
        buildId: string | null;
        episodeId: string | null;
        lastOutcome: EpisodeOutcome | null;
        /**
         * The model that actually served this build's generation, which is only
         * known once it is over. Kept in state because the decision it attributes —
         * keeping or discarding a held candidate — can happen after a reload, by
         * which time nothing else remembers who wrote the code.
         */
        servingModel: string | null;
    };
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
    candidateFiles: null,
    validation: null,
    artDirections: null,
    evidence: [],
    savedBuildId: null,
    memory: { buildId: null, episodeId: null, lastOutcome: null, servingModel: null },
    status: { message: '', isLoading: false, log: [] },
};

const OUTCOMES: EpisodeOutcome[] = ['verified', 'failed', 'abandoned'];

/**
 * Occurrence count per stable issue code.
 *
 * A verdict is recorded as codes rather than messages because events are
 * immutable: reword a validator message a year from now and every stored verdict
 * keyed on the old wording becomes a different kind of failure to whatever reads
 * them. The code is the thing that is allowed to be compared across time.
 */
const issueCodes = (validation: BuildValidation): Record<string, number> =>
    validation.issues.reduce<Record<string, number>>((counts, issue) => {
        counts[issue.code] = (counts[issue.code] ?? 0) + 1;
        return counts;
    }, {});

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

export const restoreBuilderState = (): WebAppBuilderState => {
    const persisted = buildStorage.loadBuilderState();
    if (!persisted) return initialBuilderState;

    // A held candidate also sits at step 4 without generatedFiles — that is a result
    // awaiting a decision, not an interrupted run.
    const interrupted = persisted.currentStep === 4 && !persisted.generatedFiles && !persisted.candidateFiles;
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
        evidence: Array.isArray(persisted.evidence) ? persisted.evidence : [],
        candidateFiles: persisted.candidateFiles ?? null,
        validation: persisted.validation ?? null,
        savedBuildId: persisted.savedBuildId ?? null,
        memory: {
            // A build in progress from before memory existed gets its cluster now
            // rather than never: with no id, every tap for the rest of this build
            // would silently no-op.
            buildId: persisted.memory?.buildId ?? memoryService.newBuildId(),
            episodeId: persisted.memory?.episodeId ?? null,
            lastOutcome: OUTCOMES.includes(persisted.memory?.lastOutcome as EpisodeOutcome)
                ? (persisted.memory!.lastOutcome as EpisodeOutcome)
                : null,
            servingModel: persisted.memory?.servingModel ?? null,
        },
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


interface AppContextType {
    projects: Project[];
    selectedProjectIds: Set<string>;
    filesByProject: Map<string, ProjectFile[]>;
    activeProjectView: string | null;
    /** Loads a project's files if they are not in the map yet. See its definition. */
    ensureProjectFiles: (projectId: string) => Promise<void>;
    editingProject: Project | null;
    analyzingProjects: Set<string>;
    /**
     * Which destination is on screen. It lives here, not in `App`, because things that
     * are not the dock need to move you — the builder's hand-off has to be able to land
     * you in the IDE it just filled, and choosing an expert has to land you in the
     * conversation it changed.
     *
     * It was `MobileSurface` when the phone had destinations and the desktop had a
     * layout. There is one layout now, so it is just `Surface`.
     */
    surface: Surface;
    setSurface: React.Dispatch<React.SetStateAction<Surface>>;
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
    setSelectedProjectIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    useWebSearch: boolean;
    setUseWebSearch: React.Dispatch<React.SetStateAction<boolean>>;
    lowLatencyMode: boolean;
    setLowLatencyMode: React.Dispatch<React.SetStateAction<boolean>>;
    selectedModel: string;                 // 'auto' or a concrete model id from the catalog
    setSelectedModel: (model: string) => void;
    catalog: CatalogModel[];               // models this backend can actually serve
    modelDefaults: Record<string, string>; // surface -> default model id
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
    promoteCandidate: () => void;
    discardCandidate: () => void;
    recordEvidence: (event: string) => void;
    noteDirectionSelected: (direction: ArtDirection, index: number) => void;
    quotaTick: number;
    bumpQuotaTick: () => void;
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
    // Read by `ensureProjectFiles`, which must stay referentially stable (it is an
    // effect dependency) while still seeing the current map.
    const filesByProjectRef = useRef(filesByProject);
    filesByProjectRef.current = filesByProject;
    const [activeProjectView, setActiveProjectView] = useState<string | null>(null);
    const [editingProject, setEditingProject] = useState<Project | null>(null);
    const [analyzingProjects, setAnalyzingProjects] = useState<Set<string>>(new Set());

    const [useWebSearch, setUseWebSearch] = useState(false);
    const [lowLatencyMode, setLowLatencyMode] = useState(false);
    const [selectedModel, setSelectedModelState] = useState<string>(() => {
        try { return localStorage.getItem('gemini_selected_model') || 'auto'; } catch { return 'auto'; }
    });
    const setSelectedModel = (model: string) => {
        setSelectedModelState(model);
        try { localStorage.setItem('gemini_selected_model', model); } catch { /* non-fatal */ }
    };

    // The catalog is served by the backend so that a provider without an API key,
    // or a model that provider will not actually serve, never appears in the picker.
    const [catalog, setCatalog] = useState<CatalogModel[]>([]);
    const [modelDefaults, setModelDefaults] = useState<Record<string, string>>({});
    useEffect(() => {
        let cancelled = false;
        apiService.getModels().then(result => {
            if (cancelled || !result) return;
            setCatalog(result.models);
            setModelDefaults(result.defaults ?? {});
            // A previously chosen model can disappear (key removed, model retired):
            // fall back to auto rather than sending an id the server will reject.
            setSelectedModelState(prev => (prev === 'auto' || result.models.some(m => m.id === prev)) ? prev : 'auto');
        });
        return () => { cancelled = true; };
    }, []);
    const [customAiStyles, setCustomAiStyles] = useState<CustomAiStyle[]>([]);
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
    const [activePersona, setActivePersona] = useState<Persona>(defaultPersona);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
    /**
     * Where you are. One value, because the dock is the only navigation.
     *
     * It used to be two: this, plus an `activeTab` naming a tab inside a rail that no
     * longer exists. Two values for one question is how the old shell came to disagree
     * with itself — the tab said `AI Tools` while the surface rendered something else.
     *
     * Landing on the builder when a build was interrupted is the one piece of that
     * state worth keeping, so it moves here: a reload never looks like data loss, and
     * `Projects` is home otherwise.
     */
    const [surface, setSurface] = useState<Surface>(
        () => getRestoredBuilderState().isActive ? 'build' : 'projects',
    );

    const [globalError, setGlobalError] = useState<string | null>(null);
    // Bumped after every served model request so quota badges refetch.
    const [quotaTick, setQuotaTick] = useState(0);
    const bumpQuotaTick = useCallback(() => setQuotaTick(t => t + 1), []);

    const [builderState, setBuilderState] = useState<WebAppBuilderState>(getRestoredBuilderState);
    const [savedBuilds, setSavedBuilds] = useState<SavedBuild[]>(() => buildStorage.getSavedBuilds());

    // Persist the durable half of builder state. Deliberately keyed on content
    // fields only — `status` churns on every streaming progress event and must
    // not trigger a localStorage write per chunk.
    const { isActive: builderIsActive, currentStep: builderStep, idea: builderIdea,
            plan: builderPlan, theme: builderTheme, generatedFiles: builderFiles,
            artDirections: builderDirections, candidateFiles: builderCandidate,
            validation: builderValidation, evidence: builderEvidence,
            savedBuildId: builderSavedId, memory: builderMemory } = builderState;
    useEffect(() => {
        const failure = buildStorage.saveBuilderState({
            isActive: builderIsActive,
            currentStep: builderStep,
            idea: builderIdea,
            plan: builderPlan,
            theme: builderTheme,
            generatedFiles: builderFiles,
            artDirections: builderDirections,
            candidateFiles: builderCandidate,
            validation: builderValidation,
            evidence: builderEvidence,
            savedBuildId: builderSavedId,
            memory: builderMemory,
        });
        if (failure) setGlobalError(failure);
    }, [builderIsActive, builderStep, builderIdea, builderPlan, builderTheme, builderFiles, builderDirections, builderCandidate, builderValidation, builderEvidence, builderSavedId, builderMemory]);

    /**
     * A generation cut short by a reload or a crash leaves its episode open, and the
     * engine reuses an open episode for the same objective rather than forking a
     * second one. So an orphan does not merely sit there: it silently absorbs the
     * next genuine attempt, and two runs become one record. Close it before anything
     * can join it.
     */
    const orphanHandled = useRef(false);
    useEffect(() => {
        if (orphanHandled.current) return;   // React 18 remounts effects in development
        orphanHandled.current = true;
        const { buildId, episodeId } = getRestoredBuilderState().memory;
        if (!buildId || !episodeId) return;
        memoryService.closeEpisode(buildId, episodeId, 'abandoned');
        setMemory({ episodeId: null, lastOutcome: 'abandoned' });
    }, []);

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
        /* An active agent bound to the project that just went away is still active, and
           still names it — so chat would go on sending a dead id as its context. Stand
           the agent down rather than rewriting its record: the binding is data the spine
           migration owns, but an agent working on nothing should not stay selected.
           `App` separately refuses to open the IDE on a project that is not loaded, so
           the two together mean a deletion cannot leave a live surface pointing at it. */
        if (agents.find(a => a.id === activeAgentId)?.projectId === id) handleSelectAgent(null);
    };
    const handleToggleProjectSelection = (id: string) => {
        setSelectedProjectIds((prev: Set<string>) => { 
            const newSet = new Set(prev); 
            if (newSet.has(id)) newSet.delete(id); 
            else newSet.add(id); 
            return newSet; 
        });
    };
    /**
     * `filesByProject` is filled lazily, and until this existed the *only* thing that
     * filled it was expanding a project in the old rail. Any surface that opened a
     * project's files directly — the IDE — therefore showed an empty tree for a project
     * that had files, which was invisible while the IDE was only ever reached by way of
     * the rail and obvious the moment Code became a destination of its own.
     */
    const ensureProjectFiles = useCallback(async (projectId: string) => {
        if (!projectId || filesByProjectRef.current.has(projectId)) return;
        const files = await storageService.getFilesByProject(projectId);
        setFilesByProject(prev => prev.has(projectId) ? prev : new Map(prev).set(projectId, files));
    }, []);

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
            /* Choosing an expert changes who you are talking to, so it lands you in the
               conversation. It used to select a tab in a rail — a selection whose only
               visible effect was somewhere you were not. */
            setSurface('chat');
        } else {
            setSelectedProjectIds(new Set());
            setSelectedPersonaId(null);
        }
    };

    // Builder Handlers
    /** Adds a line to the current build's evidence trail. */
    const recordEvidence = useCallback((event: string) => {
        setBuilderState(prev => ({ ...prev, evidence: withEvidence(prev.evidence, event) }));
    }, []);
    // ---- memory taps -----------------------------------------------------------
    // Every call below is best-effort by construction: memoryService answers null
    // instead of throwing, and no builder transition waits on one. A tap must never
    // be the reason a build behaves differently.

    /**
     * Splits a model id into the attribution the engine stores. The provider comes
     * from the catalog rather than from parsing the id, and a model the catalog does
     * not know — a fallback can serve one that was never in the picker — is recorded
     * with no provider rather than a guessed one.
     */
    const attributionFor = (model: string | null | undefined): { provider?: string; model?: string } => {
        if (!model) return {};
        const entry = catalog.find(m => m.id === model);
        return entry ? { provider: entry.provider, model: entry.id } : { model };
    };

    /**
     * The memory link, mirrored where an async handler can actually read it.
     *
     * A handler closes over the `builderState` of the render that created it. A
     * generation opens its episode *during* that handler — after that render — so
     * `promoteFiles`, called at the end of the very generation that opened the
     * episode, would read the id from before it existed and close nothing. A
     * successful build would leave its episode open, to be found and marked
     * `abandoned` by the next reload: the exact inverse of what it was.
     *
     * Every tap therefore reads the ref, and the ref is written at the same moment
     * the state is.
     */
    const memoryRef = useRef(builderState.memory);

    /** Writes the link to the ref (read now) and to state (rendered, persisted). */
    const setMemory = (patch: Partial<WebAppBuilderState['memory']>) => {
        memoryRef.current = { ...memoryRef.current, ...patch };
        setBuilderState(prev => ({ ...prev, memory: { ...prev.memory, ...patch } }));
    };

    // Deliberately NOT synchronised back from state by an effect. Every write to the
    // link goes through `setMemory`, or through an explicit assignment beside a
    // wholesale replacement, so the ref is never behind — and an effect copying
    // state over it would run after the orphan closer on mount and restore the very
    // episode id that closer had just cleared.

    /** Records events against whatever episode this build currently has open. */
    const recordMemory = (events: MemoryEvent[], evidence: MemoryEvidence[] = []) => {
        memoryService.record(memoryRef.current.buildId, memoryRef.current.episodeId, events, evidence);
    };

    /** Abandons an episode this build left open, if any. A no-op when there is none. */
    const abandonOpenEpisode = () => {
        const { buildId, episodeId, servingModel } = memoryRef.current;
        memoryService.closeEpisode(buildId, episodeId, 'abandoned', attributionFor(servingModel));
    };

    const startWebAppBuild = () => {
        abandonOpenEpisode();   // starting over abandons whatever the last build left open
        const memory = { buildId: memoryService.newBuildId(), episodeId: null, lastOutcome: null, servingModel: null };
        memoryRef.current = memory;
        setBuilderState({ ...initialBuilderState, isActive: true, currentStep: 1, memory });
    };
    const resetWebAppBuild = () => {
        abandonOpenEpisode();
        memoryRef.current = initialBuilderState.memory;
        setBuilderState(initialBuilderState);
    };
    const generateWebAppPlan = async () => {
        setBuilderState(prev => ({ ...prev, status: { ...prev.status, isLoading: true, message: 'AI is analyzing your idea and creating a blueprint...' }}));
        try {
            const plan = await apiService.generateWebAppPlan(
                builderState.idea,
                selectedModel === 'auto' ? undefined : selectedModel,
                undefined,
                memoryRef.current,
            );
            bumpQuotaTick();
            setBuilderState(prev => ({
                ...prev, plan, currentStep: 2,
                evidence: withEvidence(prev.evidence, `Blueprint drafted for "${prev.idea.slice(0, 80)}" — ${plan?.pages?.length ?? 0} pages, ${plan?.components?.length ?? 0} components`),
                status: { ...prev.status, isLoading: false, message: '' },
            }));
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
                memoryRef.current,
            );
            // Model output is untrusted: every colour is re-validated as hex before use.
            const artDirections: ArtDirection[] = raw.slice(0, 3).map((d: any) => ({
                name: String(d?.name ?? 'Untitled direction'),
                rationale: String(d?.rationale ?? ''),
                typography: String(d?.typography ?? 'Sans-serif & Friendly'),
                colors: sanitizeColors(d?.colors),
            }));
            bumpQuotaTick();
            setBuilderState(prev => ({
                ...prev, artDirections,
                evidence: withEvidence(prev.evidence, `AI proposed ${artDirections.length} art directions: ${artDirections.map(d => d.name).join(', ')}`),
                status: { ...prev.status, isLoading: false, message: '' },
            }));
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
                memoryRef.current,
            );
            bumpQuotaTick();
            setBuilderState(prev => ({
                ...prev, plan,
                evidence: withEvidence(prev.evidence, `Blueprint revised: "${feedback.slice(0, 100)}"`),
                status: { ...prev.status, isLoading: false, message: 'Blueprint revised.' },
            }));
        } catch (e: any) {
            setGlobalError(`Failed to revise plan: ${e.message}`);
            setBuilderState(prev => ({ ...prev, status: { ...prev.status, isLoading: false, message: '' } }));
        }
    };

    /**
     * Records which proposed art direction the user actually adopted.
     *
     * The server already records that three were offered. Without this, nothing
     * anywhere says which one won — and "what did they choose from what I proposed"
     * is the only question the proposals were ever evidence for.
     */
    const noteDirectionSelected = (direction: ArtDirection, index: number) => {
        recordMemory([{
            kind: 'direction.selected',
            surface: 'builder.theme',
            // Taste territory in the engine's vocabulary, and deliberately so: a
            // palette choice must not recall as strongly as a build failure.
            domain: 'art-direction',
            payload: {
                name: direction.name,
                index,
                typography: direction.typography,
                offered: builderState.artDirections?.length ?? 0,
            },
        }]);
    };

    /**
     * Adopts a file set as the build: saves it and advances to export.
     *
     * `servedModelId` and `evidenceBase` are passed in by the generation that
     * produced these files, because state written moments earlier is not visible in
     * this closure. Without the base, the "Generation requested — style X" line this
     * very run had just added was overwritten here and lost from the saved build.
     * Both fall back to state for the other caller, where the decision is a human
     * one taken later — possibly after a reload.
     */
    const promoteFiles = (
        files: Record<string, string>,
        validation: BuildValidation,
        note: string,
        servedModelId?: string | null,
        evidenceBase?: BuildEvent[],
    ) => {
        const evidence = withEvidence(evidenceBase ?? builderState.evidence, note);
        const { buildId, episodeId } = memoryRef.current;
        const model = servedModelId ?? memoryRef.current.servingModel;
        let savedId: string | null = null;
        try {
            const saved = buildStorage.saveBuild({
                name: builderState.plan?.projectName || 'Untitled build',
                idea: builderState.idea,
                plan: builderState.plan,
                theme: builderState.theme,
                generatedFiles: files,
                evidence,
                validation,
                ...(buildId ? { memory: { buildId, episodeId } } : {}),
            });
            savedId = saved.id;
            setSavedBuilds(buildStorage.getSavedBuilds());
        } catch (saveError: any) {
            setGlobalError(`Build generated, but could not be saved to your library: ${saveError.message}`);
        }

        /*
         * The validator's verdict decides the outcome, never the act of adopting the
         * result. A human keeping a candidate the validator rejected is a decision
         * worth recording — it is not a verification, and closing it as one would let
         * an override manufacture the very evidence a lesson is later promoted on.
         */
        const outcome: EpisodeOutcome = validation.ok ? 'verified' : 'failed';
        memoryService.record(buildId, episodeId, [{
            kind: 'revision.promoted',
            surface: 'builder.promote',
            domain: 'build',
            ...attributionFor(model),
            payload: { fileCount: Object.keys(files).length, savedBuildId: savedId, validationOk: validation.ok },
            evidenceKeys: ['revision'],
        }], [{
            key: 'revision',
            kind: 'artifact',
            ref: `build://${buildId ?? 'unknown'}/revision/${savedId ?? 'unsaved'}`,
            summary: note,
        }]);
        memoryService.closeEpisode(buildId, episodeId, outcome, attributionFor(model));

        setMemory({ episodeId: null, lastOutcome: outcome, servingModel: model });
        setBuilderState(prev => ({
            ...prev,
            generatedFiles: files,
            candidateFiles: null,
            validation,
            evidence,
            savedBuildId: savedId,
            status: { ...prev.status, isLoading: false, message: 'Generation complete!' },
            currentStep: 5,
        }));
    };

    /** Accepts a candidate the validator flagged (the user reviewed the issues). */
    const promoteCandidate = () => {
        const files = builderState.candidateFiles;
        if (!files) return;
        const validation = builderState.validation ?? validateBuild(files, builderState.plan);
        const errors = validation.issues.filter(i => i.severity === 'error').length;
        recordMemory([{
            kind: 'human.decision',
            surface: 'builder.candidate',
            domain: 'build',
            payload: { decision: 'kept-despite-validation', errors, codes: issueCodes(validation) },
        }]);
        promoteFiles(files, validation, `Kept despite validation: ${errors} error${errors === 1 ? '' : 's'} accepted by the user`);
    };

    /** Throws away a failed candidate and returns to the theme step. */
    const discardCandidate = () => {
        const { buildId, episodeId, servingModel } = memoryRef.current;
        const validation = builderState.validation;
        memoryService.record(buildId, episodeId, [{
            kind: 'human.decision',
            surface: 'builder.candidate',
            domain: 'build',
            ...attributionFor(servingModel),
            payload: {
                decision: 'discarded',
                errors: validation ? validation.issues.filter(i => i.severity === 'error').length : null,
                codes: validation ? issueCodes(validation) : {},
            },
        }]);
        memoryService.closeEpisode(buildId, episodeId, 'failed', attributionFor(servingModel));

        setMemory({ episodeId: null, lastOutcome: 'failed' });
        setBuilderState(prev => ({
            ...prev,
            candidateFiles: null,
            validation: null,
            currentStep: 3,
            evidence: withEvidence(prev.evidence, 'Candidate discarded; previous build left untouched'),
            status: { ...prev.status, isLoading: false, message: 'Candidate discarded. Your previous build is untouched.' },
        }));
    };

    const generateWebAppCode = async () => {
        const theme = builderState.theme;
        const { buildId, lastOutcome } = memoryRef.current;
        // Kept, because promoteFiles cannot see state written after this render and
        // would otherwise write a trail with this line missing.
        const requested = withEvidence(builderState.evidence, `Generation requested — style "${theme.palette}" / ${theme.typography}`);
        setBuilderState(prev => ({
            ...prev, currentStep: 4, candidateFiles: null, validation: null,
            evidence: requested,
            status: { isLoading: true, message: 'Contacting Gemini…', log: [] },
        }));

        /*
         * The one memory call that is awaited, because a null episode id is what
         * makes every tap below a no-op and they have to know which case they are in.
         * The server reuses an episode still open for the same objective, so a
         * double-tap or a remount joins the attempt in flight rather than forking it.
         */
        const episodeId = await memoryService.openEpisode(
            buildId,
            `generate ${builderState.plan?.projectName ?? 'a web application'} — style "${theme.palette}" / ${theme.typography}`,
            builderState.savedBuildId,
        );
        setMemory({ episodeId });

        // A generation that follows a failed or discarded one is a repair, and saying
        // so is the only thing that later distinguishes a first try from a retry.
        if (lastOutcome === 'failed') {
            memoryService.record(buildId, episodeId, [{
                kind: 'repair.attempted',
                surface: 'builder.generate',
                domain: 'build',
                payload: { after: lastOutcome },
            }]);
        }

        let servingModel = 'Gemini';      // for the user-facing evidence line
        let servedModelId: string | null = null;   // a real catalog id, or nothing
        try {
            const generated = await apiService.generateWebAppCode(builderState.plan, theme, selectedModel === 'auto' ? undefined : selectedModel, (event) => {
                if (event.model) { servingModel = event.model; servedModelId = event.model; }
                setBuilderState(prev => {
                    let message = prev.status.message;
                    let log = prev.status.log;
                    if (event.phase === 'planning') {
                        message = `${event.model ?? 'Gemini'} is deciding what files this needs…`;
                        log = [];
                    } else if (event.phase === 'thinking') {
                        message = `${event.model ?? 'Gemini'} is thinking about the architecture…`;
                        log = [];  // a fresh attempt (retry/fallback) restarts the file log
                    } else if (event.phase === 'writing') {
                        message = `${event.model ?? 'Gemini'} is writing code…`;
                    }
                    /* The manifest names every file before any of them is written, so
                       the count is known rather than watched. */
                    if (event.manifest) message = `Writing ${event.manifest.length} files…`;
                    /* A repair is worth naming rather than hiding behind "writing":
                       the build is being corrected, and saying so is the difference
                       between a slow success and an unexplained pause. */
                    if (event.phase === 'repairing') {
                        message = `Fixing ${event.files?.length ?? 0} file${event.files?.length === 1 ? '' : 's'} the compiler rejected…`;
                    }
                    if (event.progress) message = `Writing code… ${(event.progress / 1024).toFixed(1)} KB`;
                    if (event.file && !log.includes(event.file)) log = [...log, event.file];
                    return { ...prev, status: { ...prev.status, message, log } };
                });
            }, { buildId, episodeId });
            bumpQuotaTick();
            // The model's word is not evidence: check the files before adopting them.
            /**
             * A truncated generation is an instrument failure, not a verdict.
             *
             * The files that arrived are real and worth keeping — but the validators are
             * about to run over a project that is missing everything after the cut, and
             * will report exactly what you would expect: unbalanced braces, a missing
             * entry point. Every one of those is true of the text and false of the model.
             * `inconclusive` is what stops the lesson ladder learning from it; measured on
             * a real build, three lessons were proposed and all three were wrong.
             */
            const { files, truncated, missing } = generated;
            const lexical = validateBuild(files, builderState.plan);

            /*
             * And then a compiler, which is the judge the lexical pass cannot be.
             * `validateBuild` counts braces and resolves imports by regex; `tsc`
             * knows whether the code means anything. Both verdicts go into one
             * `BuildValidation`, so promotion, the evidence line and the single
             * `verification.completed` event below all see the same thing.
             *
             * Never allowed to block the transition. The checker is bounded server
             * side, and anything short of a completed answer — unreachable, timed
             * out, cancelled — leaves the lexical verdict standing alone. An
             * unfinished compile reports zero diagnostics, which is why `completed`
             * is read rather than the count: a checker that did not run must not be
             * able to certify a build.
             */
            setBuilderState(prev => ({ ...prev, status: { ...prev.status, message: 'Checking types…' } }));
            const typecheck = await runTypecheck(buildId ?? 'build', files, 0);
            const typed: BuildValidation = typecheck?.completed
                ? {
                    ok: lexical.ok && typecheck.ok,
                    issues: [...lexical.issues, ...typecheck.issues],
                    checked: lexical.checked,
                }
                : lexical;

            /*
             * And last, the only judge that does not read the code.
             *
             * Everything above can pass over an app that mounts a blank page: braces
             * balance, types agree, modules resolve, and nothing renders. The preview
             * bundles the project and runs it in a sandboxed frame, so "it threw" and
             * "it drew nothing" become verdicts instead of something a person notices
             * later — the first evidence in this pipeline that comes from behaviour
             * rather than from text, and impossible to collect before the preview
             * could execute a build at all.
             *
             * Same contract as the typechecker: `null` is no opinion, never a pass.
             * A judge that did not run must not be able to certify or condemn.
             */
            setBuilderState(prev => ({ ...prev, status: { ...prev.status, message: 'Running it…' } }));
            const behaviour = await previewVerdict(buildId ?? 'build', files);
            const validation: BuildValidation = behaviour
                ? {
                    ok: typed.ok && behaviour.length === 0,
                    issues: [...typed.issues, ...behaviour],
                    checked: typed.checked,
                }
                : typed;

            const fileCount = Object.keys(files).length;
            const errors = validation.issues.filter(i => i.severity === 'error').length;

            /*
             * The verdict, whichever way it went. A failed check is a result, not an
             * absence of one — recording only the passes would leave the memory
             * describing a builder that never gets anything wrong.
             */
            memoryService.record(buildId, episodeId, [{
                kind: 'verification.completed',
                surface: 'builder.generate',
                domain: 'build',
                ...attributionFor(servedModelId),
                payload: {
                    ok: validation.ok,
                    checked: validation.checked,
                    errors,
                    warnings: validation.issues.length - errors,
                    codes: issueCodes(validation),
                    fileCount,
                    /* Read by `proposalsFor`, which refuses to propose from it. */
                    ...(truncated ? { inconclusive: true } : {}),
                },
                evidenceKeys: ['validation'],
            }], [{
                key: 'validation',
                kind: 'validation',
                ref: `build://${buildId ?? 'unknown'}/episode/${episodeId ?? 'none'}/validation`,
                summary: validation.ok
                    ? `Validation passed over ${validation.checked} files.`
                    : `Validation failed over ${validation.checked} files: ${validation.issues
                        .filter(i => i.severity === 'error')
                        .slice(0, 5)
                        .map(i => `${i.code}${i.file ? ` (${i.file})` : ''}`)
                        .join('; ')}`,
            }]);

            if (!validation.ok) {
                // The episode stays open: a held candidate is a decision still pending,
                // and it is that decision — keep or discard — that closes it.
                setMemory({ servingModel: servedModelId });
                setBuilderState(prev => ({
                    ...prev,
                    candidateFiles: files,
                    validation,
                    /* A truncated run must not be described as a failed one. The
                       errors below are real, but they describe a project that was cut
                       short — not a model that wrote it badly, and saying otherwise
                       teaches the reader the same false lesson the ladder is now
                       guarded against. */
                    evidence: withEvidence(prev.evidence, truncated
                        ? `${servingModel} was cut off by its output budget — ${fileCount} complete file${fileCount === 1 ? '' : 's'} recovered, held for review`
                        : missing.length > 0
                            ? `${servingModel} wrote ${fileCount} of ${fileCount + missing.length} planned files — ${missing.length} never arrived (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}), held for review`
                            : `${servingModel} wrote ${fileCount} files — validation failed with ${errors} error${errors === 1 ? '' : 's'}, held for review`),
                    status: { ...prev.status, isLoading: false, message: truncated
                        ? `The model ran out of output budget. ${fileCount} complete file${fileCount === 1 ? '' : 's'} were recovered; the rest were never written.`
                        : 'Generation finished, but the result did not pass validation.' },
                }));
                return;
            }
            const warnings = validation.issues.length;
            promoteFiles(files, validation, `${servingModel} wrote ${fileCount} files — validation passed${warnings ? ` with ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`, servedModelId, requested);
        } catch (e: any) {
            setGlobalError(`Failed to generate code: ${e.message}`);
            // An attempt that threw is over, and an episode left open would be joined
            // by the next one rather than starting it.
            memoryService.closeEpisode(buildId, episodeId, 'failed', attributionFor(servedModelId));
            setMemory({ episodeId: null, lastOutcome: 'failed', servingModel: servedModelId });
            setBuilderState(prev => ({
                ...prev,
                evidence: withEvidence(prev.evidence, `Generation failed: ${e.message}`),
                status: { ...prev.status, isLoading: false, message: 'An error occurred during code generation.' },
            }));
        }
    };
    const loadGeneratedProjectIntoIDE = async () => {
        if (!builderState.generatedFiles || !builderState.plan.projectName) return;
        const newProject = await handleCreateProject(builderState.plan.projectName);
        for (const [path, content] of Object.entries(builderState.generatedFiles)) {
            await aiCreateFile(newProject.id, path, content);
        }
        resetWebAppBuild();
        /* Order matters: deselecting an agent clears the project selection, so the
           new project has to be selected *after*, not before. */
        handleSelectAgent(null);
        handleToggleProjectSelection(newProject.id);
        /* And then actually open it. This button is named "Open in IDE"; until now
           it created the project, wrote every file, and left you looking at a list.
           On a phone that is the difference between the feature existing and the
           feature being reachable — from `md:` up the IDE is already on screen. */
        setSurface('code');
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
                evidence: builderState.evidence,
                validation: builderState.validation,
                ...(memoryRef.current.buildId
                    ? { memory: { buildId: memoryRef.current.buildId, episodeId: memoryRef.current.episodeId } }
                    : {}),
            }, asCopy ? null : builderState.savedBuildId);
            setSavedBuilds(buildStorage.getSavedBuilds());
            setBuilderState(prev => ({
                ...prev, savedBuildId: saved.id,
                evidence: withEvidence(prev.evidence, `Saved to library as "${saved.name}"`),
                status: { ...prev.status, message: `Saved as "${saved.name}"` },
            }));
        } catch (e: any) {
            setGlobalError(e.message);
        }
    };

    const loadSavedBuild = (id: string) => {
        const build = buildStorage.getSavedBuilds().find(b => b.id === id);
        if (!build) { setGlobalError('That saved build could no longer be found.'); return; }
        abandonOpenEpisode();   // whatever was in progress is being left behind
        // Reopening a build resumes its memory cluster, so further work lands beside
        // the history that produced it. A build saved before memory existed gets a
        // cluster of its own from here on.
        const memory = {
            buildId: build.memory?.buildId ?? memoryService.newBuildId(),
            episodeId: null,
            lastOutcome: null,
            servingModel: null,
        };
        memoryRef.current = memory;
        setBuilderState({
            ...initialBuilderState,
            isActive: true,
            currentStep: 5,
            idea: build.idea ?? '',
            plan: build.plan,
            theme: build.theme ?? initialBuilderState.theme,
            generatedFiles: build.generatedFiles,
            evidence: Array.isArray(build.evidence) ? build.evidence : [],
            validation: (build.validation as BuildValidation | undefined) ?? null,
            savedBuildId: build.id,
            memory,
            status: { isLoading: false, log: [], message: `Loaded "${build.name}"` },
        });
        setSurface('build');
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
        projects, selectedProjectIds, filesByProject, activeProjectView, editingProject, analyzingProjects,
        ensureProjectFiles,
        surface, setSurface,
        handleCreateProject, handleDeleteProject, handleToggleProjectSelection, handleViewProjectFiles, handleAddFile, handleDeleteFile,
        aiCreateFile, aiUpdateFile, aiDeleteFile,
        handleSaveFileContent, handleOpenProjectSettings, handleCloseProjectSettings, handleRenameProject,
        setSelectedProjectIds,
        useWebSearch, setUseWebSearch, lowLatencyMode, setLowLatencyMode,
        selectedModel, setSelectedModel, catalog, modelDefaults,
        customAiStyles, handleAddCustomStyle, handleUpdateCustomStyle, handleDeleteCustomStyle,
        personas, selectedPersonaId, handleSelectPersona, handleSavePersona, handleDeletePersona,
        activePersona, setActivePersona,
        agents, activeAgentId, handleAddAgent, handleUpdateAgent, handleDeleteAgent, handleSelectAgent,
        globalError, setGlobalError,
        builderState, setBuilderState, startWebAppBuild, resetWebAppBuild, generateWebAppPlan, refineWebAppPlan, suggestArtDirections, generateWebAppCode, loadGeneratedProjectIntoIDE, exportGeneratedProject,
        savedBuilds, saveCurrentBuild, loadSavedBuild, removeSavedBuild, exportSavedBuild,
        promoteCandidate, discardCandidate, recordEvidence, noteDirectionSelected, quotaTick, bumpQuotaTick,
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