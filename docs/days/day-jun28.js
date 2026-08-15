export default {
  id: 'jun28',
  dateLabel: 'Mon Jun 28',
  location: 'Fairbanks',
  hotel: 'Westmark Fairbanks',
  restaurant: 'Lavelle’s Bistro',
  summary: '<strong>Denali National Park</strong> green Transit Bus + drive to Fairbanks.',
  notes: [
    {
      icon: 'warning',
      html: '<strong>Road status note:</strong> the Denali Park Road has been closed at Mile 43 (East Fork Bridge) since 2021 due to the Pretty Rocks Landslide. NPS has targeted full bus service to Eielson/Wonder Lake/Kantishna to resume in 2027, but hasn’t confirmed a date — the plan below is built around the Mile 43 turnaround as the safe assumption. Worth reconfirming on the NPS Denali “current conditions” page closer to your travel date; if the full road has reopened by then, a longer bus ride becomes possible but likely wouldn’t fit in the same day as the drive to Fairbanks.',
    },
  ],
  variants: [
    {
      tone: 'ideal',
      items: [
        { time: '6:30am', text: 'Depart Talkeetna Alaskan Lodge, drive to Denali National Park entrance (~2 hrs)' },
        { time: '8:30am', text: 'Arrive Denali Bus Depot / Wilderness Access Center, check in for your reserved Transit Bus departure (book ahead at reservedenali.com; arrive 20 min early)', place: { id: 'ChIJh0yE6LLYzFYRkQ2PsoJ3EBk', label: 'Denali Bus Depot' } },
        { time: '9:00am (approx.)', text: 'Board your reserved green Transit Bus toward East Fork Bridge (Mile 43) — exact departure time is assigned when you book tickets, not fixed at 9am — hop-off privileges anywhere beyond Savage River for wildlife viewing and photos, reboard any later green bus; round trip ~4.5 hrs at the current Mile 43 turnaround' },
        { time: '1:30pm', text: 'Return to Denali Bus Depot' },
        { time: '1:30–2:00pm', text: 'Quick lunch at the Morino Grill, Denali Visitor Center', place: { id: 'ChIJm08IkFHfzFYRR1motg0wk64', label: 'Morino Grill' } },
        { time: '2:00–3:00pm', text: 'Sled Dog Kennels demonstration (free shuttle from the Denali Visitor Center, 2:00pm show)', place: { id: 'ChIJY28Rjp4gzVYRQFLw8NqoU-E', label: 'Denali Sled Dog Kennels' } },
        { time: '3:00pm', text: 'Depart the park, continue drive to Fairbanks (~2.5–3 hrs)' },
        { time: '5:30–6:00pm', text: 'Arrive Fairbanks, check into Westmark Fairbanks' },
        { time: '6:30pm', text: 'Dinner at Lavelle’s Bistro', place: { id: 'ChIJfZzvXUhFMlERAg8qhKjtnQY', label: 'Lavelle’s Bistro' } },
      ],
    },
  ],
};
