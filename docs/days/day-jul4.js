export default {
  id: 'jul4',
  dateLabel: 'Sun Jul 4',
  location: 'Kennecott/McCarthy',
  hotel: 'Kennicott Glacier Lodge',
  restaurant: 'Kennicott Glacier Lodge (or McCarthy Lodge)',
  summary: '<strong>Root Glacier hike</strong> + guided <strong>Kennecott Mill Tour</strong>.',
  notes: [
    {
      icon: 'info',
      html:
        'This fits both Kennecott essentials into 2 days and satisfies the lodge’s 2-night minimum. It does mean skipping the dedicated Wrangell–St. Elias flightseeing day<sup><a href="#fn10">10</a></sup> — worth reconsidering during the buffer pass, either as an early-morning add-on before the Root Glacier hike on July 4, or reinstated as a third day if you’d rather not compress further.',
    },
  ],
  variants: [
    {
      tone: 'ideal',
      items: [
        { time: '8:00am', text: 'Breakfast at Kennicott Glacier Lodge', place: { id: 'ChIJ2_1lpi2Cs1YRTk9_q-YuUM4', label: 'Kennicott Glacier Lodge' } },
        { time: '9:00am–1:30pm', text: 'Root Glacier guided half-day hike (St. Elias Alpine Guides — crampons provided, ~4.5 hrs)', place: { id: 'ChIJU-XcLiODs1YRBCWN4GuXAs4', label: 'St. Elias Alpine Guides' } },
        { time: '1:30–2:30pm', text: 'Lunch (packed lunch or quick bite at the lodge)' },
        { time: '3:00–5:00pm', text: 'Kennecott Mill Town Tour (St. Elias Alpine Guides, fixed 2-hr guided tour — the only way inside the 14-story concentration mill; check in 10 min early at their office, second building on the left entering town)', place: { id: 'ChIJU-XcLiODs1YRBCWN4GuXAs4', label: 'St. Elias Alpine Guides' } },
        { time: '6:30pm', text: 'Dinner at Kennicott Glacier Lodge, or walk into McCarthy for a change of scenery at McCarthy Lodge', place: { id: 'ChIJ2_1lpi2Cs1YRTk9_q-YuUM4', label: 'Kennicott Glacier Lodge' } },
      ],
    },
  ],
};
