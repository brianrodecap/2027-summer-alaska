export default {
  id: 'jul5',
  dateLabel: 'Mon Jul 5',
  location: 'Anchorage',
  hotel: 'Hotel Captain Cook',
  restaurant: 'Glacier BrewHouse',
  summary:
    'Drive Kennecott → Anchorage via Glenn Hwy, with a <strong>Matanuska Glacier</strong> helicopter tour stop at <strong>Sheep Mountain Air</strong>.',
  notes: [],
  variants: [
    {
      tone: 'ideal',
      items: [
        { time: '7:00am', text: 'Breakfast at Kennicott Glacier Lodge, check out' },
        { time: '7:30am', text: 'Shuttle to the footbridge, cross, retrieve the car' },
        { time: '8:00am–12:30pm', text: 'Drive McCarthy Road → Richardson Hwy → Glenn Hwy to Sheep Mountain Lodge (~4.5 hrs)' },
        { time: '12:30–1:00pm', text: 'Lunch at Sheep Mountain Lodge' },
        { time: '1:00–2:00pm', text: 'Matanuska Glacier helicopter tour with Sheep Mountain Air — Blue Pool Glacier Landing Tour (45 min: 20 min in air, 25 min on the ice, ~$299/person) is a solid default; the 2-Landing Tour (90 min, ~$399/person) is there if you’d rather make this the day’s centerpiece' },
        { time: '2:00–4:30pm', text: 'Continue drive to Anchorage (~2–2.5 hrs)' },
        { time: '4:30–5:00pm', text: 'Arrive Anchorage, check into Hotel Captain Cook' },
        { time: '6:30pm', text: 'Dinner at Glacier BrewHouse' },
      ],
    },
  ],
};
