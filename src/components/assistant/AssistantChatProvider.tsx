import type { ReactNode } from 'react';

import { AssistantChatContext } from './AssistantChatContextObject';
import { useAssistantChat } from './useAssistantChat';

// Hosts the trip assistant's chat state for everything under it. A streaming reply
// updates this state on every token, and as a provider, only the components that read
// it (the assistant panel) re-render — `children` were built by the parent, which
// doesn't, so React reuses them as-is.
export function AssistantChatProvider({ children }: { children: ReactNode }) {
  const chat = useAssistantChat();
  return <AssistantChatContext.Provider value={chat}>{children}</AssistantChatContext.Provider>;
}
