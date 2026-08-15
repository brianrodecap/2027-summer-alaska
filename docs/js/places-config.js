// Google Places API (New) key. This ships to every visitor's browser — there's no
// server in this static-site setup to keep it secret — so it's protected by
// restriction, not secrecy: in Google Cloud Console, restrict it to the Places API
// only, restrict it by HTTP referrer to this site's GitHub Pages domain, and set a
// low daily quota cap on the key so worst-case exposure is bounded. See the chat
// history / CLAUDE.md for the full reasoning.
export const PLACES_API_KEY = 'AIzaSyAHMCIGQoJLDgU0Eio_bJKJkIQU36LP1uc';
