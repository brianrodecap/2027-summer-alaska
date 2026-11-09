import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';

import { DEFAULT_ROUTE_TONE } from '../../model/tripModel';
import type { RouteVariant } from '../../model/types';
import { materialIcon } from '../shared/materialIcon';
import { ChoiceChip } from './ChoiceChip';
import { CommitField } from './CommitField';

const DeleteIcon = materialIcon('delete');

// The variant being edited, on one line: its name, whether it is the direct one or a
// scenic one, and removing it. A route has exactly one direct variant, so Direct is
// offered only to the variant that has it or when none does; the route's own checks
// still decide what saves.
export function VariantEditor({
  variant,
  color,
  directElsewhere,
  onlyVariant,
  disabled,
  onChange,
  onRemove,
}: {
  variant: RouteVariant;
  // The variant's map color, which fills the chosen kind.
  color: string;
  directElsewhere: boolean;
  onlyVariant: boolean;
  disabled: boolean;
  onChange: (patch: Partial<RouteVariant>) => boolean | void;
  onRemove: () => void;
}) {
  const direct = variant.tone === DEFAULT_ROUTE_TONE;
  return (
    <Stack spacing={1}>
      <CommitField
        key={variant.label}
        label="Variant name"
        size="small"
        fullWidth
        disabled={disabled}
        value={variant.label}
        onCommit={(label) => onChange({ label })}
      />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <ChoiceChip
          label="Direct"
          selected={direct}
          color={color}
          disabled={disabled || (directElsewhere && !direct)}
          onClick={() => onChange({ tone: DEFAULT_ROUTE_TONE })}
        />
        <ChoiceChip
          label="Scenic"
          selected={!direct}
          color={color}
          disabled={disabled}
          onClick={() => onChange({ tone: 'scenic' })}
        />
        <Tooltip title="Remove variant">
          <span style={{ marginLeft: 'auto' }}>
            <IconButton
              aria-label="Remove variant"
              disabled={disabled || onlyVariant}
              onClick={onRemove}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Stack>
  );
}
