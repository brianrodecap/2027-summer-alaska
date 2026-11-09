import Chip from '@mui/material/Chip';

// One option of a choose-one row: filled when it is the choice, outlined when not.
export function ChoiceChip({
  label,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Chip
      label={label}
      color={selected ? 'primary' : 'default'}
      variant={selected ? 'filled' : 'outlined'}
      disabled={disabled}
      onClick={onClick}
    />
  );
}
