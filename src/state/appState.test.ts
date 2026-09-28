import { describe, expect, it } from 'vitest';
import { applyStatePatch, createAppState } from './appState';

describe('appState', () => {
  it('creates a valid initial state', () => {
    const state = createAppState();

    expect(state.latestData).toEqual([]);
    expect(state.columns).toEqual([]);
    expect(state.columnWidths).toEqual({});
    expect(state.columnFilters).toEqual({});
    expect(state.sortState).toBeNull();
    expect(state.expandedHierarchyIds).toBeInstanceOf(Set);
  });

  it('applies a partial patch without mutating the original object', () => {
    const base = createAppState();
    const next = applyStatePatch(base, {
      latestData: [{ id: 'row-1' }],
      columnWidths: { colA: 180 },
      sortState: { columnId: 'colA', direction: 'asc' }
    });

    expect(base.latestData).toEqual([]);
    expect(base.columnWidths).toEqual({});
    expect(base.sortState).toBeNull();
    expect(next.latestData).toHaveLength(1);
    expect(next.columnWidths).toEqual({ colA: 180 });
    expect(next.sortState).toEqual({ columnId: 'colA', direction: 'asc' });
  });
});
