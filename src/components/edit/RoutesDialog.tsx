import { arrayMove } from '@dnd-kit/sortable';
import Alert from '@mui/material/Alert';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { alpha, useTheme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { APIProvider } from '@vis.gl/react-google-maps';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getGoogleApiKey, hasGoogleApiKey } from '../../config/apiKeys';
import { usePlaceCoordinates } from '../../hooks/usePlaceCoordinates';
import { usePlayback } from '../../hooks/usePlayback';
import { resolveRouteProposal } from '../../model/askAIDrafts';
import { recomputeRouteTravel, recomputeVariant, reorderRouteStages } from '../../model/directions';
import { applyRouteForm, blankRouteVariant, nextRouteId } from '../../model/editForms';
import { formatMinutes } from '../../model/formatting';
import type { Coordinates } from '../../model/placeCoordinates';
import { pickedPlace } from '../../model/placePhotos';
import { fetchPlaceFields } from '../../model/places';
import {
  arrivalMinutes,
  type Bounds,
  boundsOf,
  boundsOverlap,
  DEFAULT_EXAMPLE_DEPARTURE,
  doublingBack,
  draftVariantId,
  exampleClock,
  fromTimeInput,
  insertIndexFor,
  matchesFilters,
  needsPlaces,
  openingVariantIndex,
  optimizeOrder,
  pathMiles,
  previewState,
  previewSteps,
  previewTotal,
  routeDoublesBack,
  type RouteFilter,
  routeMilesRange,
  routePlaceIds,
  routePoints,
  routeTimeRange,
  toTimeInput,
  variantColor,
  variantColorIndex,
  variantPoints,
  variantSummary,
} from '../../model/routePlanner';
import {
  isReverseDrive,
  reverseRoute,
  reverseVariant,
  routeForDrive,
} from '../../model/routeReverse';
import { planRouteQuestion, type RouteTask, routeTaskQuestion } from '../../model/routeTasks';
import {
  DEFAULT_ROUTE_TONE,
  routePlaceStopMinutes,
  transitRouteLabel as routeLabel,
} from '../../model/tripModel';
import type { Place, Route, RouteEndpoint, RoutePlaceEntry, RouteVariant } from '../../model/types';
import { useTripData } from '../../state/useTripData';
import { materialIcon } from '../shared/materialIcon';
import { WarningBadge } from '../shared/WarningBadge';
import { TimeStringField } from './DateTimeFieldPair';
import { DraftCard } from './DraftCard';
import { NewRouteDialog } from './NewRouteDialog';
import { PreviewBar } from './PreviewBar';
import { RouteEditDialog } from './RouteEditDialog';
import { RoutePlannerMap } from './RoutePlannerMap';
import { StopList } from './StopList';
import { useRouteTask } from './useRouteTask';
import { VariantCards } from './VariantCards';
import { VariantEditor } from './VariantEditor';

const AddIcon = materialIcon('add');
const AutoAwesomeIcon = materialIcon('auto_awesome');
const AutoFixHighIcon = materialIcon('auto_fix_high');
const CloseIcon = materialIcon('close');
const DeleteIcon = materialIcon('delete');
const EditIcon = materialIcon('edit');
const FilterListIcon = materialIcon('filter_list');
const PlayArrowIcon = materialIcon('play_arrow');
const SearchIcon = materialIcon('search');
const SwapHorizIcon = materialIcon('swap_horiz');

// A short line in the variant's map color, as the map and the variant cards draw it.
function LineSwatch({ index }: { index: number }) {
  const color = useTheme().palette.routeVariants[index];
  return (
    <Box
      component="span"
      sx={{ display: 'inline-block', width: 24, height: 4, borderRadius: 2, bgcolor: color }}
    />
  );
}

// A Transit's drive the planner is opened for: it shows only the routes between
// the two places (either way round), lands on the one in use, and hands a chosen
// variant back through onUse.
export interface DriveScope {
  from: Place;
  to: Place;
  routeId: string | null;
  variantId: string | null;
  onUse: (route: Route, variantId: string) => void;
}

const endpoint = (p: Place): RouteEndpoint => ({
  id: p.id,
  label: p.label,
  ...(p.timeZone ? { timeZone: p.timeZone } : {}),
});

// A route the assistant proposed, awaiting review: `variantId` is the variant to
// preview (none when it can't be told), and `where` the part of the panel the card
// sits in. It was made for the route (and variant) in `base`, and is shown only while
// that is what's open and unchanged; a new route has no base.
interface AiDraft {
  base: Route | null;
  variant: number;
  route: Route;
  isNew: boolean;
  summary: string;
  variantId: string | null;
  where: 'stops' | 'top';
}

const ignoreBounds = () => {};

const ROUTE_FILTERS: { id: RouteFilter; label: string; tip: string }[] = [
  {
    id: 'needsPlaces',
    label: 'Needs places',
    tip: 'No places between the start and the end on any variant',
  },
  { id: 'hasScenic', label: 'Has scenic', tip: 'Has a variant that is not the direct one' },
  {
    id: 'doublesBack',
    label: 'Doubles back',
    tip: 'A variant has a leg that heads away from where it is going',
  },
];

const PREVIEW_NEEDS_PLACES = 'Every stop needs a place Google knows before it can be previewed.';

const STALE =
  'The route changed while its drive times or the assistant were being looked up, so that change was not saved.';

// A set with `item` taken out if it was in, put in if it was not.
function toggled<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
}

function placeName(entry: RoutePlaceEntry): string {
  return entry.label ?? entry.place?.label ?? 'a stop';
}

// A drive's points with its places taken in the given order.
function draftPoints(points: Coordinates[], order: number[]): Coordinates[] {
  return [points[0], ...order.map((i) => points[i + 1]), points[points.length - 1]];
}

// The route and variant a drive already uses if it still connects the two
// places, else whichever route does, on its direct variant.
function initialSelection(routes: Route[], drive: DriveScope | undefined) {
  const own = routes.find((r) => r._id === drive?.routeId);
  const route = drive && (own && routeForDrive([own], drive) ? own : routeForDrive(routes, drive));
  if (!route) return { id: null, variant: 0 };
  return { id: route._id, variant: openingVariantIndex(route, drive?.variantId ?? null) };
}

// routes.json is reference data shared across trips, not scoped to any one
// date — a Transit merely points at one via its own routeId/routeVariant.
// The planner shows the routes on a map and lists only those in view; the
// selected route's variants are drawn side by side and picked from the list,
// the map, or the panel on the right. Editing still goes through
// RouteEditDialog. onSave/onDelete go straight to the caller's own routes
// collection — there's no per-entity id this dialog is already scoped to the
// way EditContext's pencil-button flow is.
export function RoutesDialog({
  routes,
  open,
  onClose,
  onSave,
  onDelete,
  drive,
}: {
  routes: Route[];
  open: boolean;
  onClose: () => void;
  onSave: (route: Route) => void;
  onDelete: (id: string) => void;
  drive?: DriveScope;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <RoutesPlanner
        routes={routes}
        onClose={onClose}
        onSave={onSave}
        onDelete={onDelete}
        drive={drive}
      />
    </Dialog>
  );
}

function RoutesPlanner({
  routes,
  onClose,
  onSave,
  onDelete,
  drive,
}: {
  routes: Route[];
  onClose: () => void;
  onSave: (route: Route) => void;
  onDelete: (id: string) => void;
  drive?: DriveScope;
}) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ReadonlySet<RouteFilter>>(new Set());
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState<Route | null>(null);
  const [initial] = useState(() => initialSelection(routes, drive));
  const [selectedId, setSelectedId] = useState<string | null>(initial.id);
  const [variant, setVariant] = useState(initial.variant);
  const [bounds, setBounds] = useState<Bounds | null>(null);

  const scoped = drive !== undefined;
  const fromId = drive?.from.id ?? null;
  const toId = drive?.to.id ?? null;
  const shown = useMemo(
    () =>
      scoped
        ? routes.filter((r) => routeForDrive([r], { from: { id: fromId }, to: { id: toId } }))
        : routes,
    [routes, scoped, fromId, toId],
  );
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const placeIds = useMemo(
    () => [...new Set([...shown, ...(aiDraft ? [aiDraft.route] : [])].flatMap(routePlaceIds))],
    [shown, aiDraft],
  );
  const coords = usePlaceCoordinates(placeIds);
  const selected = shown.find((r) => r._id === selectedId) ?? null;
  const activeVariant = selected ? Math.max(0, Math.min(variant, selected.variants.length - 1)) : 0;
  const select = (id: string, index = 0) => {
    setSelectedId(id);
    setVariant(index);
  };
  // A drive running the route backwards sees it backwards: stops, caption and
  // map pins in the order the drive meets them. Edits made from this view are
  // turned back before saving, so the stored route keeps its own direction.
  const flip = !!selected && drive !== undefined && isReverseDrive(selected, drive);
  const view = useMemo(
    () => (flip && selected ? reverseRoute(selected) : selected),
    [flip, selected],
  );
  const mapRoutes = useMemo(
    () => (view && view !== selected ? shown.map((r) => (r === selected ? view : r)) : shown),
    [shown, selected, view],
  );
  const current = view?.variants[activeVariant] ?? null;
  const { palette } = useTheme();
  const activeColor =
    view && current
      ? variantColor(palette.routeVariants, view.variants, activeVariant)
      : palette.primary.main;
  const backs = view && current ? doublingBack(variantPoints(view, current, coords)) : [];

  // Edits made here are saved as they happen, through the same checks as the Edit
  // route form (one direct variant, a label on each, numbers of zero or more), and
  // a refusal is shown above the stops. They are made on the route as this drive
  // sees it, and turned back before saving, so the stored route keeps its direction.
  const [problem, setProblem] = useState<string | null>(null);
  const saveEdited = (next: Route): boolean => {
    if (!selected) return false;
    const clone = structuredClone(selected);
    const message = applyRouteForm(clone, flip ? reverseRoute(next) : next);
    setProblem(message);
    if (!message) onSave(clone);
    return !message;
  };
  const editVariant = (patch: Partial<RouteVariant>): boolean =>
    !!view &&
    saveEdited({
      ...view,
      variants: view.variants.map((v, i) => (i === activeVariant ? { ...v, ...patch } : v)),
    });
  const editStop = (index: number, entry: RoutePlaceEntry): boolean =>
    !!current && editVariant({ places: current.places.map((p, i) => (i === index ? entry : p)) });
  const addVariant = async () => {
    if (!view || pending) return;
    setPending(current?.places ?? []);
    try {
      const blank = { ...blankRouteVariant(view.variants), label: 'New variant' };
      // Its one leg, from start to end, is looked up like any other.
      const variant = await recomputeVariant(blank, view.from.id, view.to.id);
      if (latestView.current !== view) return setProblem(STALE);
      if (saveEdited({ ...view, variants: [...view.variants, variant] })) {
        setVariant(view.variants.length);
      }
    } finally {
      setPending(null);
    }
  };
  const removeVariant = () => {
    if (
      view &&
      saveEdited({ ...view, variants: view.variants.filter((_, i) => i !== activeVariant) })
    ) {
      setVariant(0);
    }
  };

  // A change to a variant's places (a new order, a removed stop, an added one) has
  // its drive times looked up and is then saved. While that runs the list already
  // shows it, and editing waits. A lookup that fails keeps that leg's old numbers,
  // as in RouteEditForm. If the route changed meanwhile, the change is dropped
  // rather than overwriting it.
  const [pending, setPending] = useState<RoutePlaceEntry[] | null>(null);
  const latestView = useRef(view);
  useEffect(() => {
    latestView.current = view;
  }, [view]);
  const commit = async (
    places: RoutePlaceEntry[],
    compute: (v: RouteVariant) => Promise<RouteVariant>,
  ) => {
    if (!view || !current || pending) return;
    setPending(places);
    try {
      const next = await compute(current);
      // Laid on the route as it is now, so edits made during the lookups survive.
      const base = latestView.current;
      if (!base || base.variants[activeVariant] !== current) return setProblem(STALE);
      saveEdited({
        ...base,
        variants: base.variants.map((v, i) => (i === activeVariant ? next : v)),
      });
    } finally {
      setPending(null);
    }
  };
  const ends = [view?.from.id ?? null, view?.to.id ?? null] as const;
  const commitOrder = (order: number[]) => {
    if (!current) return;
    commit(
      order.map((i) => current.places[i]),
      (v) => reorderRouteStages(v, order, ...ends),
    );
  };
  const move = (from: number, to: number) =>
    commitOrder(arrayMove(current?.places.map((_, i) => i) ?? [], from, to));
  const removeStop = (index: number) => {
    if (!current) return;
    const places = current.places.filter((_, i) => i !== index);
    commit(places, (v) => recomputeVariant({ ...v, places }, ...ends, index));
  };
  // A new stop at `index` (the end by default), its drive times looked up from there.
  const addStop = (
    place: Place,
    kind: RoutePlaceEntry['kind'] = 'waypoint',
    index = current?.places.length ?? 0,
  ) => {
    if (!current) return;
    const places = [...current.places];
    places.splice(index, 0, { kind, place, travel: { minutes: 0 } });
    commit(places, (v) => recomputeVariant({ ...v, places }, ...ends, index));
  };
  const shownPlaces = pending ?? current?.places;
  const arrivals = current
    ? arrivalMinutes({ places: shownPlaces ?? current.places, finalTravel: current.finalTravel })
    : { places: [], end: 0 };

  // Optimize proposes the shortest order, previewed on the map until it is
  // accepted or discarded, and good only for the variant it was made for.
  const [proposal, setProposal] = useState<{ order: number[]; variant: RouteVariant } | null>(null);
  const points = view && current ? variantPoints(view, current, coords) : [];
  const resolved = points.length > 0 && points.every((p) => p !== null);

  // A preview drives the variant it was started on over ten seconds, timed from its
  // stored drive times and stops, and ends when another route or variant is picked.
  const playback = usePlayback(10_000);
  const [preview, setPreview] = useState<{ reversed: boolean } | null>(null);
  const previewKey = `${selectedId}:${activeVariant}`;
  // Picking another route or variant ends the preview, in the same render.
  const [seenKey, setSeenKey] = useState(previewKey);
  if (seenKey !== previewKey) {
    setSeenKey(previewKey);
    setPreview(null);
    setProblem(null);
    playback.pause();
  }
  // What the handlers that await a lookup compare against when it returns: the
  // route and variant open now, and the routes as saved now.
  const latest = useRef({ key: previewKey, selected, routes });
  useEffect(() => {
    latest.current = { key: previewKey, selected, routes };
  }, [previewKey, selected, routes]);
  const previewReversed = preview?.reversed ?? false;
  // The example departure every clock time is worked from, and the variants switched
  // off the map. Neither is saved.
  const [departure, setDeparture] = useState(DEFAULT_EXAMPLE_DEPARTURE);
  // Kept by route as well as variant id: variant ids repeat from route to route.
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(new Set());
  const hidden = useMemo(
    () =>
      new Set(
        [...hiddenKeys]
          .filter((k) => k.startsWith(`${selectedId}:`))
          .map((k) => k.slice(`${selectedId}:`.length)),
      ),
    [hiddenKeys, selectedId],
  );
  const toggleHidden = (variantId: string) =>
    setHiddenKeys((now) => toggled(now, `${selectedId}:${variantId}`));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState(false);

  // A place clicked on the map: with a route open it offers to add it as a stop in the
  // best spot, until another route or variant is picked.
  const [picked, setPicked] = useState<{ key: string; place: Place; at: Coordinates } | null>(null);
  const [creating, setCreating] = useState(false);
  const placeClicked = async (id: string, at: Coordinates) => {
    let place: Place;
    try {
      const found = await fetchPlaceFields<{
        displayName?: { text?: string };
        timeZone?: { id?: string };
      }>(id, 'displayName,timeZone');
      place = pickedPlace({
        id,
        label: found.displayName?.text ?? 'Place',
        timeZone: found.timeZone?.id ?? null,
      });
    } catch {
      return setProblem("Couldn't look up that place.");
    }
    setPicked({ key: previewKey, place, at });
  };
  // A new route has one direct variant, from start to end, with its real drive time.
  const createRoute = async (from: Place, to: Place) => {
    const blank = { ...blankRouteVariant([]), label: 'Direct' };
    const made = await recomputeRouteTravel({
      _id: '',
      from: endpoint(from),
      to: endpoint(to),
      variants: [blank],
      images: [],
    });
    // The id is taken from the routes as they are after the lookups, so a route saved
    // meanwhile is not overwritten.
    const route = { ...made, _id: nextRouteId(latest.current.routes) };
    onSave(route);
    select(route._id);
  };
  const addPicked = (kind: RoutePlaceEntry['kind']) => {
    if (!picked || !view || !current) return;
    addStop(picked.place, kind, insertIndexFor(variantPoints(view, current, coords), picked.at));
    setPicked(null);
  };
  const pickedHere = picked?.key === previewKey ? picked : null;
  const previewVariant =
    preview && current && resolved ? (previewReversed ? reverseVariant(current) : current) : null;
  const previewSchedule = previewVariant ? previewSteps(previewVariant) : [];
  const minute = playback.progress * previewTotal(previewSchedule);
  const previewAt = previewVariant ? previewState(previewSchedule, minute) : null;
  const previewStop =
    previewAt?.stop != null && current
      ? previewReversed
        ? current.places.length - 1 - previewAt.stop
        : previewAt.stop
      : null;
  const clock = (minutes: number) => exampleClock(minutes, departure).toLowerCase();
  const previewCaption =
    previewVariant && previewAt && (view ?? selected)
      ? previewAt.stop != null
        ? `Stopped at ${placeName(previewVariant.places[previewAt.stop])} · ${routePlaceStopMinutes(previewVariant.places[previewAt.stop])} min`
        : `Driving to ${
            previewVariant.places[previewAt.leg]
              ? placeName(previewVariant.places[previewAt.leg])
              : previewReversed
                ? (view ?? selected)!.from.label
                : (view ?? selected)!.to.label
          }`
      : null;
  const startPreview = (reversed: boolean) => {
    setPreview({ reversed });
    playback.seek(0);
    playback.play();
  };
  const draft = proposal && proposal.variant === current ? proposal : null;
  const proposed = draft ? draftPoints(points as Coordinates[], draft.order) : null;
  const savedMiles = proposed
    ? Math.round(pathMiles(points as Coordinates[]) - pathMiles(proposed))
    : 0;
  const optimize = () => {
    if (!current || !resolved) return;
    const [from, ...rest] = points as Coordinates[];
    setProposal({
      order: optimizeOrder(from, rest[rest.length - 1], rest.slice(0, -1)),
      variant: current,
    });
  };

  // The assistant's tasks: each asks one question and gets back a route to review,
  // laid beside what it changes and accepted or discarded like Optimize's.
  const { data } = useTripData();
  const task = useRouteTask();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  // Which control asked, so the wait is shown beside it.
  const [asking, setAsking] = useState<'stops' | 'scenic' | 'plan'>('plan');
  const working = (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', ml: 1 }}>
      <CircularProgress size={14} />
      <Typography variant="caption">Asking the assistant…</Typography>
    </Stack>
  );
  const [planning, setPlanning] = useState<string | null>(null);
  const ask = async (
    question: string,
    tone: string,
    where: AiDraft['where'],
    base: Route | null = null,
    revisedId?: string,
  ) => {
    setAsking(where === 'stops' ? 'stops' : base ? 'scenic' : 'plan');
    const opened = latest.current;
    const moved = () =>
      latest.current.key !== opened.key || latest.current.selected !== opened.selected;
    const proposal = await task.run(question);
    if (!proposal || !data) return;
    if (moved()) return setProblem(STALE);
    const resolved = resolveRouteProposal(proposal, data, {
      addOnly: !revisedId && base !== null,
    });
    if ('error' in resolved) return task.setError(resolved.error);
    // A route planned for a drive has to connect that drive's two places.
    if (drive && !routeForDrive([resolved.route], drive)) {
      return task.setError(`That route doesn't connect ${routeLabel(drive)}.`);
    }
    const route = await recomputeRouteTravel(resolved.route);
    if (moved()) return setProblem(STALE);
    setAiDraft({
      base,
      variant: activeVariant,
      route,
      isNew: resolved.isNew,
      summary: proposal.summary,
      variantId: draftVariantId(route, base, tone, revisedId),
      where,
    });
  };
  const suggest = (kind: RouteTask) => {
    setMenu(null);
    const stored = selected?.variants[activeVariant];
    if (selected && stored) {
      const scenic = kind === 'scenic';
      ask(
        routeTaskQuestion(kind, selected, stored),
        scenic ? 'scenic' : stored.tone,
        scenic ? 'top' : 'stops',
        selected,
        scenic ? undefined : stored.id,
      );
    }
  };
  const aiShown =
    aiDraft &&
    (aiDraft.base === null ||
      (aiDraft.base === selected && (aiDraft.where === 'top' || aiDraft.variant === activeVariant)))
      ? aiDraft
      : null;
  const aiVariant = aiShown?.route.variants.find((v) => v.id === aiShown.variantId);
  const aiGhost =
    aiShown && aiVariant
      ? variantPoints(aiShown.route, aiVariant, coords).filter((p): p is Coordinates => p !== null)
      : null;
  // Without a place id at both ends the drive times can't be looked up, and the totals would be wrong.
  const aiUnresolved = aiShown && (aiShown.route.from.id === null || aiShown.route.to.id === null);
  const aiCard = aiShown && (
    <DraftCard
      busy={pending !== null}
      title={aiShown.summary}
      summary={
        aiUnresolved
          ? "Drive times can't be worked out until this route's start and end are places Google knows. Resolve them in Edit route first."
          : `${aiShown.isNew ? 'New route' : 'Edit route'}: ${aiShown.route.variants
              .map((v) => `${v.tone} ${formatMinutes(variantSummary(v).minutes)}`)
              .join(' · ')}`
      }
      onAccept={
        aiUnresolved
          ? undefined
          : () => {
              // through the same checks as every other way of saving a route
              const accepted = structuredClone(aiShown.route);
              const message = applyRouteForm(accepted, aiShown.route);
              if (message) return task.setError(message);
              onSave(accepted);
              select(
                aiShown.route._id,
                Math.max(
                  0,
                  aiShown.route.variants.findIndex((v) => v.id === aiShown.variantId),
                ),
              );
              setAiDraft(null);
            }
      }
      onDiscard={() => setAiDraft(null)}
    />
  );

  // A search looks at every route, wherever the map is. Otherwise a route whose
  // places haven't resolved yet has no box to test, so it stays listed rather
  // than blinking out until its coordinates arrive.
  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return shown
      .filter((r) => !needle || routeLabel(r).toLowerCase().includes(needle))
      .filter((r) => matchesFilters(r, filters, coords))
      .filter((r) => {
        const box = boundsOf(routePoints(r, coords));
        const searching = needle || filters.size > 0;
        return searching || r._id === selectedId || !bounds || !box || boundsOverlap(box, bounds);
      })
      .sort((a, b) => routeLabel(a).localeCompare(routeLabel(b)));
  }, [shown, query, filters, bounds, coords, selectedId]);
  // The routes whose roads are drawn faintly behind the selected one: those in the list.
  const backdrop = useMemo(() => new Set(listed.map((r) => r._id)), [listed]);
  // Worked out once per list, not on every frame of a preview.
  const rowInfo = useMemo(
    () =>
      new Map(
        listed.map((r) => [
          r._id,
          {
            time: routeTimeRange(r),
            miles: routeMilesRange(r),
            doubles: routeDoublesBack(r, coords),
          },
        ]),
      ),
    [listed, coords],
  );

  return (
    <>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <Typography variant="h6" sx={{ flex: 1 }}>
          {drive ? `Route for ${routeLabel(drive)}` : 'Route planner'}
        </Typography>
        {drive ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="contained"
              disabled={!selected || !current}
              onClick={() => {
                if (!selected || !current) return;
                drive.onUse(selected, current.id);
                onClose();
              }}
            >
              Use variant
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )}
      </Stack>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: drive ? '1fr 420px' : '300px 1fr 420px' },
          gridTemplateRows: { xs: '360px auto auto', md: '1fr' },
          overflow: { xs: 'auto', md: 'hidden' },
        }}
      >
        <Stack
          sx={{
            order: { xs: 3, md: 1 },
            display: drive ? 'none' : undefined,
            minHeight: 0,
            borderRight: { md: 1 },
            borderColor: 'divider',
          }}
        >
          <TextField
            placeholder="Search routes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            size="small"
            sx={{ m: 1.5, '& .MuiOutlinedInput-root': { borderRadius: 8 } }}
            slotProps={{
              htmlInput: { 'aria-label': 'Search routes' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title="Filter routes">
                      <IconButton
                        size="small"
                        edge="end"
                        aria-label="Filter routes"
                        color={filters.size > 0 ? 'primary' : 'default'}
                        onClick={(e) => setFilterAnchor(e.currentTarget)}
                      >
                        <Badge badgeContent={filters.size} color="primary">
                          <FilterListIcon fontSize="small" />
                        </Badge>
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Menu
            anchorEl={filterAnchor}
            open={filterAnchor !== null}
            onClose={() => setFilterAnchor(null)}
          >
            {ROUTE_FILTERS.map(({ id, label, tip }) => (
              <Tooltip key={id} title={tip} placement="right">
                <MenuItem dense onClick={() => setFilters((now) => toggled(now, id))}>
                  <Checkbox size="small" edge="start" checked={filters.has(id)} disableRipple />
                  <ListItemText primary={label} />
                </MenuItem>
              </Tooltip>
            ))}
          </Menu>
          <List disablePadding sx={{ flex: 1, overflow: 'auto', px: 1 }}>
            {listed.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1 }}>
                {query.trim() || filters.size > 0 ? 'No routes match.' : 'No routes in view.'}
              </Typography>
            )}
            {listed.map((route) => {
              const info = rowInfo.get(route._id);
              const isSelected = route._id === selectedId;
              return (
                <ListItem key={route._id} disablePadding sx={{ display: 'block', mb: 0.5 }}>
                  <ListItemButton
                    selected={isSelected}
                    onClick={() => select(route._id)}
                    sx={{
                      borderRadius: 2,
                      display: 'block',
                      py: 1,
                      '&.Mui-selected': { bgcolor: (t) => alpha(t.palette.primary.main, 0.22) },
                    }}
                  >
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
                      <Typography variant="body1" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
                        {routeLabel(route)}
                      </Typography>
                      {needsPlaces(route) && <WarningBadge title="No places on any variant" />}
                      {info?.doubles && <WarningBadge title="Doubles back" />}
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {info?.miles}
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ alignItems: 'center', mt: 0.5 }}>
                      {route.variants.map((v, i) => (
                        <Tooltip key={v.id} title={v.label || 'Untitled'}>
                          <ButtonBase
                            component="span"
                            aria-label={v.label || 'Untitled'}
                            onClick={(e) => {
                              e.stopPropagation();
                              select(route._id, i);
                            }}
                            sx={{
                              p: 0.5,
                              mr: 0.5,
                              borderRadius: 1,
                              bgcolor:
                                isSelected && i === activeVariant ? 'action.selected' : undefined,
                            }}
                          >
                            <LineSwatch index={variantColorIndex(route.variants, i)} />
                          </ButtonBase>
                        </Tooltip>
                      ))}
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                        {info?.time}
                      </Typography>
                    </Stack>
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
          {task.busy && asking === 'plan' && <Box sx={{ mx: 1.5, mb: 1 }}>{working}</Box>}
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              px: 1.5,
              py: 1,
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Button
              startIcon={<AddIcon />}
              onClick={() =>
                hasGoogleApiKey()
                  ? setCreating(true)
                  : setEditing({
                      _id: nextRouteId(routes),
                      from: { id: null, label: '' },
                      to: { id: null, label: '' },
                      variants: [],
                      images: [],
                    })
              }
            >
              Route
            </Button>
            <Tooltip title="Plan routes with the assistant">
              <span>
                <IconButton
                  aria-label="Plan with AI"
                  disabled={task.busy}
                  onClick={() => setPlanning('')}
                >
                  <AutoAwesomeIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        <Box sx={{ order: { xs: 1, md: 2 }, minHeight: 0, position: 'relative' }}>
          {hasGoogleApiKey() ? (
            <APIProvider apiKey={getGoogleApiKey()}>
              <RoutePlannerMap
                routes={mapRoutes}
                coords={coords}
                selectedId={selectedId}
                activeVariant={activeVariant}
                // the list holds still while a preview moves the camera
                onBounds={previewVariant ? ignoreBounds : setBounds}
                onSelectRoute={select}
                onSelectVariant={setVariant}
                ghost={aiGhost && aiGhost.length > 1 ? aiGhost : savedMiles > 0 ? proposed : null}
                preview={
                  previewAt
                    ? {
                        leg: previewAt.leg,
                        fraction: previewAt.fraction,
                        reversed: previewReversed,
                      }
                    : null
                }
                onPlaceClick={placeClicked}
                hidden={hidden}
                backdrop={backdrop}
                activeStop={pending ? null : previewStop}
              />
            </APIProvider>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              Add a Google API key in Settings to show the map.
            </Typography>
          )}
          {selected && current && !previewVariant && (
            <Box
              sx={{
                position: 'absolute',
                left: 12,
                bottom: 32,
                display: 'flex',
                gap: 1,
                zIndex: 2,
              }}
            >
              <Tooltip title={resolved ? '' : PREVIEW_NEEDS_PLACES}>
                <span>
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<PlayArrowIcon />}
                    disabled={!resolved}
                    onClick={() => startPreview(false)}
                    sx={{ borderRadius: 8, px: 3, boxShadow: 4 }}
                  >
                    Preview route
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title="Preview in reverse. The saved route is not changed.">
                <span>
                  <IconButton
                    aria-label="Preview in reverse"
                    disabled={!resolved}
                    onClick={() => startPreview(true)}
                    sx={{
                      border: 2,
                      borderStyle: 'solid',
                      borderColor: 'primary.main',
                      bgcolor: 'background.paper',
                      boxShadow: 4,
                    }}
                  >
                    <SwapHorizIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          )}
          {previewVariant && (
            <Box sx={{ position: 'absolute', left: 12, right: 72, bottom: 32, zIndex: 2 }}>
              <PreviewBar
                caption={previewCaption}
                playing={playback.playing}
                progress={playback.progress}
                clock={clock(minute)}
                reversed={previewReversed}
                onPlay={playback.play}
                onPause={playback.pause}
                onSeek={playback.seek}
                onReverse={() => startPreview(!previewReversed)}
                onClose={() => {
                  playback.pause();
                  setPreview(null);
                }}
              />
            </Box>
          )}
          {pickedHere && current && (
            <Paper
              elevation={3}
              sx={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 2,
                p: 1,
                display: 'flex',
                gap: 1,
                alignItems: 'center',
              }}
            >
              <Typography variant="body2">{pickedHere.place.label}</Typography>
              <Button
                size="small"
                disabled={pending !== null}
                onClick={() => addPicked('waypoint')}
              >
                Add waypoint
              </Button>
              <Button
                size="small"
                disabled={pending !== null || current.tone === DEFAULT_ROUTE_TONE}
                onClick={() => addPicked('via')}
              >
                Add via
              </Button>
              <IconButton size="small" aria-label="Dismiss" onClick={() => setPicked(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Paper>
          )}
        </Box>

        <Stack
          spacing={1}
          sx={{
            order: { xs: 2, md: 3 },
            minHeight: 0,
            overflow: 'auto',
            p: 2,
            borderLeft: { md: 1 },
            borderColor: 'divider',
          }}
        >
          {task.error && (
            <Alert severity="error" onClose={() => task.setError(null)}>
              {task.error}
            </Alert>
          )}
          {aiShown?.where === 'top' && aiCard}
          {selected ? (
            <>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <Typography variant="h6" sx={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
                  {routeLabel(view ?? selected)}
                </Typography>
                <Tooltip title={resolved ? '' : PREVIEW_NEEDS_PLACES}>
                  <span>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<PlayArrowIcon />}
                      disabled={!resolved}
                      onClick={() => startPreview(false)}
                      sx={{ borderRadius: 8 }}
                    >
                      Preview
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title="Reverse route. This changes the saved route.">
                  <span>
                    <IconButton
                      aria-label="Reverse route"
                      disabled={pending !== null}
                      onClick={() => onSave(reverseRoute(selected))}
                    >
                      <SwapHorizIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Edit the start, the end and the images">
                  <IconButton aria-label="Edit route" onClick={() => setEditing(selected)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete route">
                  <IconButton aria-label="Delete route" onClick={() => setConfirmDelete(true)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              {flip && (
                <Tooltip title="The saved route runs the other way and isn't changed.">
                  <Chip
                    size="small"
                    icon={<SwapHorizIcon />}
                    label="Driven in reverse"
                    sx={{ alignSelf: 'flex-start' }}
                  />
                </Tooltip>
              )}
              <Tooltip title="Example times only. They are never saved.">
                <Box sx={{ width: 200, mt: 1 }}>
                  <TimeStringField
                    label="Example departure"
                    value={toTimeInput(departure)}
                    onChange={(v) => setDeparture((v ? fromTimeInput(v) : null) ?? departure)}
                  />
                </Box>
              </Tooltip>
              <VariantCards
                route={view ?? selected}
                active={activeVariant}
                coords={coords}
                departure={departure}
                hidden={hidden}
                busy={task.busy || pending !== null}
                onSelect={setVariant}
                onToggleHidden={toggleHidden}
                onAdd={addVariant}
                onSuggestScenic={() => suggest('scenic')}
              />
              {task.busy && asking === 'scenic' && working}
              {current && (
                <Paper variant="outlined" sx={{ p: 1.5, borderWidth: 2, borderColor: activeColor }}>
                  <Stack spacing={1.5}>
                    <VariantEditor
                      variant={current}
                      color={activeColor}
                      directElsewhere={(view ?? selected).variants.some(
                        (v, i) => i !== activeVariant && v.tone === DEFAULT_ROUTE_TONE,
                      )}
                      onlyVariant={(view ?? selected).variants.length < 2}
                      disabled={pending !== null}
                      onChange={editVariant}
                      onRemove={() => setConfirmRemoval(true)}
                    />
                    {problem && (
                      <Alert severity="error" onClose={() => setProblem(null)}>
                        {problem}
                      </Alert>
                    )}
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
                        Stops
                      </Typography>
                      {task.busy && asking === 'stops' && working}
                      <Tooltip title="Ask the assistant for stops">
                        <span>
                          <IconButton
                            size="small"
                            aria-label="Suggest stops"
                            disabled={task.busy || pending !== null}
                            onClick={(e) => setMenu(e.currentTarget)}
                          >
                            <AutoAwesomeIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Reorder the stops to make the drive shorter">
                        <span>
                          <IconButton
                            size="small"
                            aria-label="Optimize order"
                            disabled={!resolved || current.places.length < 2 || pending !== null}
                            onClick={optimize}
                          >
                            <AutoFixHighIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
                        <MenuItem onClick={() => suggest('waypoints')}>Suggest waypoints</MenuItem>
                        <MenuItem
                          disabled={current.tone === DEFAULT_ROUTE_TONE}
                          onClick={() => suggest('vias')}
                        >
                          Suggest vias
                        </MenuItem>
                      </Menu>
                    </Stack>
                    {aiShown?.where === 'stops' && aiCard}
                    {draft && (
                      <DraftCard
                        busy={pending !== null}
                        title="Optimized order"
                        summary={
                          savedMiles > 0
                            ? `About ${savedMiles} mi shorter as the crow flies`
                            : 'This is already the shortest order.'
                        }
                        onAccept={
                          savedMiles > 0
                            ? () => {
                                commitOrder(draft.order);
                                setProposal(null);
                              }
                            : undefined
                        }
                        onDiscard={() => setProposal(null)}
                      />
                    )}
                    <StopList
                      places={shownPlaces ?? current.places}
                      from={(view ?? selected).from.label}
                      to={(view ?? selected).to.label}
                      finalTravel={current.finalTravel}
                      backs={pending ? [] : backs}
                      clocks={{
                        start: clock(0),
                        places: arrivals.places.map(clock),
                        end: clock(arrivals.end),
                      }}
                      disabled={pending !== null}
                      viaAllowed={current.tone !== DEFAULT_ROUTE_TONE}
                      activeStop={pending ? null : previewStop}
                      color={activeColor}
                      onMove={move}
                      onEdit={editStop}
                      onRemove={removeStop}
                      onAdd={addStop}
                    />
                  </Stack>
                </Paper>
              )}
            </>
          ) : drive && shown.length === 0 ? (
            <>
              <Typography variant="body2" color="text.secondary">
                No route between these places yet.
              </Typography>
              <Button
                variant="outlined"
                onClick={() =>
                  setEditing({
                    _id: nextRouteId(routes),
                    from: endpoint(drive.from),
                    to: endpoint(drive.to),
                    variants: [],
                    images: [],
                  })
                }
              >
                Create route
              </Button>
              <Button
                variant="outlined"
                startIcon={<AutoAwesomeIcon />}
                disabled={task.busy}
                onClick={() =>
                  ask(
                    planRouteQuestion(
                      `a direct and a scenic route from ${drive.from.label} to ${drive.to.label}`,
                    ),
                    'direct',
                    'top',
                  )
                }
              >
                Plan with AI
              </Button>
              {task.busy && asking === 'plan' && working}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Select a route in the list or on the map.
            </Typography>
          )}
        </Stack>
      </Box>
      <Dialog open={planning !== null} onClose={() => setPlanning(null)} fullWidth maxWidth="sm">
        <DialogTitle>Plan routes</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            multiline
            minRows={3}
            fullWidth
            margin="dense"
            placeholder="Plan a direct and two scenic routes from Anchorage to Talkeetna"
            value={planning ?? ''}
            onChange={(e) => setPlanning(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlanning(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!planning?.trim()}
            onClick={() => {
              const request = planning ?? '';
              setPlanning(null);
              ask(planRouteQuestion(request), 'direct', 'top');
            }}
          >
            Plan
          </Button>
        </DialogActions>
      </Dialog>
      <NewRouteDialog open={creating} onClose={() => setCreating(false)} onCreate={createRoute} />
      <Dialog open={confirmRemoval} onClose={() => setConfirmRemoval(false)}>
        <DialogTitle>Remove this variant?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This removes the variant and all its stops from the route. A drive that follows it goes
            back to the direct variant.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemoval(false)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              setConfirmRemoval(false);
              removeVariant();
            }}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete this route?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This can't be undone from the app. It removes the route entirely, including all its
            variants.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => {
              setConfirmDelete(false);
              if (selected) {
                onDelete(selected._id);
                setSelectedId(null);
              }
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
      {editing && (
        <RouteEditDialog
          route={editing}
          isNew={!routes.some((r) => r._id === editing._id)}
          onClose={() => setEditing(null)}
          onSave={(route) => {
            onSave(route);
            setEditing(null);
            select(route._id, route._id === selectedId ? variant : 0);
          }}
          onDelete={(id) => {
            onDelete(id);
            setEditing(null);
            if (id === selectedId) setSelectedId(null);
          }}
        />
      )}
    </>
  );
}
