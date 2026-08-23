import AltRouteIcon from '@mui/icons-material/AltRoute';
import AttractionsIcon from '@mui/icons-material/Attractions';
import BakeryDiningIcon from '@mui/icons-material/BakeryDining';
import CabinIcon from '@mui/icons-material/Cabin';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloudIcon from '@mui/icons-material/Cloud';
import CommuteIcon from '@mui/icons-material/Commute';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import EventIcon from '@mui/icons-material/Event';
import FilterListIcon from '@mui/icons-material/FilterList';
import FlightIcon from '@mui/icons-material/Flight';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import GroupIcon from '@mui/icons-material/Group';
import HelpOutlineIcon from '@mui/icons-material/Help';
import HikingIcon from '@mui/icons-material/Hiking';
import HotelIcon from '@mui/icons-material/Hotel';
import InfoIcon from '@mui/icons-material/Info';
import KitchenIcon from '@mui/icons-material/Kitchen';
import LandscapeIcon from '@mui/icons-material/Landscape';
import LinkIcon from '@mui/icons-material/Link';
import LocalBarIcon from '@mui/icons-material/LocalBar';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import LocalGroceryStoreIcon from '@mui/icons-material/LocalGroceryStore';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import MuseumIcon from '@mui/icons-material/Museum';
import PaidIcon from '@mui/icons-material/Paid';
import PaletteIcon from '@mui/icons-material/Palette';
import ParkIcon from '@mui/icons-material/Park';
import PetsIcon from '@mui/icons-material/Pets';
import PlaceIcon from '@mui/icons-material/Place';
import RedeemIcon from '@mui/icons-material/Redeem';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import RouteIcon from '@mui/icons-material/Route';
import RvHookupIcon from '@mui/icons-material/RvHookup';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SignpostIcon from '@mui/icons-material/Signpost';
import SportsBarIcon from '@mui/icons-material/SportsBar';
import StarIcon from '@mui/icons-material/Star';
import StorefrontIcon from '@mui/icons-material/Storefront';
import TakeoutDiningIcon from '@mui/icons-material/TakeoutDining';
import TerrainIcon from '@mui/icons-material/Terrain';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import WarningIcon from '@mui/icons-material/Warning';
import WaterIcon from '@mui/icons-material/Water';
import TimelineDot from '@mui/lab/TimelineDot';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import type { ComponentType, ReactElement } from 'react';

import type { DiningFormat } from '../../model/types';

// Every Material Symbols icon *name string* used in the trip data or ported
// from the old app's render code (Scenario.icon, Route variant tones, dining
// formats, day-list row fallbacks) mapped to its @mui/icons-material
// component — one central registry instead of a per-file lookup each place
// that used to render `<md-icon>${name}</md-icon>` needs.
type IconComponent = ComponentType<SvgIconProps>;

const ICONS: Record<string, IconComponent> = {
  hotel: HotelIcon,
  directions_car: DirectionsCarIcon,
  flight: FlightIcon,
  flight_takeoff: FlightTakeoffIcon,
  cloud: CloudIcon,
  redeem: RedeemIcon,
  local_offer: LocalOfferIcon,
  restaurant: RestaurantIcon,
  takeout_dining: TakeoutDiningIcon,
  kitchen: KitchenIcon,
  signpost: SignpostIcon,
  event: EventIcon,
  place: PlaceIcon,
  trending_flat: TrendingFlatIcon,
  landscape: LandscapeIcon,
  route: RouteIcon,
  alt_route: AltRouteIcon,
  museum: MuseumIcon,
  palette: PaletteIcon,
  attractions: AttractionsIcon,
  info: InfoIcon,
  park: ParkIcon,
  hiking: HikingIcon,
  cabin: CabinIcon,
  rv_hookup: RvHookupIcon,
  local_cafe: LocalCafeIcon,
  bakery_dining: BakeryDiningIcon,
  local_bar: LocalBarIcon,
  sports_bar: SportsBarIcon,
  local_grocery_store: LocalGroceryStoreIcon,
  local_gas_station: LocalGasStationIcon,
  pets: PetsIcon,
  water: WaterIcon,
  terrain: TerrainIcon,
  storefront: StorefrontIcon,
  schedule: ScheduleIcon,
  paid: PaidIcon,
  request_quote: RequestQuoteIcon,
  group: GroupIcon,
  calendar_month: CalendarMonthIcon,
  help_outline: HelpOutlineIcon,
  check_circle: CheckCircleIcon,
  star: StarIcon,
  warning: WarningIcon,
  filter_list: FilterListIcon,
  link: LinkIcon,
  commute: CommuteIcon,
};

// Maps a live Place's primaryType (Places API (New)) to an icon for the
// activity side sheet's header — known only once hydratePlaceDetails
// resolves. A meal option skips this entirely (its dining-format icon is
// known synchronously — see DINING_FORMAT_ICON).
export const PLACE_TYPE_ICON: Record<string, string> = {
  museum: 'museum',
  art_gallery: 'palette',
  tourist_attraction: 'attractions',
  visitor_center: 'info',
  park: 'park',
  national_park: 'park',
  hiking_area: 'hiking',
  campground: 'cabin',
  rv_park: 'rv_hookup',
  lodging: 'hotel',
  hotel: 'hotel',
  restaurant: 'restaurant',
  cafe: 'local_cafe',
  bakery: 'bakery_dining',
  bar: 'local_bar',
  brewery: 'sports_bar',
  grocery_store: 'local_grocery_store',
  supermarket: 'local_grocery_store',
  gas_station: 'local_gas_station',
  airport: 'flight',
  zoo: 'pets',
  aquarium: 'water',
  natural_feature: 'terrain',
  store: 'storefront',
};

export function materialIcon(name: string | null | undefined): IconComponent {
  return (name && ICONS[name]) || HelpOutlineIcon;
}

// Picking an icon *component* based on render-time data (a name string that
// varies by row/scenario/dining format) and then rendering it as a JSX tag
// (`<Icon .../>`) trips react-hooks/static-components — React can't tell the
// selection is a stable lookup rather than a component freshly defined on
// every render. Returning the built element from a plain (lowercase, non-
// component) function sidesteps that: callers never hold onto an icon
// component reference themselves.
export function renderMaterialIcon(
  name: string | null | undefined,
  props?: SvgIconProps,
): ReactElement {
  const Icon = materialIcon(name);
  return <Icon {...props} />;
}

// The day timeline's default leading-dot treatment (see DayTimeline.tsx,
// ActivityRow.tsx, MealRow.tsx) — an outlined dot around a small icon,
// substituted for a row's own image when it has none.
export function RowLeadingDot({ icon }: { icon: string | null | undefined }): ReactElement {
  return (
    <TimelineDot variant="outlined" color="grey">
      {renderMaterialIcon(icon, { fontSize: 'small' })}
    </TimelineDot>
  );
}

export const DEFAULT_PLACE_ICON = 'place';

export const DINING_FORMAT_ICON: Record<DiningFormat, string> = {
  included: 'redeem',
  package: 'local_offer',
  'included-with-activity': 'link',
  'included-with-transit': 'commute',
  'sit-down': 'restaurant',
  'grab-and-go': 'takeout_dining',
  drivethru: 'directions_car',
  'self-catered': 'kitchen',
};

export const ROUTE_TONE_ICON: Record<string, string> = {
  direct: 'trending_flat',
  scenic: 'landscape',
};
