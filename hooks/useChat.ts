import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, MessageAuthor, MessagePart, Project, Persona, CustomAiStyle, ToolCall, ChatMode } from '../types/index';
import { generateUniqueId } from '../utils/common';
import * as apiService from '../services/apiService';
import * as pyodideService from '../services/pyodideService';

interface PendingToolApproval {
    toolCall: ToolCall;
    history: Message[];
    mode: ChatMode;
}

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
    historyStorageKey: string = 'gemini_messages_general',
    model?: string
) => {
    const [messages, setMessages] = useState<Message[]>(() => loadPersistedMessages(historyStorageKey));
    const [isLoading, setIsLoading] = useState(false);
    const [statusText, setStatusText] = useState('');
    const pendingApprovals = useRef(new Map<string, PendingToolApproval>());

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
             const toolCall = accumulatedFunctionCalls[0];
             responseMessage.toolCall = toolCall;
             setMessages(prev => prev.map(m => m.id === responseMessage.id ? { ...responseMessage } : m));

             if (toolCall.name === 'runPython') {
                 // Model-generated code never auto-executes: park it as a pending
                 // approval card and wait for the user to click Run or Skip.
                 const pendingMessage = addMessage(MessageAuthor.TOOL, [], undefined,
                     { name: 'runPython', response: { content: { pending: true }, originalCode: toolCall.args.code } });
                 pendingApprovals.current.set(pendingMessage.id, {
                     toolCall,
                     history: [...existingMessages, responseMessage],
                     mode: currentMode,
                 });
                 return;
             }

             const activeProjectsForTooling = currentMode === 'coding' ? projects : [];
             const toolResponseResult = await handleToolCall(toolCall, activeProjectsForTooling);
             const toolMessage = addMessage(MessageAuthor.TOOL, [], undefined, { name: toolCall.name, response: { content: toolResponseResult } });

             const historyWithToolResponse = [...existingMessages, responseMessage, toolMessage];
             const followUpStream = await apiService.generateCodingContentStream(historyWithToolResponse, activeProjectsForTooling, persona, useWebSearch, customStyles, lowLatencyMode, model);
             await processStream(followUpStream, historyWithToolResponse, currentMode);
        }
    }, [addMessage, projects, persona, useWebSearch, customStyles, lowLatencyMode, model, handleToolCall]);

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

            const historyWithToolResponse = [...pending.history, toolMessage];
            const activeProjectsForTooling = pending.mode === 'coding' ? projects : [];
            const followUpStream = await apiService.generateCodingContentStream(historyWithToolResponse, activeProjectsForTooling, persona, useWebSearch, customStyles, lowLatencyMode, model);
            await processStream(followUpStream, historyWithToolResponse, pending.mode);
        } catch (error: any) {
            addMessage(MessageAuthor.SYSTEM, [{ text: `Error: ${error.message}` }]);
        } finally {
            setIsLoading(false);
            setStatusText('');
        }
    }, [addMessage, projects, persona, useWebSearch, customStyles, lowLatencyMode, model, processStream]);


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
                const activeProjects = mode === 'coding' ? projects : [];
                const stream = await apiService.generateCodingContentStream(history, activeProjects, persona, useWebSearch, customStyles, lowLatencyMode, model);
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