// A Map ID (Cloud Console → Maps → Map Management) is required for
// AdvancedMarker — Google's advanced-marker feature only works on a map
// using cloud-based map styling, i.e. a `Map` component with a real `mapId`.
// This project's own Map ID, created in this project's own Cloud Console —
// not a secret (it only names a map style; the Google key in apiKeys.ts
// authorizes requests), so it's fine to commit.
export const GOOGLE_MAPS_MAP_ID = '9118b4d484c56554c6f9202b';
