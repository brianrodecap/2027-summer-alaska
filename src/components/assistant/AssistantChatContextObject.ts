import { createContext } from 'react';

import type { AssistantChat } from './useAssistantChat';

export const AssistantChatContext = createContext<AssistantChat | null>(null);
