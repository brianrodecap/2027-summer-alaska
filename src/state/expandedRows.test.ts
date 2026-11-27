import { describe, expect, it } from 'vitest';

import { cardId, createExpandedRows } from './expandedRows';

describe('which cards are open', () => {
  it('toggles one card without touching the others, telling subscribers', () => {
    const rows = createExpandedRows();
    let told = 0;
    const stop = rows.subscribe(() => told++);
    rows.toggle('a');
    rows.toggle('b');
    rows.toggle('a');
    expect([rows.isOpen('a'), rows.isOpen('b'), told]).toEqual([false, true, 3]);
    stop();
    rows.toggle('b');
    expect(told).toBe(3);
  });

  it('opens a card already open without telling anyone', () => {
    const rows = createExpandedRows();
    rows.open('a');
    let told = 0;
    rows.subscribe(() => told++);
    rows.open('a');
    expect([rows.isOpen('a'), told]).toEqual([true, 0]);
  });

  it("tells one stay's morning cards apart by day", () => {
    expect(cardId('2027-06-02', 'stay:s:morning')).not.toBe(cardId('2027-06-03', 'stay:s:morning'));
  });
});
