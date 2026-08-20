import type { ComponentType } from 'react';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import HotelIcon from '@mui/icons-material/Hotel';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import FlightIcon from '@mui/icons-material/Flight';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import CloudIcon from '@mui/icons-material/Cloud';
import RedeemIcon from '@mui/icons-material/Redeem';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import TakeoutDiningIcon from '@mui/icons-material/TakeoutDining';
import KitchenIcon from '@mui/icons-material/Kitchen';
import SignpostIcon from '@mui/icons-material/Signpost';
import EventIcon from '@mui/icons-material/Event';
import PlaceIcon from '@mui/icons-material/Place';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import LandscapeIcon from '@mui/icons-material/Landscape';
import RouteIcon from '@mui/icons-material/Route';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import HelpOutlineIcon from '@mui/icons-material/Help';
import MuseumIcon from '@mui/icons-material/Museum';
import PaletteIcon from '@mui/icons-material/Palette';
import AttractionsIcon from '@mui/icons-material/Attractions';
import InfoIcon from '@mui/icons-material/Info';
import ParkIcon from '@mui/icons-material/Park';
import HikingIcon from '@mui/icons-material/Hiking';
import CabinIcon from '@mui/icons-material/Cabin';
import RvHookupIcon from '@mui/icons-material/RvHookup';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import BakeryDiningIcon from '@mui/icons-material/BakeryDining';
import LocalBarIcon from '@mui/icons-material/LocalBar';
import SportsBarIcon from '@mui/icons-material/SportsBar';
import LocalGroceryStoreIcon from '@mui/icons-material/LocalGroceryStore';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import PetsIcon from '@mui/icons-material/Pets';
import WaterIcon from '@mui/icons-material/Water';
import TerrainIcon from '@mui/icons-material/Terrain';
import StorefrontIcon from '@mui/icons-material/Storefront';
import ScheduleIcon from '@mui/icons-material/Schedule';
import PaidIcon from '@mui/icons-material/Paid';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import GroupIcon from '@mui/icons-material/Group';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import StarIcon from '@mui/icons-material/Star';
import WarningIcon from '@mui/icons-material/Warning';
import FilterListIcon from '@mui/icons-material/FilterList';

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

export const DEFAULT_PLACE_ICON = 'place';

export const DINING_FORMAT_ICON: Record<DiningFormat, string> = {
  included: 'redeem',
  package: 'local_offer',
  'sit-down': 'restaurant',
  'grab-and-go': 'takeout_dining',
  drivethru: 'directions_car',
  'self-catered': 'kitchen',
};

export const ROUTE_TONE_ICON: Record<string, string> = {
  direct: 'trending_flat',
  scenic: 'landscape',
};
