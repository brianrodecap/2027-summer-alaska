import { describe, expect, it } from 'vitest';

import type { AskAIConversation, AskAIProposal } from './askAI';
import type { ProposedRoute } from './askAIDrafts';
import { planRouteQuestion, routeProposalOf, routeTaskQuestion } from './routeTasks';
import type { Route, RouteVariant } from './types';

const route = {
  _id: 'route_a',
  from: { id: 'a', label: 'Anchorage' },
  to: { id: 'b', label: 'Seward' },
  variants: [],
  images: [],
} as unknown as Route;
const variant = {
  id: 'scenic',
  tone: 'scenic',
  label: 'Via Hope',
  places: [],
  finalTravel: { minutes: 0 },
} as RouteVariant;

describe('routeTaskQuestion', () => {
  it.each(['waypoints', 'vias', 'scenic'] as const)(
    'for %s names the route and its id, and keeps to waypoints and vias',
    (task) => {
      const q = routeTaskQuestion(task, route, variant);
      expect(q).toContain('Anchorage → Seward');
      expect(q).toContain('route_a');
      expect(q).toContain('propose_route');
      expect(q).toContain('one specific spot on the road');
      expect(q).toContain('tourist attraction or historical marker');
      expect(q).toContain('Never a whole town or city');
      expect(q).toContain('a meal or an activity');
      expect(q).toContain('use the placeId it returns');
    },
  );
  it('asks about the variant being edited, but for a scenic one asks for a new variant', () => {
    expect(routeTaskQuestion('waypoints', route, variant)).toContain('variant "Via Hope"');
    expect(routeTaskQuestion('waypoints', route, variant)).toContain(
      'a drive from Anchorage to Seward meets them',
    );
    expect(routeTaskQuestion('vias', route, variant)).toContain('steer it onto the road');
    expect(routeTaskQuestion('scenic', route, variant)).toContain('tone "scenic"');
  });
});

describe('a route with unresolved ends', () => {
  it('asks for them to be resolved too, unless both already are', () => {
    const open = { ...route, from: { id: null, label: 'Fairbanks' } } as Route;
    expect(routeTaskQuestion('waypoints', open, variant)).toContain(
      'also give from and to, each with the placeId from search_places',
    );
    expect(routeTaskQuestion('waypoints', route, variant)).not.toContain('also give from and to');
  });
});

describe('planRouteQuestion', () => {
  it('passes the request on, trimmed, with the same rules', () => {
    const q = planRouteQuestion('  a direct and two scenic routes from A to B  ');
    expect(q).toContain('Plan a route: a direct and two scenic routes from A to B Propose');
    expect(q).toContain('Never a whole town or city');
    expect(q).toContain('a meal or an activity');
  });
});

describe('routeProposalOf', () => {
  const proposed = (summary: string): ProposedRoute => ({ summary }) as ProposedRoute;
  const conversation = (...lists: AskAIProposal[][]) =>
    ({
      messages: lists.map((proposals) => ({ role: 'assistant', text: '', proposals })),
    }) as unknown as AskAIConversation;
  const routeOf = (id: string, summary: string): AskAIProposal => ({
    id,
    type: 'route',
    route: proposed(summary),
  });

  it('takes the last route proposal of the last message', () => {
    expect(
      routeProposalOf(conversation([routeOf('1', 'first'), routeOf('2', 'second')]))?.summary,
    ).toBe('second');
  });
  it('ignores other kinds of proposal and earlier messages', () => {
    const edit = { id: '3', type: 'edit', edit: {} } as unknown as AskAIProposal;
    expect(routeProposalOf(conversation([routeOf('1', 'old')], [edit]))).toBeNull();
  });
  it('finds the route among proposals of other kinds', () => {
    const note = { id: '4', type: 'note', note: {} } as unknown as AskAIProposal;
    const plan = { id: '5', type: 'dayPlan', plan: {} } as unknown as AskAIProposal;
    expect(routeProposalOf(conversation([routeOf('1', 'mine'), note, plan]))?.summary).toBe('mine');
  });
  it('is null when there is no message or no proposal', () => {
    expect(routeProposalOf(conversation())).toBeNull();
    expect(routeProposalOf(conversation([]))).toBeNull();
  });
});
