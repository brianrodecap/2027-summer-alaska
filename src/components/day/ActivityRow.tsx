import type { ReactNode, Ref } from 'react';

import { activityCardAdds } from '../../model/activityCard';
import { firstImage, timeAndMealTypeLabel } from '../../model/formatting';
import { liveWarnings } from '../../model/mealOptions';
import {
  activityHeadline,
  activityNodeKey,
  activityStart,
  entryNotes,
  rowShows,
} from '../../model/tripModel';
import type { Day, EnrichedActivity } from '../../model/types';
import { cardId } from '../../state/expandedRows';
import { useTravelerNames } from '../../state/useTravelerNames';
import { useTripData } from '../../state/useTripData';
import { ActivityExtras, ActivityGoogle, ActivityLines } from '../detail/ActivityCardDetails';
import { LinkifiedText } from '../shared/LinkifiedText';
import { activityRowIconName } from '../shared/materialIcon';
import { OverlapWarnings } from '../shared/OverlapWarnings';
import { AvatarOrDotView } from './AvatarOrDot';
import { useClockSuffix } from './dayClock';
import { PlaceConditionsLine } from './PlaceConditionsLine';
import { RowCard } from './RowCard';
import { useSunAnchoredTime } from './useSunAnchoredTime';

// A plain (non-meal) Activity's card. DayTimeline picks this or MealRow by
// isMealActivity().
export function ActivityRow({
  activity,
  day,
  inView,
  cardRef,
  selected,
  menu,
}: {
  activity: EnrichedActivity;
  day: Day;
  inView: boolean;
  cardRef: Ref<HTMLDivElement>;
  selected?: boolean;
  menu: ReactNode;
}) {
  const timeText = useSunAnchoredTime(activity, day, inView);
  const clock = useClockSuffix(activity.startAt ? activityStart(activity) : null);
  const { booking, notes } = rowShows({ type: 'activity', activity });
  const headline = activityHeadline(activity);
  const { data } = useTripData();
  const names = useTravelerNames();
  const allNotes = entryNotes(activity);
  const opens = activityCardAdds({ data, activity, title: headline, notes: allNotes, names });

  return (
    <RowCard
      cardRef={cardRef}
      selected={selected}
      notes={notes}
      booking={booking}
      name={headline}
      overline={timeAndMealTypeLabel(activity, timeText, clock)}
      title={<LinkifiedText text={headline} />}
      conditions={<PlaceConditionsLine place={activity.place} date={day.date} />}
      photo={
        <AvatarOrDotView
          image={firstImage(activity, activity.place)}
          icon={activityRowIconName(activity)}
          inView={inView}
        />
      }
      cardId={cardId(day.date, activityNodeKey(activity._id))}
      details={
        opens
          ? {
              booking: activity.booking,
              notes: allNotes,
              lines: <ActivityLines activity={activity} title={headline} />,
              extras: <ActivityExtras activity={activity} />,
              google: <ActivityGoogle activity={activity} />,
            }
          : undefined
      }
      menu={menu}
    >
      <OverlapWarnings warnings={liveWarnings(activity, day)} />
    </RowCard>
  );
}
