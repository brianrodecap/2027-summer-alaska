import { useCallback, useState } from 'react';

export type DaysDialog = 'datePicker' | 'routes' | 'scenarios' | 'askAI';

// Which of the day list's dialogs is open — one at a time, since each is modal.
export function useDaysDialogs() {
  const [active, setActive] = useState<DaysDialog | null>(null);
  const open = useCallback((name: DaysDialog) => setActive(name), []);
  const close = useCallback(() => setActive(null), []);
  return { isOpen: (name: DaysDialog) => active === name, open, close };
}

export type DaysDialogsState = ReturnType<typeof useDaysDialogs>;
