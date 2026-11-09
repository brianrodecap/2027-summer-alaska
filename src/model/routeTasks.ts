import type { AskAIConversation } from './askAI';
import type { ProposedRoute } from './askAIDrafts';
import { transitRouteLabel } from './tripModel';
import type { Route, RouteVariant } from './types';

// What the route planner asks the assistant for. Each is one focused question,
// answered through the same propose_route tool (and place checks) as the chat.
export type RouteTask = 'waypoints' | 'vias' | 'scenic';

const RULES =
  'A route holds only waypoints (real stops worth calling out) and vias (points that steer the drive onto the right road). A waypoint is one specific spot on the road: a junction, pass, bridge, viewpoint, visitor center, tourist attraction or historical marker. Never a whole town or city, which is too general, and never a restaurant, lodging, shop or other business, a meal or an activity. Search for every place first and use the placeId it returns. Make the change with propose_route.';

export function routeTaskQuestion(task: RouteTask, route: Route, variant: RouteVariant): string {
  const of = `the route ${transitRouteLabel(route)} (id ${route._id})`;
  // Without ids at both ends, drive times can't be worked out, so the answer fixes them too.
  const ends =
    route.from.id && route.to.id
      ? ''
      : ' Its start and end are not resolved places yet: also give from and to, each with the placeId from search_places.';
  const keep = `Keep its current places, add yours in the order a drive from ${route.from.label} to ${route.to.label} meets them, and give only that variant.${ends}`;
  switch (task) {
    case 'waypoints':
      return `Suggest up to three waypoints for the ${variant.tone} variant "${variant.label}" of ${of}: real stops along the way. ${keep} ${RULES}`;
    case 'vias':
      return `Suggest vias for the ${variant.tone} variant "${variant.label}" of ${of} that steer it onto the road it should follow, only where the drive needs them. ${keep} ${RULES}`;
    case 'scenic':
      return `Suggest a scenic variant for ${of}, beside the variants it has: tone "scenic", a label naming its road, and the waypoints and vias that make it. Give only that variant. ${RULES}`;
  }
}

export const planRouteQuestion = (request: string): string =>
  `Plan a route: ${request.trim()} Propose a new route with a "direct" variant (no vias) and a "scenic" variant for each scenic option asked for. ${RULES}`;

// The route the assistant proposed in its answer, the last if it made several.
export function routeProposalOf(conversation: AskAIConversation): ProposedRoute | null {
  const proposals = conversation.messages[conversation.messages.length - 1]?.proposals ?? [];
  for (const p of [...proposals].reverse()) if (p.type === 'route') return p.route;
  return null;
}
