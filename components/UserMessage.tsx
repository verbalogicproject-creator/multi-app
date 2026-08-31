import React from 'react';
import { Message } from '../types/index';

interface UserMessageProps {
  message: Message;
}

const UserMessage: React.FC<UserMessageProps> = ({ message }) => {
    return (
        <div className="p-4 rounded-2xl max-w-lg lg:max-w-2xl xl:max-w-4xl break-words bg-indigo-600 rounded-br-none">
          {message.parts.map((part, index) => (
            <div key={index}>
              {part.text && <div className="whitespace-pre-wrap">{part.text}</div>}
            </div>
          ))}
        </div>
    );
};

export default UserMessage;