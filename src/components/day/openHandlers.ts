import type {
  EnrichedActivity,
  EnrichedMealOption,
  EnrichedStay,
  EnrichedTransit,
} from '../../model/types';

// The three "open this row's detail" callbacks a day-list row can trigger —
// threaded from DaysView's detail panels down through the day list, each
// day's timeline and its scenario tabs, and shared with the map sidebar.
export interface DayRowOpeners {
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  onOpenStay: (stay: EnrichedStay) => void;
  onOpenTransit: (transit: EnrichedTransit) => void;
}
