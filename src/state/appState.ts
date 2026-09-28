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
  openColumnFilterIds: Set<string>;
  sortState: SortState | null;
};

export function createAppState(): AppState {
  return {
    latestData: [],
    columns: [],
    columnWidths: {},
    expandedHierarchyIds: new Set<string>(),
    columnFilters: {},
    openColumnFilterIds: new Set<string>(),
    sortState: null
  };
}

export function applyStatePatch<T extends Partial<AppState>>(state: AppState, patch: T): AppState {
  return {
    ...state,
    ...patch,
    expandedHierarchyIds: patch.expandedHierarchyIds ?? new Set(state.expandedHierarchyIds),
    openColumnFilterIds: patch.openColumnFilterIds ?? new Set(state.openColumnFilterIds)
  };
}
