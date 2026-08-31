
import { Agent, CustomAiStyle, Persona, Project, ProjectFile } from "../types/index";

// Local Storage Keys for persisting project data
const PROJECTS_KEY = 'gemini_projects';
const FILES_KEY_PREFIX = 'gemini_files_';
const CUSTOM_STYLES_KEY = 'gemini_custom_ai_styles';
const PERSONAS_KEY = 'gemini_personas';
const AGENTS_KEY = 'gemini_agents';

// =========================================================================================
// Generic Local Storage Helpers
// =========================================================================================

const getFromStorage = <T>(key: string, defaultValue: T): T => {
    try {
        const data = localStorage.getItem(key);
        if (data) return JSON.parse(data) as T;
        return defaultValue;
    } catch (e) {
        console.error(`Failed to parse key "${key}" from localStorage`, e);
        return defaultValue;
    }
};

const saveToStorage = <T>(key: string, data: T) => {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.error(`Failed to save key "${key}" to localStorage`, e);
    }
};


// =========================================================================================
// Agent Management
// =========================================================================================
export const getAgents = async (): Promise<Agent[]> => getFromStorage<Agent[]>(AGENTS_KEY, []);
export const addAgent = async (agent: Agent): Promise<void> => {
    const agents = await getAgents();
    saveToStorage(AGENTS_KEY, [...agents, agent]);
};
export const updateAgent = async (updatedAgent: Agent): Promise<void> => {
    const agents = await getAgents();
    saveToStorage(AGENTS_KEY, agents.map(a => a.id === updatedAgent.id ? updatedAgent : a));
};
export const deleteAgent = async (agentId: string): Promise<void> => {
    const agents = await getAgents();
    saveToStorage(AGENTS_KEY, agents.filter(a => a.id !== agentId));
};

// =========================================================================================
// Persona Management
// =========================================================================================
export const getPersonas = async (): Promise<Persona[]> => getFromStorage<Persona[]>(PERSONAS_KEY, []);
export const addPersona = async (persona: Persona): Promise<void> => {
    const personas = await getPersonas();
    saveToStorage(PERSONAS_KEY, [...personas, persona]);
};
export const updatePersona = async (updatedPersona: Persona): Promise<void> => {
    const personas = await getPersonas();
    saveToStorage(PERSONAS_KEY, personas.map(p => p.id === updatedPersona.id ? updatedPersona : p));
};
export const deletePersona = async (personaId: string): Promise<void> => {
    const agents = await getAgents();
    const agentsUsingPersona = agents.filter(a => a.personaId === personaId);
    if (agentsUsingPersona.length > 0) {
        const agentNames = agentsUsingPersona.map(a => `"${a.name}"`).join(', ');
        throw new Error(`Cannot delete this persona. It is used by agent(s): ${agentNames}. Please edit the agent(s) first.`);
    }
    const personas = await getPersonas();
    saveToStorage(PERSONAS_KEY, personas.filter(p => p.id !== personaId));
};

// =========================================================================================
// Custom AI Style Management
// =========================================================================================
export const getCustomAiStyles = async (): Promise<CustomAiStyle[]> => getFromStorage<CustomAiStyle[]>(CUSTOM_STYLES_KEY, []);
export const addCustomAiStyle = async (style: CustomAiStyle): Promise<void> => {
    const styles = await getCustomAiStyles();
    saveToStorage(CUSTOM_STYLES_KEY, [...styles, style]);
};
export const updateCustomAiStyle = async (updatedStyle: CustomAiStyle): Promise<void> => {
    const styles = await getCustomAiStyles();
    const oldStyle = styles.find(s => s.id === updatedStyle.id);
    const newStyles = styles.map(s => s.id === updatedStyle.id ? updatedStyle : s);

    if (oldStyle && oldStyle.name !== updatedStyle.name) {
        const personas = await getPersonas();
        const updatedPersonas = personas.map(p => ({
            ...p,
            composedStyles: p.composedStyles.map(cs => cs.name === oldStyle.name ? { ...cs, name: updatedStyle.name } : cs)
        }));
        saveToStorage(PERSONAS_KEY, updatedPersonas);
    }
    saveToStorage(CUSTOM_STYLES_KEY, newStyles);
};
export const deleteCustomAiStyle = async (styleId: string): Promise<void> => {
    const styles = await getCustomAiStyles();
    const styleToDelete = styles.find(s => s.id === styleId);
    if (!styleToDelete) return;

    const newStyles = styles.filter(s => s.id !== styleId);
    const personas = await getPersonas();
    const updatedPersonas = personas.map(p => ({ ...p, composedStyles: p.composedStyles.filter(cs => cs.name !== styleToDelete.name) }));
    saveToStorage(PERSONAS_KEY, updatedPersonas);
    saveToStorage(CUSTOM_STYLES_KEY, newStyles);
};

// =========================================================================================
// Project & File Management
// =========================================================================================
export const getProjects = async (): Promise<Project[]> => getFromStorage<Project[]>(PROJECTS_KEY, []);
export const addProject = async (project: Project): Promise<void> => { const projects = await getProjects(); saveToStorage(PROJECTS_KEY, [...projects, project]); };
export const deleteProject = async (projectId: string): Promise<void> => {
    saveToStorage(PROJECTS_KEY, (await getProjects()).filter(p => p.id !== projectId));
    localStorage.removeItem(`${FILES_KEY_PREFIX}${projectId}`);
    saveToStorage(AGENTS_KEY, (await getAgents()).filter(a => a.projectId !== projectId));
};
export const updateProject = async (updatedProject: Project): Promise<void> => { const projects = await getProjects(); saveToStorage(PROJECTS_KEY, projects.map(p => p.id === updatedProject.id ? updatedProject : p)); };
export const getFilesByProject = async (projectId: string): Promise<ProjectFile[]> => getFromStorage<ProjectFile[]>(`${FILES_KEY_PREFIX}${projectId}`, []);
export const addFile = async (file: ProjectFile): Promise<void> => { const files = await getFilesByProject(file.projectId); saveToStorage(`${FILES_KEY_PREFIX}${file.projectId}`, [...files, file]); };
export const deleteFile = async (fileId: string, projectId: string): Promise<void> => { let files = await getFilesByProject(projectId); files = files.filter(f => f.id !== fileId); saveToStorage(`${FILES_KEY_PREFIX}${projectId}`, files); };
export const updateFile = async (projectId: string, updatedFile: ProjectFile): Promise<void> => {
    const files = await getFilesByProject(projectId);
    const newFiles = files.map(f => f.id === updatedFile.id ? updatedFile : f);
    saveToStorage(`${FILES_KEY_PREFIX}${projectId}`, newFiles);
};

// =========================================================================================
// File Reader Utilities
// =========================================================================================
export const readFileAsText = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsText(file); });
export const readFileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });