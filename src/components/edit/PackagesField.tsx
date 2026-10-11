import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { moneyFromAmountInput } from '../../model/bookingFormValue';
import { blankPackage } from '../../model/editForms';
import type { Package } from '../../model/types';
import { materialIcon } from '../shared/materialIcon';
import { PayableField } from './PayableField';
import { rowList } from './rowList';

const DeleteIcon = materialIcon('delete');

// A minimal editor for the Packages on a Stay, Transit or Activity — an
// extra fee (a resort fee, parking), or what a booking includes or adds.
// Only name, cost and when it's paid are touched here, so an existing
// hand-authored Package with its own benefits/travelers/confirmationNumber
// (e.g. a meal package) survives untouched unless those are edited. There's
// no fuller Package editor (status, benefits, travelers) anywhere in the app
// yet — this exists to make an imported or proposed package visible and
// correctable before Save, not to replace hand-editing a richer one in the JSON.
// `nightly` (a Stay's form only) offers a nightly rate, which the budget
// multiplies by the stay's nights (Package.per).
export function PackagesField({
  packages,
  onChange,
  nightly = false,
}: {
  packages: Package[];
  onChange: (packages: Package[]) => void;
  nightly?: boolean;
}) {
  const { updateAt, removeAt, add } = rowList(packages, onChange);

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">Packages and fees</Typography>
      {packages.map((pkg, index) => (
        <Stack spacing={1} key={pkg._id}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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
              onChange={(e) => {
                const cost = moneyFromAmountInput(e.target.value, pkg.cost?.currency);
                // No cost, no rate: the "Charged" choice goes with the price.
                updateAt(index, cost ? { cost } : { cost, per: undefined });
              }}
              sx={{ width: 120 }}
            />
            <IconButton aria-label="Remove" onClick={() => removeAt(index)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
          {pkg.cost && (
            <Stack direction="row" spacing={2}>
              {nightly && (
                <TextField
                  select
                  size="small"
                  label="Charged"
                  value={pkg.per ?? 'once'}
                  onChange={(e) =>
                    updateAt(index, { per: e.target.value === 'night' ? 'night' : undefined })
                  }
                  sx={{ width: 140, flexShrink: 0 }}
                >
                  <MenuItem value="once">Once</MenuItem>
                  <MenuItem value="night">Per night</MenuItem>
                </TextField>
              )}
              <PayableField
                size="small"
                value={pkg.payable}
                onChange={(payable) => updateAt(index, { payable })}
              />
            </Stack>
          )}
        </Stack>
      ))}
      <Button size="small" onClick={() => add(blankPackage())} sx={{ alignSelf: 'flex-start' }}>
        Add a package or fee
      </Button>
    </Stack>
  );
}
