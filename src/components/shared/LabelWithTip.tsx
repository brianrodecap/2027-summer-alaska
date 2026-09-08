import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';

// The info-icon half on its own, for callers that already render their own
// label element (ChoiceCards' Typography) and only need the tip beside it.
//
// enterTouchDelay={0} is deliberate and belongs to every copy: without it the
// tooltip needs a long-press to open on touch, which on a phone reads as the
// icon simply not working. Keeping it here is the point of this component —
// this affordance previously existed as four hand-rolled copies and one of
// them had already lost the touch delay.
export function InfoTip({ tip, color = 'text.secondary' }: { tip: string; color?: string }) {
  return (
    <Tooltip title={tip} enterTouchDelay={0}>
      <InfoOutlinedIcon
        fontSize="inherit"
        // Keeps a tap on the tip from also firing whatever clickable thing the
        // icon sits inside — a StepLabel that jumps steps, a selectable card.
        onClick={(e) => e.stopPropagation()}
        sx={{ color, cursor: 'help', flexShrink: 0 }}
      />
    </Tooltip>
  );
}

// A short label with an info-icon tooltip carrying the explanation — the
// house pattern for "keep the control itself glance-able, put the why behind
// the icon" used by the wizard's step labels, its form-field labels, and the
// Place-conditions checkboxes.
export function LabelWithTip({ text, tip, color }: { text: string; tip?: string; color?: string }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <span>{text}</span>
      {tip && <InfoTip tip={tip} color={color} />}
    </Stack>
  );
}
