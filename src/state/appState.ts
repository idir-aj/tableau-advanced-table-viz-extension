export type SortDirection = 'desc' | 'asc';

export type SortState = {
  columnId: string;
  direction: SortDirection;
};

export type AppState = {
  latestData: any[];
  columns: any[];
  columnWidths: Record<string, number>;
  expandedHierarchyIds: Set<string>;
  columnFilters: Record<string, { text?: string; min?: number; max?: number }>;
  sortState: SortState | null;
};

export function createAppState(): AppState {
  return {
    latestData: [],
    columns: [],
    columnWidths: {},
    expandedHierarchyIds: new Set<string>(),
    columnFilters: {},
    sortState: null
  };
}

export function applyStatePatch<T extends Partial<AppState>>(state: AppState, patch: T): AppState {
  return {
    ...state,
    ...patch,
    expandedHierarchyIds: patch.expandedHierarchyIds ?? new Set(state.expandedHierarchyIds)
  };
}
