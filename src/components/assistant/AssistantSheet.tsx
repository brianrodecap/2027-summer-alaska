import Drawer from '@mui/material/Drawer';

import type { Day } from '../../model/types';
import { AssistantPanel } from './AssistantPanel';

// Narrow screens' home for the trip assistant: a bottom sheet over the day list, tall
// enough to chat in but leaving the top of the day in view. Closing it only hides the
// panel — the conversation, and any turn still running, live in AssistantChatProvider.
export function AssistantSheet({
  open,
  onClose,
  focusDay,
}: {
  open: boolean;
  onClose: () => void;
  focusDay: Day | null;
}) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            height: '85vh',
            borderTopLeftRadius: (theme) => theme.shape.borderRadius,
            borderTopRightRadius: (theme) => theme.shape.borderRadius,
          },
        },
      }}
    >
      <AssistantPanel focusDay={focusDay} onClose={onClose} />
    </Drawer>
  );
}
