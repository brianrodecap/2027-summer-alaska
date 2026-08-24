import { useContext } from 'react';

import { EditContext, type EditContextValue } from './EditContextObject';

export function useEdit(): EditContextValue {
  const ctx = useContext(EditContext);
  if (!ctx) throw new Error('useEdit must be used within an EditProvider');
  return ctx;
}
