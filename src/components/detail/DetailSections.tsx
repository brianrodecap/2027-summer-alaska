import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import { priceLineLabel } from '../../model/bookingDetails';
import { cardTravelers, travelerName } from '../../model/cardTravelers';
import {
  packageCostLabel,
  portCallIcon,
  portCallsInOrder,
  portCallWhenLabel,
} from '../../model/entityDetails';
import { dotted } from '../../model/formatting';
import { todayDateStr } from '../../model/tripModel';
import type { Package, PortCall, ResolvedRouteInfo } from '../../model/types';
import { useTravelerNames } from '../../state/useTravelerNames';
import { BookingStatusChip } from '../shared/BookingChip';
import { renderMaterialIcon } from '../shared/materialIcon';
import { TravelerList } from './CardParts';

// The overline-headed block an expanded card's sections use ("Flight status",
// "Packages", "Port calls"), so they all sit the same way.
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={0.5} sx={{ mt: 1.5 }}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      {children}
    </Stack>
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
          const facts = dotted([
            packageCostLabel(pkg, nights),
            pkg.confirmationNumber && `Conf# ${pkg.confirmationNumber}`,
            pkg.cost && priceLineLabel(pkg.payable, pkg, date, today),
          ]);
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
              {facts && (
                <Typography variant="body2" color="text.secondary">
                  {facts}
                </Typography>
              )}
              <TravelerList
                travelers={cardTravelers({
                  going: pkg.travelers?.map((id) => travelerName(names, id)),
                  names,
                })}
              />
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
            {renderMaterialIcon(portCallIcon(call.kind), {
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

// The notes written on a routed drive's stops, on its selected variant. The stops
// themselves are rows of the day.
export function RouteNotesSection({ routeInfo }: { routeInfo: ResolvedRouteInfo | null }) {
  const variant = routeInfo?.variants.find((v) => v.id === routeInfo.selectedId);
  const noted = variant?.stages.filter((stage) => stage.note) ?? [];
  if (!variant || !noted.length) return null;
  return (
    <DetailSection title={`Route notes · ${variant.label}`}>
      <Box component="ul" sx={{ pl: 2.5, m: 0 }}>
        {noted.map((stage, i) => (
          <Typography component="li" variant="body2" key={`${i}:${stage.key}`}>
            {stage.place.label}
            <Typography component="span" variant="caption" color="text.secondary">
              {' · '}
              {stage.note}
            </Typography>
          </Typography>
        ))}
      </Box>
    </DetailSection>
  );
}
