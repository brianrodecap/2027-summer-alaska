import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';

import type { ThemePreference } from '../../config/themePreference';
import { useThemePreference } from '../../state/useThemePreference';

// Site-wide user preferences (per browser, not per trip). Currently just the
// color mode; new preferences get their own labeled section below it.
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
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
