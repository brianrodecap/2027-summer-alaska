import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

// The M3 side-sheet spec's modal variant, built from a real MUI Drawer
// (anchor="right", the default temporary variant) instead of a hand-rolled
// scrim/panel — Drawer already provides the scrim, Escape-to-dismiss, and
// backdrop-click dismissal this spec calls for, with no bespoke CSS needed.
export function DetailSideSheet({
  open,
  onClose,
  title,
  titleIcon,
  onEdit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  titleIcon?: ReactNode;
  onEdit?: () => void;
  children: ReactNode;
}) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: 'min(25rem, 100vw)',
            borderTopLeftRadius: 16,
            borderBottomLeftRadius: 16,
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 3 }}>
        {titleIcon}
        <Typography variant="h6" sx={{ flexGrow: 1, minWidth: 0 }}>
          {title}
        </Typography>
        {onEdit && (
          <IconButton onClick={onEdit} aria-label="Edit">
            <EditIcon />
          </IconButton>
        )}
        <IconButton onClick={onClose} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />
      <Box sx={{ p: 3, overflowY: 'auto', flexGrow: 1 }}>{children}</Box>
    </Drawer>
  );
}
