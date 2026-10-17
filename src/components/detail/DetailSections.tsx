import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import { priceLineLabel } from '../../model/bookingDetails';
import {
  packageCostLabel,
  PLAN_STATUS_LABEL,
  portCallsInOrder,
  portCallWhenLabel,
} from '../../model/entityDetails';
import { todayDateStr } from '../../model/tripModel';
import type { Package, PlanStatus, PortCall, ResolvedRouteInfo } from '../../model/types';
import { useTravelerNames } from '../../state/useTravelerNames';
import { BookingStatusChip } from '../shared/BookingChip';
import { renderMaterialIcon } from '../shared/materialIcon';
import { TravelerChips } from '../shared/TravelerChips';

// The overline-headed block every detail-sheet section uses ("Seats",
// "Packages", "Port calls"), so they all sit the same way.
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

// The entity's own plan status ("Planning", "Completed"), apart from its
// booking's status on the chip.
export function StatusLine({ status }: { status: PlanStatus }) {
  return (
    <Typography variant="body2" color="text.secondary">
      Status: {PLAN_STATUS_LABEL[status]}
    </Typography>
  );
}

// Names as chips, or "Whole party" when everyone is meant (no names — null or
// an empty list, both the whole party to the budget).
function TravelerRow({ names }: { names: string[] | null }) {
  return names?.length ? (
    <TravelerChips names={names} />
  ) : (
    <Typography variant="body2" color="text.secondary">
      Whole party
    </Typography>
  );
}

// Who's on it. Pass wholePartyWhenNull only where travelers: null means the
// whole party (a Transit); elsewhere null means nobody was named.
export function TravelersSection({
  names,
  wholePartyWhenNull = false,
}: {
  names: string[] | null | undefined;
  wholePartyWhenNull?: boolean;
}) {
  if (names == null ? !wholePartyWhenNull : !names.length) return null;
  return (
    <DetailSection title="Travelers">
      <TravelerRow names={names ?? null} />
    </DetailSection>
  );
}

// Each Package its holder carries: name and status, cost (a nightly rate's
// total over the holding Stay's `nights`), confirmation number, payment state, who it's for,
// and its benefits. `date` is the holder's start day, for an at-the-property
// payment.
export function PackagesSection({
  packages,
  nights = null,
  date,
}: {
  packages: Package[] | null | undefined;
  nights?: number | null;
  date: string | null;
}) {
  const names = useTravelerNames();
  if (!packages?.length) return null;
  const today = todayDateStr();
  return (
    <DetailSection title="Packages">
      <Stack spacing={1}>
        {packages.map((pkg) => {
          const facts = [
            packageCostLabel(pkg, nights),
            pkg.confirmationNumber && `Conf# ${pkg.confirmationNumber}`,
            pkg.cost && priceLineLabel(pkg.payable, pkg, date, today),
          ].filter(Boolean);
          return (
            <Stack
              key={pkg._id}
              spacing={0.75}
              sx={{ bgcolor: 'surfaceContainer.high', borderRadius: 2, px: 2, py: 1.5 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                  {pkg.name}
                </Typography>
                <BookingStatusChip status={pkg.status} />
              </Box>
              {facts.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {facts.join(' · ')}
                </Typography>
              )}
              <TravelerRow names={pkg.travelers?.map((id) => names.get(id) ?? id) ?? null} />
              {pkg.benefits?.length ? (
                <Box component="ul" sx={{ pl: 2, m: 0 }}>
                  {pkg.benefits.map((b) => (
                    <Typography component="li" variant="body2" key={b}>
                      {b}
                    </Typography>
                  ))}
                </Box>
              ) : null}
            </Stack>
          );
        })}
      </Stack>
    </DetailSection>
  );
}

// A cruise Stay's port calls, in sailing order: scenic cruising or a port,
// its day and hours.
export function PortCallsSection({ calls }: { calls: PortCall[] | null | undefined }) {
  const ordered = portCallsInOrder(calls);
  if (!ordered.length) return null;
  return (
    <DetailSection title="Port calls">
      <Stack spacing={1}>
        {ordered.map((call, i) => (
          <Box
            key={`${i}-${call.place.label}-${call.arrivesAt}-${call.departsAt}`}
            sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}
          >
            {renderMaterialIcon(call.kind === 'scenic' ? 'landscape' : 'anchor', {
              color: 'primary',
              fontSize: 'small',
            })}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2">{call.place.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {portCallWhenLabel(call)}
                {call.kind === 'scenic' ? ' · scenic cruising' : ''}
              </Typography>
            </Box>
          </Box>
        ))}
      </Stack>
    </DetailSection>
  );
}

// A routed drive's stops on its selected variant, in driving order.
export function RouteStopsSection({ routeInfo }: { routeInfo: ResolvedRouteInfo | null }) {
  const variant = routeInfo?.variants.find((v) => v.tone === routeInfo.selectedTone);
  if (!variant?.stages.length) return null;
  return (
    <DetailSection title={`Route stops · ${variant.label}`}>
      <Box component="ol" sx={{ pl: 2.5, m: 0 }}>
        {variant.stages.map((stage) => (
          <Typography component="li" variant="body2" key={stage.key}>
            {stage.place.label}
            <Typography component="span" variant="caption" color="text.secondary">
              {stage.kind === 'via' ? ' · via' : ''}
              {stage.note ? ` · ${stage.note}` : ''}
            </Typography>
          </Typography>
        ))}
      </Box>
    </DetailSection>
  );
}
