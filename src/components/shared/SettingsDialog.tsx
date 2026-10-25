import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import {
  API_KEY_NAMES,
  apiKeyHelp,
  apiKeyLabel,
  keyNeedsReload,
  keysChanged,
  listKeys,
  saveApiKeys,
  savedApiKeys,
} from '../../config/apiKeys';
import type { ThemePreference } from '../../config/themePreference';
import { useThemePreference } from '../../state/useThemePreference';

// Site-wide user preferences (per browser, not per trip): the color mode and the
// API keys. New preferences get their own labeled section.
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { preference, setPreference } = useThemePreference();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Settings</DialogTitle>
      <DialogContent>
        <Stack spacing={1}>
          <Typography variant="subtitle2" component="h3">
            Appearance
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            color="primary"
            sx={{ '& .MuiToggleButton-root': { gap: 1 } }}
            value={preference}
            aria-label="Color mode"
            // MUI reports null when the already-selected button is clicked again;
            // ignore it so one option always stays selected.
            onChange={(_, next: ThemePreference | null) => {
              if (next) setPreference(next);
            }}
          >
            <ToggleButton value="light">
              <LightModeIcon fontSize="small" />
              Light
            </ToggleButton>
            <ToggleButton value="dark">
              <DarkModeIcon fontSize="small" />
              Dark
            </ToggleButton>
            <ToggleButton value="system">
              <BrightnessAutoIcon fontSize="small" />
              System
            </ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary">
            System follows your device&apos;s light/dark setting. Saved in this browser only.
          </Typography>
        </Stack>
        <Divider sx={{ my: 2 }} />
        <ApiKeysSection />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// One API key: masked, never autofilled.
function ApiKeyField({
  label,
  helperText,
  value,
  onChange,
}: {
  label: string;
  helperText: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      label={label}
      type="password"
      autoComplete="off"
      fullWidth
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      helperText={helperText}
    />
  );
}

const reloadKeys = API_KEY_NAMES.filter(keyNeedsReload);

function ApiKeysSection() {
  const [saved, setSaved] = useState(savedApiKeys);
  const [entered, setEntered] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const changed = keysChanged(entered, saved);

  const handleSave = () => {
    const result = saveApiKeys(entered, saved);
    if (result.reload) {
      window.location.reload();
      return;
    }
    setSaved(result.saved);
    setError(result.error);
  };

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2" component="h3">
        API keys
      </Typography>
      {API_KEY_NAMES.map((name) => (
        <ApiKeyField
          key={name}
          label={`${apiKeyLabel(name)} API key`}
          helperText={apiKeyHelp(name)}
          value={entered[name]}
          onChange={(value) => setEntered((keys) => ({ ...keys, [name]: value }))}
        />
      ))}
      {error && <Alert severity="warning">{error}</Alert>}
      <Typography variant="caption" color="text.secondary">
        Kept only in this browser, never committed.
        {reloadKeys.length > 0 &&
          ` Saving a new ${listKeys(reloadKeys, 'disjunction')} key reloads the page.`}
      </Typography>
      <Button
        variant="contained"
        disabled={!changed}
        onClick={handleSave}
        sx={{ alignSelf: 'flex-start' }}
      >
        Save keys
      </Button>
    </Stack>
  );
}
