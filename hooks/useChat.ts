import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, MessageAuthor, MessagePart, Project, ProjectFile, Persona, CustomAiStyle, ToolCall, ChatMode } from '../types/index';
import { generateUniqueId } from '../utils/common';
import * as apiService from '../services/apiService';
import * as pyodideService from '../services/pyodideService';
import { applyPatch } from '../utils/patchFile';
import { splitAtApprovalGate } from '../utils/toolSequence';
import { fileTreeFrom, diagnosticsSummaryFrom, previewSummaryFrom, typeErrorCodesFrom, diagnosticCodeDelta } from '../utils/codingContext';
import { runTypecheck } from '../services/typecheckService';
import { previewVerdict } from '../services/previewVerdict';
import * as memoryService from '../services/memoryService';

/**
 * A `runPython` call pauses the sequence it arrived in, wherever it sits — not
 * only when it is the first call. `remainingCalls` is what lets
 * `resolvePendingTool` continue the same sequence afterward instead of ending
 * the turn early or losing the calls that were queued behind it. See A3
 * item 3: this is a strict generalisation of the single-call case, not a new
 * path — a sequence of exactly one call behaves exactly as it always has.
 */
interface PendingToolApproval {
    toolCall: ToolCall;
    remainingCalls: ToolCall[];
    history: Message[];
    mode: ChatMode;
}

/**
 * Attaches a fresh file tree, `tsc` diagnostics summary and preview verdict to
 * the target project (the first of `projects`, matching `handleToolCall`'s own
 * convention) for a coding-mode turn. Computed fresh rather than reused from
 * the IDE's own live state (`hooks/useDiagnostics.ts`, `PreviewHost.tsx`) — see
 * A3 item 2 in the plan for why. A project with no files yet, or no target
 * project at all, passes through unchanged; every project after the first is
 * untouched, since file tools only ever act on `projects[0]` either way.
 */
const withLiveContext = async (
    projects: Project[],
    filesByProject: Map<string, ProjectFile[]>,
    setStatusText: (text: string) => void,
    /* Fires with the raw (unsummarized) typecheck result right after it's
       computed — the hook's `recordDiagnosticsDelta` closure below is what
       actually compares it against the last read and writes to memory.
       Optional so this function's own contract (enrich `projects[0]`) stays
       unchanged for any caller that doesn't care. */
    onTypecheck?: (projectId: string, result: Awaited<ReturnType<typeof runTypecheck>>) => void,
): Promise<Project[]> => {
    const target = projects[0];
    if (!target) return projects;
    const files = filesByProject.get(target.id) ?? [];
    if (files.length === 0) return projects;

    setStatusText('Checking the project…');
    const record: Record<string, string> = {};
    for (const file of files) record[file.path] = file.content;

    const [typecheck, behaviour] = await Promise.all([
        runTypecheck(target.id, record, 0),
        previewVerdict(target.id, record),
    ]);
    onTypecheck?.(target.id, typecheck);

    const withContext: Project = {
        ...target,
        fileTree: fileTreeFrom(files),
        diagnosticsSummary: diagnosticsSummaryFrom(typecheck),
        previewSummary: previewSummaryFrom(behaviour),
    };
    return [withContext, ...projects.slice(1)];
};

const loadPersistedMessages = (storageKey: string): Message[] => {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return [];
        const parsed: Message[] = JSON.parse(raw);
        // Approval state does not survive a reload; expire any still-pending tool cards.
        return parsed.map(m => m.toolResponse?.response?.content?.pending
            ? { ...m, toolResponse: { ...m.toolResponse!, response: { ...m.toolResponse!.response, content: { error: 'This approval expired when the page was reloaded.' } } } }
            : m);
    } catch (e) {
        console.error('Failed to load chat history', e);
        return [];
    }
};

export const useChat = (
    projects: Project[], 
    persona: Persona,
    useWebSearch: boolean,
    customStyles: CustomAiStyle[],
    lowLatencyMode: boolean,
    aiFileOperations: {
        listFiles: (projectId: string) => Promise<string[]>;
        createFile: (projectId: string, path: string, content: string) => Promise<any>;
        readFile: (projectId: string, path: string) => Promise<string | null>;
        updateFile: (projectId: string, path: string, newContent: string) => Promise<any>;
        deleteFile: (projectId: string, path: string) => Promise<boolean>;
    },
    /* For the coding-mode context in `sendMessage` (A3 item 2) — a full file
       map, not just names, so a fresh `tsc`/preview run has real content to
       check without N round trips through `aiFileOperations.readFile`.
       Optional: general chat never passes this and never needs it. */
    filesByProject: Map<string, ProjectFile[]> = new Map(),
    historyStorageKey: string = 'gemini_messages_general',
    model?: string
) => {
    const [messages, setMessages] = useState<Message[]>(() => loadPersistedMessages(historyStorageKey));
    const [isLoading, setIsLoading] = useState(false);
    const [statusText, setStatusText] = useState('');
    const pendingApprovals = useRef(new Map<string, PendingToolApproval>());
    /* Per-project state for the write side of the memory ladder (see the plan:
       "closing the loop"). Keyed on `memoryService.memoryKeyFor(projectId)`,
       not the raw id — same sanitizing every memory call needs. Lives in refs,
       not state: neither should ever trigger a re-render, and both need to
       survive across renders the same way `pendingApprovals` already does. */
    const lastDiagnosticCodes = useRef(new Map<string, Set<string> | null>());
    const chatEpisodeId = useRef(new Map<string, string>());

    /**
     * The write half of "the ladder improves with use." Compares this read's
     * diagnostic codes against the last one seen for this project and, on a
     * real change, records it through the exact same memory event path the
     * app-builder wizard already uses — `memory/routes.js`'s `POST /events`,
     * unmodified, dispatching to `proposalsFor`/`patternsFor`.
     *
     * A resolved code and an introduced code are reported as two separate
     * events in one call, not folded into one — a turn can fix one thing and
     * break another, and `ok` is exactly one of true or false per event.
     *
     * The first read of a project each session has no "before" to compare —
     * stored, not treated as a regression from nothing. Memory being
     * unavailable (no episode obtainable) is silently skipped, matching this
     * app's "nothing on the builder's critical path waits on memory" rule —
     * a coding turn must never be slowed or broken by this.
     */
    const recordDiagnosticsDelta = useCallback((projectId: string, typecheck: Awaited<ReturnType<typeof runTypecheck>>) => {
        const key = memoryService.memoryKeyFor(projectId);
        if (!key) return;
        const codes = typeErrorCodesFrom(typecheck);
        const previous = lastDiagnosticCodes.current.get(key) ?? null;
        lastDiagnosticCodes.current.set(key, codes);
        if (codes === null || previous === null) return; // nothing to compare yet

        const { resolved, introduced } = diagnosticCodeDelta(previous, codes);
        if (resolved.length === 0 && introduced.length === 0) return; // most turns

        void (async () => {
            let episodeId = chatEpisodeId.current.get(key) ?? null;
            if (!episodeId) {
                episodeId = await memoryService.openEpisode(key, 'IDE peer-programming session', null);
                if (!episodeId) return; // memory unavailable — never blocks the chat itself
                chatEpisodeId.current.set(key, episodeId);
            }

            const events: memoryService.MemoryEvent[] = [];
            const evidence: memoryService.MemoryEvidence[] = [];
            if (resolved.length > 0) {
                evidence.push({ key: 'fix', kind: 'verification.result', ref: 'chat://diagnostics', summary: `Resolved: ${resolved.join(', ')}` });
                events.push({ kind: 'verification.completed', payload: { ok: true, codes: Object.fromEntries(resolved.map((c) => [c, true])) }, evidenceKeys: ['fix'] });
            }
            if (introduced.length > 0) {
                evidence.push({ key: 'regression', kind: 'verification.result', ref: 'chat://diagnostics', summary: `Introduced: ${introduced.join(', ')}` });
                events.push({ kind: 'verification.completed', payload: { ok: false, codes: Object.fromEntries(introduced.map((c) => [c, true])) }, evidenceKeys: ['regression'] });
            }
            memoryService.record(key, episodeId, events, evidence);
        })();
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(historyStorageKey, JSON.stringify(messages));
        } catch (e) {
            console.error('Failed to persist chat history', e);
        }
    }, [messages, historyStorageKey]);

    const addMessage = useCallback((author: MessageAuthor, parts: MessagePart[], toolCall?: ToolCall, toolResponse?: any) => {
        const newMessage: Message = { id: generateUniqueId(), author, parts, toolCall, toolResponse };
        setMessages(prev => [...prev, newMessage]);
        return newMessage;
    }, []);

    const handleToolCall = useCallback(async (toolCall: ToolCall, relatedProjects: Project[]): Promise<any> => {
        const { name, args } = toolCall;
        let result: any;
        const targetProjectId = relatedProjects[0]?.id;

        try {
            switch (name) {
                case 'runPython':
                    result = await pyodideService.runPythonScript(args.code);
                    result.originalCode = args.code;
                    break;
                case 'searchNpm':
                    result = await apiService.npmSearch(args.packageName);
                    break;
                case 'listFiles':
                    if (!targetProjectId) throw new Error("No project selected for listFiles.");
                    const fileList = await aiFileOperations.listFiles(targetProjectId);
                    result = { files: fileList };
                    break;
                 case 'createFile':
                    if (!targetProjectId) throw new Error("No project selected for createFile.");
                    await aiFileOperations.createFile(targetProjectId, args.path, args.content);
                    result = { success: true, message: `File ${args.path} created.` };
                    break;
                case 'readFile':
                     if (!targetProjectId) throw new Error("No project selected for readFile.");
                     const content = await aiFileOperations.readFile(targetProjectId, args.path);
                     result = { content: content ?? `File not found: ${args.path}` };
                     break;
                case 'patchFile': {
                    if (!targetProjectId) throw new Error("No project selected for patchFile.");
                    const current = await aiFileOperations.readFile(targetProjectId, args.path);
                    if (current === null) { result = { error: `File not found: ${args.path}` }; break; }
                    const patched = applyPatch(current, args.find, args.replace);
                    if (!patched.ok) { result = { error: patched.error }; break; }
                    await aiFileOperations.updateFile(targetProjectId, args.path, patched.content);
                    result = { success: true, message: `File ${args.path} patched.` };
                    break;
                }
                case 'updateFile':
                    if (!targetProjectId) throw new Error("No project selected for updateFile.");
                    await aiFileOperations.updateFile(targetProjectId, args.path, args.newContent);
                    result = { success: true, message: `File ${args.path} updated.` };
                    break;
                case 'deleteFile':
                    if (!targetProjectId) throw new Error("No project selected for deleteFile.");
                    const success = await aiFileOperations.deleteFile(targetProjectId, args.path);
                    result = { success, message: success ? `File ${args.path} deleted.` : `File ${args.path} not found.`};
                    break;
                default:
                    result = { error: `Unknown tool: ${name}` };
            }
        } catch (error: any) {
            result = { error: error.message };
        }
        
        return result;
    }, [aiFileOperations]);

    /**
     * Executes queued tool calls in order, stopping to ask approval for a
     * `runPython` call wherever it occurs — not only when it is first — and
     * resuming the remainder afterward. See A3 item 3 in the plan.
     *
     * References `processStream`, declared just below: both are only ever
     * *called* well after this render has finished (in response to a stream
     * event or an approval click), by which point both `const`s already hold
     * their functions — the same closure relationship `processStream`'s own
     * self-recursion below already relies on.
     */
    const runToolSequence = useCallback(async (calls: ToolCall[], history: Message[], mode: ChatMode) => {
        let workingHistory = history;
        const activeProjectsForTooling = mode === 'coding' ? projects : [];

        const { before, paused, remaining } = splitAtApprovalGate(calls, 'runPython');

        for (const toolCall of before) {
            const toolResponseResult = await handleToolCall(toolCall, activeProjectsForTooling);
            const toolMessage = addMessage(MessageAuthor.TOOL, [], undefined, { name: toolCall.name, response: { content: toolResponseResult } });
            workingHistory = [...workingHistory, toolMessage];
        }

        if (paused) {
            // Model-generated code never auto-executes: park it as a pending
            // approval card and wait for the user to click Run or Skip.
            // Whatever has not run yet travels with it, so declining or
            // approving resumes the same sequence rather than ending the
            // turn with calls the model made but nothing ever answered.
            const pendingMessage = addMessage(MessageAuthor.TOOL, [], undefined,
                { name: 'runPython', response: { content: { pending: true }, originalCode: paused.args.code } });
            pendingApprovals.current.set(pendingMessage.id, {
                toolCall: paused,
                remainingCalls: remaining,
                history: workingHistory,
                mode,
            });
            return;
        }

        const followUpStream = await apiService.generateCodingContentStream(workingHistory, activeProjectsForTooling, persona, useWebSearch, customStyles, lowLatencyMode, model, mode);
        await processStream(followUpStream, workingHistory, mode);
    }, [addMessage, projects, persona, useWebSearch, customStyles, lowLatencyMode, model, handleToolCall]);

    const processStream = useCallback(async (stream: ReadableStream<Uint8Array>, existingMessages: Message[], currentMode: ChatMode) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        
        let currentResponse: Message | null = null;
        let accumulatedText = '';
        let accumulatedThinking = '';
        let accumulatedFunctionCalls: ToolCall[] = [];

        const handleChunkLine = (jsonChunk: string) => {
            try {
                const chunk = JSON.parse(jsonChunk);
                if (!currentResponse) {
                    currentResponse = { id: generateUniqueId(), author: MessageAuthor.ASSISTANT, parts: [{ text: ''}] };
                    setMessages(prev => [...prev, currentResponse!]);
                }

                if (chunk.text) {
                    accumulatedText += chunk.text;
                    currentResponse.parts = [{ text: accumulatedText }];
                }

                if(chunk.functionCalls) {
                    accumulatedFunctionCalls.push(...chunk.functionCalls);
                }

                if (chunk.thinking) {
                    accumulatedThinking += chunk.thinking;
                    currentResponse.thinking = accumulatedThinking;
                }

                if (chunk.groundingMetadata) {
                    currentResponse.groundingMetadata = chunk.groundingMetadata;
                }

                setMessages(prev => prev.map(m => m.id === currentResponse?.id ? { ...currentResponse } : m));
            } catch (e) { console.error("Error parsing stream chunk", e, jsonChunk); }
        };

        // NDJSON records can be split across reader.read() boundaries; carry the
        // trailing partial line into the next read instead of dropping it.
        let carry = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const lines = (carry + decoder.decode(value, { stream: true })).split('\n');
            carry = lines.pop() ?? '';
            for (const line of lines) {
                if (line.trim()) handleChunkLine(line);
            }
        }
        const tail = carry + decoder.decode();
        if (tail.trim()) handleChunkLine(tail);

        const responseMessage = currentResponse as Message | null;
        if (accumulatedFunctionCalls.length > 0 && responseMessage) {
             /* The bubble shows the first call it made; every call still runs —
                see `runToolSequence`. A model that made one call renders and
                behaves exactly as it always has. */
             responseMessage.toolCall = accumulatedFunctionCalls[0];
             setMessages(prev => prev.map(m => m.id === responseMessage.id ? { ...responseMessage } : m));

             await runToolSequence(accumulatedFunctionCalls, [...existingMessages, responseMessage], currentMode);
        }
    }, [runToolSequence]);

    const resolvePendingTool = useCallback(async (messageId: string, approved: boolean) => {
        const pending = pendingApprovals.current.get(messageId);
        if (!pending) return;
        pendingApprovals.current.delete(messageId);

        setIsLoading(true);
        setStatusText(approved ? 'Running Python...' : 'Thinking...');
        try {
            let result: any;
            if (approved) {
                result = await pyodideService.runPythonScript(pending.toolCall.args.code);
                result.originalCode = pending.toolCall.args.code;
            } else {
                result = { error: 'The user declined to run this code. Do not retry; continue without it.' };
            }

            const toolMessage: Message = {
                id: messageId,
                author: MessageAuthor.TOOL,
                parts: [],
                toolResponse: { name: 'runPython', response: { content: result, originalCode: pending.toolCall.args.code } },
            };
            setMessages(prev => prev.map(m => m.id === messageId ? toolMessage : m));

            /* Resume the same sequence rather than jump straight to the next
               model turn — anything queued behind this `runPython` call still
               has not run. A sequence of exactly one call has an empty
               `remainingCalls`, so `runToolSequence` falls straight through to
               the model turn, matching what this line always did before A3. */
            const historyWithToolResponse = [...pending.history, toolMessage];
            await runToolSequence(pending.remainingCalls, historyWithToolResponse, pending.mode);
        } catch (error: any) {
            addMessage(MessageAuthor.SYSTEM, [{ text: `Error: ${error.message}` }]);
        } finally {
            setIsLoading(false);
            setStatusText('');
        }
    }, [addMessage, runToolSequence]);


    const sendMessage = async (prompt: string, mode: ChatMode, file?: File | null) => {
        if (isLoading) return;
        setIsLoading(true);
        setStatusText('Thinking...');

        const userParts: MessagePart[] = [{ text: prompt }];
        if (mode === 'image-edit' && file) {
            userParts.push({ imageUrl: URL.createObjectURL(file) });
        }
        const userMessage = addMessage(MessageAuthor.USER, userParts);

        try {
            if (mode === 'image-edit') {
                if (!file) throw new Error("An image file is required for editing.");
                const resultParts = await apiService.editImage(prompt, file);
                resultParts.forEach(p => { if (p.imageUrl && file) p.sourceImageUrl = URL.createObjectURL(file); });
                addMessage(MessageAuthor.ASSISTANT, resultParts);
            } else if (mode === 'video-gen') {
                const resultParts = await apiService.generateVideo(prompt, file ?? null, 0, '16:9', setStatusText);
                const newMessage = addMessage(MessageAuthor.ASSISTANT, resultParts);
                newMessage.regenerationData = { prompt, file };
            } else { // coding or chat mode
                const history = [...messages, userMessage];
                const activeProjects = mode === 'coding'
                    ? await withLiveContext(projects, filesByProject, setStatusText, recordDiagnosticsDelta)
                    : [];
                const stream = await apiService.generateCodingContentStream(history, activeProjects, persona, useWebSearch, customStyles, lowLatencyMode, model, mode);
                await processStream(stream, history, mode);
            }
        } catch (error: any) {
            addMessage(MessageAuthor.SYSTEM, [{ text: `Error: ${error.message}` }]);
        } finally {
            setIsLoading(false);
            setStatusText('');
        }
    };
    
    const regenerate = (messageId: string) => {
        const message = messages.find(m => m.id === messageId);
        if (message?.regenerationData) {
            sendMessage(message.regenerationData.prompt, 'video-gen', message.regenerationData.file);
        }
    }

    return { messages, isLoading, statusText, sendMessage, regenerate, resolvePendingTool };
};