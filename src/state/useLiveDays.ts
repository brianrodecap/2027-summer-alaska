import { useRequiredContext } from './contextHook';
import { LiveDaysContext, type LiveDaysValue } from './LiveDaysContextObject';

export function useLiveDays(): LiveDaysValue {
  return useRequiredContext(LiveDaysContext, 'useLiveDays must be used within a LiveDaysProvider');
}
