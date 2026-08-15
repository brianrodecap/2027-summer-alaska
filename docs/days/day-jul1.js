export default {
  id: 'jul1',
  dateLabel: 'Thu Jul 1',
  location: 'Fairbanks',
  hotel: 'Westmark Fairbanks',
  restaurant: 'The Pump House Restaurant',
  summary: 'Buffer day<sup><a href="#fn3">3</a></sup> — drive back to Fairbanks, with a backup flight scenario if Jun 30 was weathered out.',
  notes: [
    {
      icon: 'warning',
      html: '<strong>Buffer risk worth flagging:</strong> as currently built, Gates of the Arctic gets exactly two attempts — June 30 and the July 1 morning backup — before you’re committed to driving south. Two consecutive bad-weather days at Coldfoot would mean missing the park outright, with no later point in the trip to circle back. Worth deciding whether to add a third buffer day at Coldfoot (pulled from the Lake Clark/Katmai reserve, currently at 4 days).',
    },
  ],
  variants: [
    {
      tone: 'ideal',
      label: 'If June 30’s flight went (relaxed drive-back day)',
      icon: 'flight_takeoff',
      items: [
        { time: '8:00–8:45am', text: 'Breakfast buffet at Coldfoot Camp Cafe', place: { id: 'ChIJifpoSNzAKFERJLZv8umH-cw', label: 'Coldfoot Camp Cafe' } },
        { time: '9:00am', text: 'Depart Coldfoot, drive to Fairbanks (~5.5–6 hrs)' },
        { time: '2:30–3:00pm', text: 'Arrive Fairbanks, check into Westmark Fairbanks' },
        { time: '3:30–6:00pm', text: 'University of Alaska Museum of the North (admission until 6:30pm)', place: { id: 'ChIJAca7fEtbMlERWW6yR4ANuKU', label: 'University of Alaska Museum of the North' } },
        { time: '6:30pm', text: 'Dinner at The Pump House Restaurant', place: { id: 'ChIJbf5SBnJbMlEReyVKG1_ISbU', label: 'The Pump House Restaurant' } },
      ],
    },
    {
      tone: 'alternate',
      label: 'If June 30’s flight was weathered out (last-chance backup day)',
      icon: 'cloud',
      items: [
        { time: '7:00am', text: 'Check with Coyote Air first thing — if conditions look workable, plan to fly this morning', place: { id: 'ChIJ_0I_bsnBKFERI4b1NuS8eVM', label: 'Coyote Air' } },
        { time: '7:30–9:30am (if flying)', text: 'Gates of the Arctic Tour flight, weather permitting' },
        { time: '10:00am', text: 'Depart Coldfoot regardless of outcome, drive to Fairbanks (~5.5–6 hrs)' },
        { time: '~3:30–4:00pm (if flew) or ~1:00pm (if grounded)', text: 'Arrive Fairbanks, check into Westmark Fairbanks' },
        { time: 'Remaining afternoon', text: 'Museum of the North if there’s time before the 6:30pm admission cutoff; otherwise just rest', place: { id: 'ChIJAca7fEtbMlERWW6yR4ANuKU', label: 'University of Alaska Museum of the North' } },
        { time: '6:30pm', text: 'Dinner at The Pump House Restaurant', place: { id: 'ChIJbf5SBnJbMlEReyVKG1_ISbU', label: 'The Pump House Restaurant' } },
      ],
      footer:
        '<p>If Gates of the Arctic still doesn’t happen after both attempts, there’s no ground alternative to fall back on — unlike Denali or Wrangell–St. Elias, this park is fly-in only, so missing it means missing the park entirely.</p>',
    },
  ],
};
