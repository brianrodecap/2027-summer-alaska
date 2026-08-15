export default {
  id: 'jul2',
  dateLabel: 'Fri Jul 2',
  location: 'Copper Center',
  hotel: 'Copper River Princess Wilderness Lodge',
  restaurant: 'Two Rivers Restaurant',
  summary:
    'Drive Fairbanks → Copper Center; <strong>Wrangell–St. Elias NP Visitor Center</strong>; optional Mount Wrangell flightseeing.',
  notes: [],
  variants: [
    {
      tone: 'ideal',
      items: [
        { time: '9:00am', text: 'Depart Westmark Fairbanks, final fuel stop in Fairbanks' },
        { time: '9:00am–2:30pm', text: 'Drive Fairbanks → Copper Center via Richardson Hwy (~5.5 hrs, ~250 miles)' },
        { time: '2:30pm', text: 'Arrive Copper Center, check into Copper River Princess Wilderness Lodge' },
        { time: '3:00–4:00pm', text: 'Wrangell–St. Elias National Park Visitor Center — exhibits, relief model of the park, ranger talk if one’s scheduled', place: { id: 'ChIJRabRJduQtVYRO5fDE4treEU', label: 'Wrangell-St. Elias Visitor Center' } },
        { time: '4:15–5:00pm', text: 'George I. Ashby Memorial Museum (hours found were inconsistent across sources — worth a quick call ahead; historic log cabins with early mining and Russian artifacts)', place: { id: 'ChIJD_gXFWOWtVYRvSRwYiqDR2M', label: 'George I. Ashby Memorial Museum' } },
        { time: '6:30pm', text: 'Dinner at Two Rivers Restaurant (or the more casual Whistle Stop Bar & Grill), both at the lodge', place: { id: 'ChIJW2f02GyXtVYRU5Mj6e3eLic', label: 'Two Rivers Restaurant' } },
      ],
      footer:
        '<p><strong>Optional, book ahead:</strong> Mount Wrangell flightseeing with Copper Valley Air Service<sup><a href="#fn4">4</a></sup> (Gulkana Airport, Glennallen, ~20–25 min away) — no walk-in hours; "Three Peak Tour" (~60 min, ~$400/person, Mt. Sanford/Mt. Drum/Mt. Wrangell) or "Flight of Majesty" (~120 min, adds mud volcanoes and wildlife) — would replace one of the stops above given the day’s long drive.</p>',
    },
  ],
};
