import '@testing-library/jest-dom/vitest';

import { afterEach } from 'vitest';

// Stored values (API keys, saved edits, preferences) never leak between tests.
afterEach(() => localStorage.clear());
