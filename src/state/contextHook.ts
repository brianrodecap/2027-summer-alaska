import { useContext } from 'react';

export function useRequiredContext<T>(context: React.Context<T | null>, message: string): T {
  const ctx = useContext(context);
  if (!ctx) throw new Error(message);
  return ctx;
}
