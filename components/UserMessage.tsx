import React from 'react';
import { Message } from '../types/index';

interface UserMessageProps {
  message: Message;
}

/**
 * The one raised block in a thread. Everything the assistant says lies flat on
 * the ground, so the bubble alone says "this was you" — no hue required.
 */
const UserMessage: React.FC<UserMessageProps> = ({ message }) => {
    return (
        <div className="px-4 py-3 rounded-2xl rounded-br-sm max-w-[85%] md:max-w-2xl break-words
                        bg-raised text-metal-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
          {message.parts.map((part, index) => (
            <div key={index}>
              {part.text && <div className="whitespace-pre-wrap">{part.text}</div>}
            </div>
          ))}
        </div>
    );
};

export default UserMessage;
