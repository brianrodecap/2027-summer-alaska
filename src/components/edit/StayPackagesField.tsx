import DeleteIcon from '@mui/icons-material/Delete';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { blankPackage } from '../../model/editForms';
import type { Package } from '../../model/types';
import { moneyFromAmountInput } from './bookingFormValue';

// A minimal editor for a Stay's extra-cost line items (a resort fee, a
// parking fee, ...) — only name and cost are ever touched here, so an
// existing hand-authored Package with its own benefits/travelers/
// confirmationNumber (e.g. a meal package) survives untouched unless its
// name or cost is actually edited. There's no fuller Package editor
// (status, benefits, confirmationNumber, travelers) anywhere in the app yet
// — this exists only to make an AI-extracted extra fee visible and
// correctable before Save, not to replace hand-editing a richer package in
// the JSON.
export function StayPackagesField({
  packages,
  onChange,
}: {
  packages: Package[];
  onChange: (packages: Package[]) => void;
}) {
  const updateAt = (index: number, patch: Partial<Package>) =>
    onChange(packages.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const removeAt = (index: number) => onChange(packages.filter((_, i) => i !== index));

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">Additional fees</Typography>
      {packages.map((pkg, index) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} key={pkg._id}>
          <TextField
            label="Name"
            placeholder="e.g. Resort fee"
            value={pkg.name}
            onChange={(e) => updateAt(index, { name: e.target.value })}
            fullWidth
          />
          <TextField
            label="Cost"
            type="number"
            value={pkg.cost?.amount ?? ''}
            onChange={(e) =>
              updateAt(index, { cost: moneyFromAmountInput(e.target.value, pkg.cost?.currency) })
            }
            sx={{ width: 120 }}
          />
          <IconButton aria-label="Remove fee" onClick={() => removeAt(index)}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      <Button
        size="small"
        onClick={() => onChange([...packages, blankPackage()])}
        sx={{ alignSelf: 'flex-start' }}
      >
        Add a fee
      </Button>
    </Stack>
  );
}
