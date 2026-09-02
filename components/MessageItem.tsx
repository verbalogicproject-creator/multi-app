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

/**
 * Who is speaking used to be carried by hue — indigo for you, teal for the
 * assistant. Under the locked rule colour has two jobs, attention and chrome,
 * and identity is neither; a third job would have quietly emptied "any orange
 * means something needs you" of its meaning by teaching the eye that colour
 * here is just decoration.
 *
 * So the two turns are told apart by shape instead, which the markup already
 * had and was not using: you get a single raised bubble on the right, the
 * assistant gets a small metal glyph and flat text on the ground. Two
 * different silhouettes rather than two different colours — which survives
 * greyscale, daylight, and colour-blindness, none of which indigo-vs-teal did.
 */
const AssistantGlyph: React.FC = () => (
  <div
    aria-hidden
    className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center
               bg-metal-700 text-metal-200 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
  >
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5l1.6 4.4 4.4 1.6-4.4 1.6L12 16.5l-1.6-4.4L6 10.5l4.4-1.6L12 4.5z" />
    </svg>
  </div>
);

const MessageItem: React.FC<MessageItemProps> = (props) => {
  const { message } = props;

  if (message.author === MessageAuthor.SYSTEM) {
    return (
      <div className="text-center my-4 text-xs text-metal-300">
        {message.parts.map((part, index) => part.text && <span key={index}>{part.text}</span>)}
      </div>
    );
  }

  const isUser = message.author === MessageAuthor.USER;

  return (
    <div className={`flex items-start gap-3 my-4 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* No avatar on your own turn — the bubble on the right is the marker,
          and a second one would only take width the phone does not have. */}
      {!isUser && <AssistantGlyph />}
      <div className={`flex flex-col min-w-0 w-full ${isUser ? 'items-end' : 'items-start'}`}>
        {message.author === MessageAuthor.USER && <UserMessage message={message} />}
        {message.author === MessageAuthor.ASSISTANT && <AssistantMessage {...props} />}
        {message.author === MessageAuthor.TOOL && <ToolMessage {...props} />}
      </div>
    </div>
  );
};

export default React.memo(MessageItem);
