import SettingsIcon from '@mui/icons-material/Settings';
import IconButton from '@mui/material/IconButton';
import { useState } from 'react';

import { SettingsDialog } from './SettingsDialog';

// Gear icon + the dialog it opens, self-contained so a header can drop it in
// without lifting dialog state into its own page.
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton aria-label="Settings" onClick={() => setOpen(true)}>
        <SettingsIcon />
      </IconButton>
      <SettingsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
