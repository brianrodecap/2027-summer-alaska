export default {
  id: 'jul6',
  dateLabel: 'Tue Jul 6',
  location: 'Kotzebue',
  hotel: 'Nullaqvik Hotel',
  restaurant: 'Bayside Restaurant',
  summary:
    'Early flight ANC → OTZ<sup><a href="#fn6">6</a></sup> — arriving by late morning opens a bonus buffer attempt at Kobuk Valley the same day.',
  notes: [
    {
      icon: 'info',
      html:
        'Taking the early flight turns this from a pure travel day into a bonus buffer day for Kobuk Valley — you land with the afternoon still open instead of arriving in the evening.',
    },
  ],
  variants: [
    {
      tone: 'ideal',
      items: [
        { time: '7:00am', text: 'Depart Hotel Captain Cook, head to Ted Stevens Anchorage International (ANC)' },
        { time: '8:40–9:00am', text: 'Flight ANC → OTZ (<a href="https://www.google.com/search?q=anc+to+otz" target="_blank" rel="noopener">search flights</a>, Alaska Airlines, ~1 hr 40 min)' },
        { time: '~10:30am', text: 'Arrive Kotzebue' },
        { time: '11:00am', text: 'Check into Nullaqvik Hotel, drop bags' },
        { time: '11:30am', text: 'Check in with Golden Eagle Outfitters at their hangar near the Alaska terminal — let them know you’re in town; since they fly in queue order as conditions allow, there’s a real chance of getting the Kobuk Valley flight in this same afternoon' },
        { time: 'Early–mid afternoon', text: 'Kobuk Valley flightseeing if a slot opens up (weather permitting); if not, this becomes free time instead' },
        { time: '1:00–3:00pm (if no flight)', text: 'Northwest Arctic Heritage Center, walk Shore Avenue along the lagoon' },
        { time: '6:30pm', text: 'Dinner at Bayside Restaurant' },
      ],
    },
  ],
};
