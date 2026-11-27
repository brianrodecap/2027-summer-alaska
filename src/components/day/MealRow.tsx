import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import type { ReactNode, Ref } from 'react';

import { activityCardAdds } from '../../model/activityCard';
import { firstImage, timeAndMealTypeLabel, uniqueById } from '../../model/formatting';
import {
  activeMealOptions,
  bookingHolder,
  includedInLabel,
  includedInOf,
  liveWarnings,
  mealChipLabels,
  mealOptionLabel,
  mealOptionTimeLabel,
  selectedMealOptionIndex,
} from '../../model/mealOptions';
import {
  activityHeadline,
  activityNodeKey,
  activityStart,
  entryNotes,
  optionShows,
  rowShows,
} from '../../model/tripModel';
import type { Booking, Day, EnrichedActivity } from '../../model/types';
import { cardId } from '../../state/expandedRows';
import { useTravelerNames } from '../../state/useTravelerNames';
import { useTripData } from '../../state/useTripData';
import { useMealOptionSelection } from '../../state/useTripSelections';
import { ActivityExtras, ActivityGoogle, ActivityLines } from '../detail/ActivityCardDetails';
import { LinkifiedText } from '../shared/LinkifiedText';
import { DINING_FORMAT_ICON, renderMaterialIcon } from '../shared/materialIcon';
import { OverlapWarnings } from '../shared/OverlapWarnings';
import { AvatarOrDotView } from './AvatarOrDot';
import { useClockSuffix } from './dayClock';
import { PlaceConditionsLine } from './PlaceConditionsLine';
import { RowCard } from './RowCard';
import { useSunAnchoredTime } from './useSunAnchoredTime';

// A meal Activity with MealOption candidates: the selected candidate's card, with
// a chip group for switching candidates. Both the Activity's own alerts and the
// selected candidate's show.
export function MealRow({
  activity,
  day,
  inView,
  cardRef,
  selected: rowSelected,
  menu,
}: {
  activity: EnrichedActivity;
  day: Day;
  inView: boolean;
  cardRef: Ref<HTMLDivElement>;
  selected?: boolean;
  menu: ReactNode;
}) {
  const { mealOptionIndex, selectMealOption } = useMealOptionSelection();
  const options = activeMealOptions(activity, day);
  const index = selectedMealOptionIndex(options, mealOptionIndex, activity._id);
  const selected = options[index] ?? null;
  const shown = selected && optionShows(selected);
  const notes = uniqueById([
    ...rowShows({ type: 'activity', activity }).notes,
    ...(shown?.notes ?? []),
  ]);
  // A selected candidate's own mealOptionTimeLabel already answers "what
  // time is this, really" more specifically than a sun-anchored Sunrise/
  // Sunset label ever could, so that lookup only fires for a still-open
  // meal with no candidate picked yet.
  const sunAnchored = useSunAnchoredTime(activity, day, inView && !selected);
  const timeOverride = selected ? mealOptionTimeLabel(activity, selected) : sunAnchored;
  const clock = useClockSuffix(activity.startAt ? activityStart(activity) : null);
  const { data } = useTripData();
  const names = useTravelerNames();
  // A candidate with no place is titled by what includes it, where something does:
  // "Included" alone would only repeat its chip.
  const includedIn =
    selected && !selected.place && data
      ? includedInLabel(data, includedInOf(activity, selected))
      : null;
  const headline = selected
    ? (includedIn ?? mealOptionLabel(selected))
    : activityHeadline(activity);
  const allNotes = uniqueById([...entryNotes(activity), ...(shown?.notes ?? [])]);
  const chipLabels = mealChipLabels(options, index);
  const formatShown = options.length > 1;
  const card = {
    data,
    activity,
    option: selected ?? undefined,
    title: headline,
    formatShown,
  };
  const opens = activityCardAdds({ ...card, notes: allNotes, names });

  return (
    <RowCard
      cardRef={cardRef}
      selected={rowSelected}
      notes={notes}
      booking={shown?.booking}
      name={headline}
      overline={timeAndMealTypeLabel(activity, timeOverride, clock)}
      title={selected ? headline : <LinkifiedText text={headline} />}
      conditions={<PlaceConditionsLine place={selected?.place ?? activity.place} date={day.date} />}
      photo={
        <AvatarOrDotView
          image={selected ? firstImage(activity, selected.place) : null}
          icon={selected ? DINING_FORMAT_ICON[selected.diningFormat] : 'event'}
          inView={inView}
        />
      }
      cardId={cardId(day.date, activityNodeKey(activity._id))}
      details={
        opens
          ? {
              booking: bookingHolder<{ booking: Booking | null }>(activity, selected).booking,
              notes: allNotes,
              lines: <ActivityLines {...card} />,
              extras: <ActivityExtras activity={activity} option={card.option} />,
              google: <ActivityGoogle activity={activity} option={card.option} />,
            }
          : undefined
      }
      menu={menu}
    >
      <OverlapWarnings warnings={liveWarnings(activity, day)} />
      {formatShown && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
          {options.map((option, i) => {
            const active = i === index;
            return (
              <Chip
                key={i}
                data-testid={`meal-option-${activity._id}-${i}`}
                label={chipLabels[i]}
                icon={renderMaterialIcon(DINING_FORMAT_ICON[option.diningFormat], {
                  fontSize: 'small',
                })}
                color={active ? 'primary' : 'default'}
                variant={active ? 'filled' : 'outlined'}
                onClick={() => selectMealOption(activity._id, i)}
              />
            );
          })}
        </Stack>
      )}
    </RowCard>
  );
}
