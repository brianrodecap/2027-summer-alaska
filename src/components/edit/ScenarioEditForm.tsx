import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';

import type { ScenarioDateInfo } from '../../model/tripModel';
import { formatDateLabel, groupScenariosByDate } from '../../model/tripModel';
import type { Leg, Scenario } from '../../model/types';
import { ICON_NAMES, renderMaterialIcon } from '../shared/materialIcon';

const TONE_OPTIONS: { value: Scenario['tone']; label: string }[] = [
  { value: 'ideal', label: 'Ideal' },
  { value: 'alternate', label: 'Alternate' },
];

export function ScenarioEditForm({
  form,
  onChange,
  legs,
  otherScenarios,
  dateInfoById,
}: {
  form: Scenario;
  onChange: (scenario: Scenario) => void;
  legs: Leg[];
  // Every other scenario in the trip, for the followsScenarioDate,
  // requiresScenarioId, and parentScenarioId pickers below — never includes
  // this scenario itself, so it can't require or parent itself.
  otherScenarios: Scenario[];
  dateInfoById: Map<string, ScenarioDateInfo>;
}) {
  const requiresValue = form.requiresScenarioId ?? [];
  // The "Requires one of"/"Parent scenario" pickers below face the same
  // duplication ScenariosDialog's own list does — the whole trip's scenarios
  // in one flat list, many sharing a label with nothing but the (invisible,
  // in a plain option list) date to tell them apart — so candidates are
  // grouped under the same resolved-date headers that list uses.
  const groupedOtherScenarios = groupScenariosByDate(otherScenarios, dateInfoById);

  return (
    <Stack spacing={2}>
      <TextField
        select
        label="Leg"
        size="small"
        value={form.legId}
        onChange={(e) => onChange({ ...form, legId: e.target.value })}
      >
        {legs.map((leg) => (
          <MenuItem key={leg._id} value={leg._id}>
            {leg.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Label"
        size="small"
        value={form.label}
        onChange={(e) => onChange({ ...form, label: e.target.value })}
        fullWidth
      />
      <Stack direction="row" spacing={2}>
        <TextField
          select
          label="Tone"
          size="small"
          value={form.tone}
          onChange={(e) => onChange({ ...form, tone: e.target.value as Scenario['tone'] })}
          sx={{ minWidth: 140 }}
        >
          {TONE_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Icon"
          size="small"
          value={form.icon}
          onChange={(e) => onChange({ ...form, icon: e.target.value })}
          fullWidth
          slotProps={{
            select: {
              renderValue: (value) => (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  {renderMaterialIcon(value as string, { fontSize: 'small' })}
                  <span>{value as string}</span>
                </Stack>
              ),
            },
          }}
        >
          {ICON_NAMES.map((name) => (
            <MenuItem key={name} value={name}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {renderMaterialIcon(name, { fontSize: 'small' })}
                <span>{name}</span>
              </Stack>
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        Branching — leave "Follows date" blank for a scenario that isn't gated by another day's
        outcome.
      </Typography>
      <DatePicker
        label="Follows date (optional)"
        value={form.followsScenarioDate ? dayjs(form.followsScenarioDate, 'YYYY-MM-DD') : null}
        onChange={(value) =>
          onChange({
            ...form,
            followsScenarioDate: value?.isValid() ? value.format('YYYY-MM-DD') : undefined,
          })
        }
        slotProps={{ textField: { size: 'small' } }}
      />
      <TextField
        select
        label="Requires one of (optional)"
        size="small"
        value={requiresValue}
        onChange={(e) => {
          const value = e.target.value as unknown as string | string[];
          const ids = typeof value === 'string' ? value.split(',') : value;
          onChange({ ...form, requiresScenarioId: ids.length ? ids : undefined });
        }}
        slotProps={{
          select: {
            multiple: true,
            renderValue: (selected) => (
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                {(selected as string[]).map((id) => (
                  <Chip
                    key={id}
                    size="small"
                    label={otherScenarios.find((s) => s._id === id)?.label ?? id}
                  />
                ))}
              </Stack>
            ),
          },
        }}
      >
        {groupedOtherScenarios.flatMap(({ date, scenarios: group }) => [
          <ListSubheader key={`requires-header-${date ?? 'none'}`}>
            {date ? formatDateLabel(date) : 'Not yet scheduled'}
          </ListSubheader>,
          ...group.map((s) => (
            <MenuItem key={s._id} value={s._id}>
              <Checkbox size="small" checked={requiresValue.includes(s._id)} />
              <ListItemText primary={s.label} secondary={s.tone} />
            </MenuItem>
          )),
        ])}
      </TextField>
      <TextField
        select
        label="Parent scenario (optional)"
        size="small"
        value={form.parentScenarioId ?? ''}
        onChange={(e) => onChange({ ...form, parentScenarioId: e.target.value || undefined })}
        slotProps={{
          select: {
            renderValue: (value): string =>
              otherScenarios.find((s) => s._id === value)?.label ?? 'None — a top-level scenario',
          },
        }}
      >
        <MenuItem value="">None — a top-level scenario</MenuItem>
        {groupedOtherScenarios.flatMap(({ date, scenarios: group }) => [
          <ListSubheader key={`parent-header-${date ?? 'none'}`}>
            {date ? formatDateLabel(date) : 'Not yet scheduled'}
          </ListSubheader>,
          ...group.map((s) => (
            <MenuItem key={s._id} value={s._id}>
              <ListItemText primary={s.label} secondary={s.tone} />
            </MenuItem>
          )),
        ])}
      </TextField>
    </Stack>
  );
}
