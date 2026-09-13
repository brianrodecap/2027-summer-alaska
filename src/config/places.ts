// Google Places API (New) key. This ships to every visitor's browser — there's no
// server in this static-site setup to keep it secret — so it's protected by
// restriction, not secrecy: in Google Cloud Console, restrict it to the Places API
// only, restrict it by HTTP referrer to this site's GitHub Pages domain, and set a
// low daily quota cap on the key so worst-case exposure is bounded.
//
// The day map (DayMapSidebar) also loads the Maps JavaScript API with this
// same key, so "Places API" restriction above needs "Maps JavaScript API"
// added alongside it in Cloud Console before the map will render — same
// key, same referrer/quota protection, just one more API enabled on it.
export const PLACES_API_KEY = 'AIzaSyAHMCIGQoJLDgU0Eio_bJKJkIQU36LP1uc';

// A Map ID (Cloud Console → Maps → Map Management) is required for
// AdvancedMarker — Google's advanced-marker feature only works on a map
// using cloud-based map styling, i.e. a `Map` component with a real `mapId`.
// This project's own Map ID, created in this project's own Cloud Console —
// not a secret (same exposure model as the key above), so it's fine to
// commit.
export const GOOGLE_MAPS_MAP_ID = '9118b4d484c56554c6f9202b';
