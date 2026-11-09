import Chip from '@mui/material/Chip';
import { useTheme } from '@mui/material/styles';

// One option of a choose-one row: filled when it is the choice, outlined when not. A
// `color` fills the chosen one in that color instead of the primary one.
export function ChoiceChip({
  label,
  selected,
  color,
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  color?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { palette } = useTheme();
  return (
    <Chip
      label={label}
      color={selected ? 'primary' : 'default'}
      variant={selected ? 'filled' : 'outlined'}
      disabled={disabled}
      onClick={onClick}
      sx={
        selected && color
          ? {
              bgcolor: color,
              color: palette.getContrastText(color),
              '&:hover': { bgcolor: color },
            }
          : undefined
      }
    />
  );
}
