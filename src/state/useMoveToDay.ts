import { useRequiredContext } from './contextHook';
import { MoveToDayContext, type MoveToDayContextValue } from './MoveToDayContextObject';

export function useMoveToDay(): MoveToDayContextValue {
  return useRequiredContext(
    MoveToDayContext,
    'useMoveToDay must be used within a MoveToDayProvider',
  );
}
