export default {
  id: 'jun29',
  dateLabel: 'Tue Jun 29',
  location: 'Coldfoot',
  hotel: 'Slate Creek Inn (Coldfoot Camp)',
  restaurant: 'Coldfoot Camp Cafe',
  summary: 'Drive Fairbanks → Coldfoot via <strong>Dalton Hwy</strong>.',
  notes: [
    {
      icon: 'schedule',
      html: '<strong>Meal-timing note:</strong> Coldfoot Camp Cafe runs buffet-only service in summer — breakfast buffet 5–9am, dinner buffet 5–9pm. Between those windows, only truckers can order off the menu, so the plan below eats lunch on the road rather than at Coldfoot.',
    },
  ],
  variants: [
    {
      tone: 'ideal',
      items: [
        { time: '7:00am', text: 'Depart Westmark Fairbanks; top off fuel and grab supplies in Fairbanks — it’s the last reliable gas before Coldfoot (~240 miles)' },
        { time: '7:00–9:15am', text: 'Drive to the Yukon River Bridge (~135 miles)' },
        { time: '9:15–9:45am', text: 'Stop at Yukon River Camp — restrooms, coffee/snacks, photos of the Yukon River and the Trans-Alaska Pipeline', place: { id: 'ChIJCSqfQ1VLKVER9FZigu88Qtg', label: 'Yukon River Camp' } },
        { time: '9:45–11:00am', text: 'Drive to the Arctic Circle sign (Mile 115)' },
        { time: '11:00–11:30am', text: 'Arctic Circle photo stop' },
        { time: '11:30am–1:00pm', text: 'Drive to Coldfoot (~60 miles)' },
        { time: '1:00pm', text: 'Arrive Coldfoot; drop bags at Slate Creek Inn (early check-in isn’t guaranteed, but bags can usually be left); check in with Coyote Air at Coldfoot Airport about tomorrow’s flight' },
        { time: '1:30–4:30pm', text: 'Arctic Interagency Visitor Center — exhibits, bookstore, short nature trail to the Trans-Alaska Pipeline viewpoint (bring snacks for the afternoon, since the cafe is buffet-only at meal windows)', place: { id: 'ChIJmYs44d3AKFERJq-Pgp3qfhY', label: 'Arctic Interagency Visitor Center' } },
        { time: '5:00–6:00pm', text: 'Dinner buffet at Coldfoot Camp Cafe (5–9pm buffet window)', place: { id: 'ChIJifpoSNzAKFERJLZv8umH-cw', label: 'Coldfoot Camp Cafe' } },
        { time: 'Evening', text: 'Optional evening program at the Arctic Interagency Visitor Center, if one’s scheduled that night' },
      ],
    },
  ],
};
