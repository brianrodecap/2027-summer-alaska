import './index.css';

import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ThemePreferenceProvider } from './state/ThemePreferenceProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemePreferenceProvider>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <App />
      </LocalizationProvider>
    </ThemePreferenceProvider>
  </StrictMode>,
);
