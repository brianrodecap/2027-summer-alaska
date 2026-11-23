import type { DayKind } from '../../../model/dayKind';

export type SceneName =
  'drive' | 'flight' | 'split' | 'sea' | 'port' | 'tundra' | 'river' | 'cabin' | 'town' | 'whale';

// The scene a kind of day opens with.
export const SCENE_FOR_KIND: Record<DayKind, SceneName> = {
  drive: 'drive',
  flight: 'flight',
  scenario: 'split',
  sea: 'sea',
  port: 'port',
  stay: 'cabin',
};
