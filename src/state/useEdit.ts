import { useRequiredContext } from './contextHook';
import { EditContext, type EditContextValue } from './EditContextObject';

export function useEdit(): EditContextValue {
  return useRequiredContext(EditContext, 'useEdit must be used within an EditProvider');
}
