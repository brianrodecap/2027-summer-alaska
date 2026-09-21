import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { todayDateStr } from '../../model/tripModel';
import type { TripView } from '../../model/types';
import { dayElementId } from '../day/dayLayout';

// The two ways the URL's date drives the day list: scrolling to it, and — on
// the bare /days route — defaulting to today.
export function useDayListNavigation(
  view: TripView | null,
  slug: string | undefined,
  date: string | undefined,
) {
  const navigate = useNavigate();

  // `view` is a fresh object every time data is edited (setData ->
  // buildTripView recompute), so it can't be trusted as a "did the URL's
  // date actually change" signal on its own — that would re-scroll to
  // `date` on every edit, fighting any scrolling the user had done since.
  // This only auto-scrolls once per distinct `date`, retrying only until
  // `view` first becomes available, to cover the case where the day's
  // element doesn't exist in the DOM yet (data still loading on first
  // mount) — depending on `viewLoaded` rather than `view` itself keeps the
  // effect from re-firing on every later edit once that first load has
  // happened.
  const scrolledDateRef = useRef<string | undefined>(undefined);
  const viewLoaded = Boolean(view);
  useEffect(() => {
    if (!date || scrolledDateRef.current === date) return;
    const el = document.getElementById(dayElementId(date));
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    scrolledDateRef.current = date;
  }, [date, viewLoaded]);

  // Landing on the bare /days route (no date in the URL) — as opposed to a
  // direct link to a specific day — defaults to today's date when today
  // falls within the trip, so opening the day list mid-trip doesn't strand
  // the traveler back at day one. Redirecting (rather than just scrolling)
  // reuses the scroll effect above and leaves the URL correctly reflecting
  // what's on screen, same as picking today from "Jump to a day" would.
  useEffect(() => {
    if (date || !view?.dateRange) return;
    const today = todayDateStr();
    if (today >= view.dateRange.startDate && today <= view.dateRange.endDate) {
      navigate(`/${slug}/days/${today}`, { replace: true });
    }
  }, [date, view?.dateRange, slug, navigate]);
}
