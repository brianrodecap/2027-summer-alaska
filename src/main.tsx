import './index.css';

import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { APIProvider } from '@vis.gl/react-google-maps';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { PLACES_API_KEY } from './config/places';
import { ThemePreferenceProvider } from './state/ThemePreferenceProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemePreferenceProvider>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        {/* Mounted once at the app root — DayMapSidebar's Maps JS API
            script loads here, not per-page. */}
        <APIProvider apiKey={PLACES_API_KEY}>
          <App />
        </APIProvider>
      </LocalizationProvider>
    </ThemePreferenceProvider>
  </StrictMode>,
);
