export enum MessageAuthor {
    USER = 'user',
    ASSISTANT = 'assistant',
    SYSTEM = 'system',
    TOOL = 'tool'
}

/**
 * `plan` shapes an idea and hands it to the builder; `coding` is the project-aware
 * mode the IDE uses and is set for you rather than chosen. The mode now reaches the
 * server, so it changes what the assistant is *for*, not only what it is given.
 */
export type ChatMode = 'chat' | 'plan' | 'coding' | 'image-edit' | 'video-gen' | 'live';

export interface MessagePart {
    text?: string;
    imageUrl?: string;
    videoUrl?: string;
    sourceImageUrl?: string; // For image editing, to show what it was based on
}

export interface ToolCall {
    name: string;
    args: any;
}

export interface ToolResponse {
    name: string;
    response: {
        content: any;
        originalCode?: string;
    }
}

export interface GroundingMetadata {
    web: {
        uri: string;
        title: string;
    }
}

export interface Message {
    id: string;
    author: MessageAuthor;
    parts: MessagePart[];
    toolCall?: ToolCall;
    toolResponse?: ToolResponse;
    groundingMetadata?: GroundingMetadata[];
    /** Reasoning summary streamed by providers that expose one. */
    thinking?: string;
    // For regenerating video with the same seed/params
    regenerationData?: any;
}