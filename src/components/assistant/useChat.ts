import { useRequiredContext } from '../../state/contextHook';
import { AssistantChatContext } from './AssistantChatContextObject';
import type { AssistantChat } from './useAssistantChat';

export function useChat(): AssistantChat {
  return useRequiredContext(
    AssistantChatContext,
    'useChat must be used within an AssistantChatProvider',
  );
}
