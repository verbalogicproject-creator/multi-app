export enum MessageAuthor {
    USER = 'user',
    ASSISTANT = 'assistant',
    SYSTEM = 'system',
    TOOL = 'tool'
}

export type ChatMode = 'chat' | 'coding' | 'image-edit' | 'video-gen' | 'live';

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
    // For regenerating video with the same seed/params
    regenerationData?: any;
}