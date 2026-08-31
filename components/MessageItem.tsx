import React from 'react';
import { Message, MessageAuthor, Project } from '../types/index';
import AssistantMessage from './AssistantMessage';
import UserMessage from './UserMessage';
import ToolMessage from './ToolMessage';

interface MessageItemProps {
  message: Message;
  onRegenerate?: (messageId: string) => void;
  onContinueScene?: (messageId: string) => void;
  onUseImage?: (imageUrl: string) => void;
  onSaveScript?: (projectId: string, filename: string, content: string) => void;
  selectedProjects?: Project[];
  onPlayAudio?: (messageId: string, text: string) => void;
  isPlaying?: boolean;
  onResolvePendingTool?: (messageId: string, approved: boolean) => void;
}

const AuthorIcon: React.FC<{ author: MessageAuthor }> = ({ author }) => {
  const baseClasses = "h-8 w-8 rounded-full flex items-center justify-center font-bold text-white shrink-0";
  if (author === MessageAuthor.USER) {
    return <div className={`${baseClasses} bg-indigo-500`}>U</div>;
  }
  return (
    <div className={`${baseClasses} bg-teal-500`}>
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm2.293 8.293-1.293 1.293.707.707 1.293-1.293-.707-.707zM12 10.5c-.276 0-.5-.224-.5-.5s.224-.5.5-.5.5.224.5.5-.224.5-.5.5zm-3.293.293.707-.707 1.293 1.293-.707.707-1.293-1.293zM12 14c-2.206 0-4-1.794-4-4s1.794-4 4-4 4 1.794 4-4-1.794 4-4 4z" />
      </svg>
    </div>
  );
};

const MessageItem: React.FC<MessageItemProps> = (props) => {
  const { message } = props;

  if (message.author === MessageAuthor.SYSTEM) {
    return (
      <div className="text-center my-4 text-xs text-gray-500 italic">
        {message.parts.map((part, index) => part.text && <span key={index}>{part.text}</span>)}
      </div>
    );
  }
  
  const isUser = message.author === MessageAuthor.USER;

  return (
    <div className={`flex items-start gap-4 my-4 ${isUser ? 'flex-row-reverse' : ''}`}>
      <AuthorIcon author={message.author} />
      <div className={`flex flex-col w-full ${isUser ? 'items-end' : 'items-start'}`}>
        {message.author === MessageAuthor.USER && <UserMessage message={message} />}
        {message.author === MessageAuthor.ASSISTANT && <AssistantMessage {...props} />}
        {message.author === MessageAuthor.TOOL && <ToolMessage {...props} />}
      </div>
    </div>
  );
};

export default React.memo(MessageItem);