import { HierarchyExpandTo, TableColumnConfig, TableRowData } from '../data/mockData';
import { renderBarCell } from './barRenderer';
import { renderSparklineCell } from './sparklineRenderer';
import { exportToExcel } from '../utils/exportExcel';
import { findMatchingConditionRule } from '../utils/conditionalFormatting';
import { formatSecondaryMetricLabel, getSecondaryMetricTone } from '../utils/secondaryMetric';

type NumericFormatStyle = 'number' | 'currency' | 'percent';
type NumericScale = 'auto' | 'none' | 'k' | 'm';
type NumericCurrency = 'EUR' | 'USD' | 'GBP';

type ColumnFilterValue = {
  text?: string;
  min?: number;
  max?: number;
};

type SortDirection = 'desc' | 'asc';

type ColumnSortState = {
  columnId: string;
  direction: SortDirection;
};

interface TableRenderOptions {
  onColumnsReordered?: (columns: TableColumnConfig[]) => void;
  columnWidths?: Record<string, number>;
  onColumnWidthsChange?: (columnWidths: Record<string, number>) => void;
  onExpandedNodeIdsChange?: (expandedNodeIds: Set<string>) => void;
  expandedNodeIds?: Set<string>;
  columnFilters?: Record<string, ColumnFilterValue>;
  onColumnFiltersChange?: (columnFilters: Record<string, ColumnFilterValue>) => void;
  sortState?: ColumnSortState | null;
  onSortStateChange?: (sortState: ColumnSortState | null) => void;
  tableauWorksheet?: {
    hoverTupleAsync?: (
      tupleId: number,
      options?: { tooltipAnchorPoint?: { x: number; y: number } }
    ) => Promise<unknown> | unknown;
  };
}

let tableRenderToken = 0;
const SPARKLINE_TOOLTIP_ID = 'sparkline-point-tooltip';
const SPARKLINE_HOVER_THROTTLE_MS = 150;
const SPARKLINE_NATIVE_HOVER_TIMEOUT_MS = 450;

type HoverWorksheet = {
  name?: string;
  hoverTupleAsync?: (
    tupleId: number,
    options?: { tooltipAnchorPoint?: { x: number; y: number } }
  ) => Promise<unknown> | unknown;
  selectTuplesAsync?: (
    tupleIds: number[],
    updateType: unknown,
    options?: { tooltipAnchorPoint?: { x: number; y: number } }
  ) => Promise<unknown> | unknown;
};

function resolveHoverWorksheet(preferred?: HoverWorksheet): HoverWorksheet | undefined {
  const extensions = (window as unknown as {
    tableau?: {
      extensions?: {
        worksheetContent?: { worksheet?: unknown };
        dashboardContent?: { dashboard?: { worksheets?: unknown[] } };
      };
    };
  }).tableau?.extensions;

  const worksheetFromContent = extensions?.worksheetContent?.worksheet as HoverWorksheet | undefined;
  const dashboardWorksheets = (extensions?.dashboardContent?.dashboard?.worksheets ?? []) as HoverWorksheet[];
  const hasHoverApi = (worksheet: HoverWorksheet | undefined): boolean =>
    Boolean(worksheet && typeof worksheet.hoverTupleAsync === 'function');

  if (hasHoverApi(preferred)) {
    return preferred;
  }

  if (hasHoverApi(worksheetFromContent)) {
    return worksheetFromContent;
  }

  if (preferred?.name) {
    const sameName = dashboardWorksheets.find((worksheet) => worksheet.name === preferred.name);
    if (hasHoverApi(sameName)) {
      return sameName;
    }
  }

  if (worksheetFromContent?.name) {
    const sameName = dashboardWorksheets.find((worksheet) => worksheet.name === worksheetFromContent.name);
    if (hasHoverApi(sameName)) {
      return sameName;
    }
  }

  return dashboardWorksheets.find((worksheet) => hasHoverApi(worksheet));
}

function formatBoundValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }

  return Number.isInteger(value) ? String(value) : String(value);
}

function formatSparklineTooltipNumber(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
}

function getColumnTrack(column: TableColumnConfig): string {
  if (column.type === 'hierarchy') {
    return '260px';
  }

  if (column.type === 'bar') {
    return '180px';
  }

  if (column.type === 'dual-line') {
    return '160px';
  }

  return '140px';
}

function getDefaultColumnWidth(column: TableColumnConfig): number {
  const track = getColumnTrack(column);
  const parsed = Number.parseInt(track, 10);
  return Number.isFinite(parsed) ? parsed : 140;
}

function getMinColumnWidth(column: TableColumnConfig): number {
  if (column.type === 'hierarchy') {
    return 180;
  }

  if (column.type === 'dual-line') {
    return 130;
  }

  return 100;
}

function getNumberValue(value: TableRowData['values'][string], fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function getNumberArrayValue(value: TableRowData['values'][string]): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number') : [];
}

function getDateArrayValue(value: TableRowData['values'][string]): Array<string | number> {
  return Array.isArray(value)
    ? value.filter((entry): entry is string | number => typeof entry === 'string' || typeof entry === 'number')
    : [];
}

function getDerivedSeriesKey(columnId: string, part: 'date' | 'primary' | 'secondary'): string {
  return `__series__${columnId}__${part}`;
}

function getDerivedBarKey(columnId: string, part: 'value' | 'max'): string {
  return `__bar__${columnId}__${part}`;
}

function getDerivedDeltaKey(columnId: string): string {
  return `__delta__${columnId}`;
}

function getNumberOrUndefined(value: TableRowData['values'][string]): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getSecondaryMetricDisplay(
  column: Extract<TableColumnConfig, { type: 'text' }> | Extract<TableColumnConfig, { type: 'bar' }>,
  row: TableRowData,
  currentValue: number,
  formatOptions: { formatStyle?: NumericFormatStyle; currency?: NumericCurrency; scale?: NumericScale }
): { text: string; tone: string } | undefined {
  const config = column.secondaryMetric;
  if (!config?.enabled) {
    return undefined;
  }

  const delta = getNumberOrUndefined(row.values[getDerivedDeltaKey(column.id)]);
  const { divisor, suffix } = getScaleInfo(currentValue, formatOptions.scale ?? 'none');
  const text = formatSecondaryMetricLabel(delta, config.calculationType, {
    decimals: config.decimals,
    formatStyle: formatOptions.formatStyle,
    currency: formatOptions.currency,
    scaleDivisor: divisor,
    scaleSuffix: suffix
  });

  return { text, tone: getSecondaryMetricTone(delta, config.colorMode) };
}

function appendSecondaryMetricLabel(
  cell: HTMLElement,
  secondary: { text: string; tone: string } | undefined
): void {
  if (!secondary) {
    return;
  }

  const secondarySpan = document.createElement('span');
  secondarySpan.className = `secondary-metric-label secondary-metric-${secondary.tone}`;
  secondarySpan.innerText = secondary.text;
  cell.appendChild(secondarySpan);
}

function clearHeaderDragState(headerRow: HTMLElement): void {
  headerRow.querySelectorAll('.drag-over').forEach((cell) => cell.classList.remove('drag-over'));
  headerRow.querySelectorAll('.dragging').forEach((cell) => cell.classList.remove('dragging'));
}

function getHierarchyColumnIndex(columns: TableColumnConfig[]): number {
  return columns.findIndex((column) => column.type === 'hierarchy');
}

function buildChildrenMap(rows: TableRowData[]): Map<string, string[]> {
  const childrenMap = new Map<string, string[]>();

  rows.forEach((row) => {
    if (!row.parentId) {
      return;
    }

    const children = childrenMap.get(row.parentId) ?? [];
    children.push(row.id);
    childrenMap.set(row.parentId, children);
  });

  return childrenMap;
}

function getDescendantIds(rowId: string, childrenMap: Map<string, string[]>): string[] {
  const descendantIds: string[] = [];
  const stack = [...(childrenMap.get(rowId) ?? [])];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId) {
      continue;
    }

    descendantIds.push(currentId);
    const children = childrenMap.get(currentId) ?? [];
    stack.push(...children);
  }

  return descendantIds;
}

function getTextValue(value: TableRowData['values'][string], suffix?: string): string {
  if (isNullLikeValue(value)) {
    return '';
  }

  if (typeof value === 'number') {
    return `${new Intl.NumberFormat('en-US').format(value)}${suffix ?? ''}`;
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'string') {
    return `${value}${suffix ?? ''}`;
  }

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  return '';
}

function isNullLikeValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === ''
    || normalized === 'null'
    || normalized === '%null%'
    || normalized === '(null)'
    || normalized === '<null>';
}

function isNumericLikeValue(value: TableRowData['values'][string]): boolean {
  if (isNullLikeValue(value)) {
    return false;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }
    const parsed = Number(trimmed.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed);
  }

  return false;
}

function getScaleInfo(value: number, scale: NumericScale): { divisor: number; suffix: string } {
  if (scale === 'k') {
    return { divisor: 1_000, suffix: 'K' };
  }

  if (scale === 'm') {
    return { divisor: 1_000_000, suffix: 'M' };
  }

  if (scale === 'auto') {
    const absoluteValue = Math.abs(value);
    if (absoluteValue >= 1_000_000) {
      return { divisor: 1_000_000, suffix: 'M' };
    }

    if (absoluteValue >= 1_000) {
      return { divisor: 1_000, suffix: 'K' };
    }
  }

  return { divisor: 1, suffix: '' };
}

function getLocaleForCurrency(currency: NumericCurrency): string {
  if (currency === 'USD') return 'en-US';
  if (currency === 'GBP') return 'en-GB';
  return 'fr-FR';
}

function formatNumericValueForTextColumn(
  value: number,
  options: {
    decimals?: number;
    formatStyle?: NumericFormatStyle;
    currency?: NumericCurrency;
    scale?: NumericScale;
    suffix?: string;
  }
): string {
  const decimals = Math.max(0, Math.min(6, options.decimals ?? 0));
  const formatStyle = options.formatStyle ?? 'number';
  const currency = options.currency ?? 'EUR';
  const scale = options.scale ?? 'none';
  const locale = getLocaleForCurrency(currency);

  if (formatStyle === 'percent') {
    const displayValue = value * 100;
    const formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    return `${formatter.format(displayValue)} %`;
  }

  const { divisor, suffix: scaleSuffix } = getScaleInfo(value, scale);
  const scaledValue = value / divisor;

  if (formatStyle === 'currency') {
    const formatter = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });

    const formattedNumber = formatter.format(scaledValue);
    if (currency === 'USD') {
      return `$${formattedNumber}${scaleSuffix}`;
    }

    if (currency === 'GBP') {
      return `£${formattedNumber}${scaleSuffix}`;
    }

    if (scaleSuffix) {
      return `${formattedNumber} ${scaleSuffix}€`;
    }

    return `${formattedNumber} €`;
  }

  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  const formatted = `${formatter.format(scaledValue)}${scaleSuffix ? ` ${scaleSuffix}` : ''}`;
  return `${formatted}${options.suffix ?? ''}`;
}

function applyTextAlignment(cell: HTMLElement, alignment: 'left' | 'center' | 'right' = 'left'): void {
  const justifyContent = alignment === 'right'
    ? 'flex-end'
    : alignment === 'center'
      ? 'center'
      : 'flex-start';
  cell.style.justifyContent = justifyContent;
}

function getColumnFilterValues(data: TableRowData[], column: TableColumnConfig): number[] {
  if (column.type === 'bar') {
    const barColumn = column as Extract<TableColumnConfig, { type: 'bar' }>;
    return data.map((row) => getNumberValue(row.values[getDerivedBarKey(barColumn.id, 'value')] ?? row.values[barColumn.valueField]));
  }

  if (column.type === 'text') {
    const textColumn = column as Extract<TableColumnConfig, { type: 'text' }>;
    return data
      .map((row) => row.values[textColumn.valueField])
      .filter((value) => !isNullLikeValue(value))
      .map((value) => (typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'))))
      .filter((value) => Number.isFinite(value));
  }

  return [];
}

function getColumnFilterKind(column: TableColumnConfig, data: TableRowData[]): 'text' | 'number' | 'none' {
  if (column.type === 'hierarchy') {
    return 'text';
  }

  if (column.type === 'bar') {
    return 'number';
  }

  if (column.type === 'text') {
    let hasNonEmptyValue = false;
    const hasOnlyNumericValues = data.every((row) => {
      const rawValue = row.values[column.valueField];
      if (isNullLikeValue(rawValue)) {
        return true;
      }

      hasNonEmptyValue = true;
      return isNumericLikeValue(rawValue);
    });

    if (hasNonEmptyValue && hasOnlyNumericValues) {
      return 'number';
    }

    return 'text';
  }

  return 'none';
}

function getNumericFilterStats(values: number[]): { min: number; max: number } {
  if (values.length === 0) {
    return { min: 0, max: 0 };
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

function getNumericColumnValue(row: TableRowData, column: TableColumnConfig): number {
  if (column.type === 'bar') {
    const barColumn = column as Extract<TableColumnConfig, { type: 'bar' }>;
    return getNumberValue(row.values[getDerivedBarKey(barColumn.id, 'value')] ?? row.values[barColumn.valueField]);
  }

  if (column.type === 'text') {
    const textColumn = column as Extract<TableColumnConfig, { type: 'text' }>;
    return getNumberValue(row.values[textColumn.valueField]);
  }

  return 0;
}

function getFilterTextValue(row: TableRowData, column: TableColumnConfig): string {
  if (column.type === 'hierarchy') {
    return row.label;
  }

  if (column.type === 'text') {
    return getTextValue(row.values[column.valueField], column.suffix);
  }

  if (column.type === 'bar') {
    return String(getNumberValue(row.values[getDerivedBarKey(column.id, 'value')] ?? row.values[column.valueField]));
  }

  return '';
}

function matchesTextFilter(rowText: string, filterValue: string): boolean {
  const normalizedFilter = filterValue.trim().toLowerCase();
  if (!normalizedFilter) {
    return true;
  }

  return rowText.toLowerCase().includes(normalizedFilter);
}

function matchesNumberFilter(value: number, filterValue: ColumnFilterValue): boolean {
  const min = filterValue.min ?? Number.NEGATIVE_INFINITY;
  const max = filterValue.max ?? Number.POSITIVE_INFINITY;
  return value >= min && value <= max;
}

function applyColumnFilters(
  data: TableRowData[],
  columns: TableColumnConfig[],
  columnFilters: Record<string, ColumnFilterValue>
): { rows: TableRowData[] } {
  const filterKindByColumnId = new Map<string, 'text' | 'number' | 'none'>();
  const getFilterKind = (column: TableColumnConfig): 'text' | 'number' | 'none' => {
    const cachedKind = filterKindByColumnId.get(column.id);
    if (cachedKind) {
      return cachedKind;
    }

    const resolvedKind = getColumnFilterKind(column, data);
    filterKindByColumnId.set(column.id, resolvedKind);
    return resolvedKind;
  };

  const hasNumericValue = (row: TableRowData, column: TableColumnConfig): boolean => {
    if (column.type === 'bar') {
      const rawValue = row.values[getDerivedBarKey(column.id, 'value')] ?? row.values[column.valueField];
      return isNumericLikeValue(rawValue);
    }

    if (column.type === 'text') {
      return isNumericLikeValue(row.values[column.valueField]);
    }

    return false;
  };

  const activeFilters = columns.filter((column) => {
    const filter = columnFilters[column.id];
    if (!filter) {
      return false;
    }

    const kind = getFilterKind(column);
    if (kind === 'text') {
      return Boolean(filter.text?.trim());
    }

    if (kind === 'number') {
      return filter.min !== undefined || filter.max !== undefined;
    }

    return false;
  });

  if (activeFilters.length === 0) {
    return { rows: data };
  }

  const hierarchyColumnIndex = getHierarchyColumnIndex(columns);
  const rowsById = new Map<string, TableRowData>(data.map((row) => [row.id, row]));
  const directMatches = data.filter((row) => activeFilters.every((column) => {
    const filterValue = columnFilters[column.id];
    if (!filterValue) {
      return true;
    }

    const kind = getFilterKind(column);
    if (kind === 'text') {
      return matchesTextFilter(getFilterTextValue(row, column), filterValue.text ?? '');
    }

    if (kind === 'number') {
      if (!hasNumericValue(row, column)) {
        return false;
      }

      const numericValue = getNumericColumnValue(row, column);
      return matchesNumberFilter(numericValue, filterValue);
    }

    return true;
  }));

  if (hierarchyColumnIndex < 0) {
    return { rows: directMatches };
  }

  const visibleIds = new Set<string>();

  directMatches.forEach((row) => {
    visibleIds.add(row.id);
    let currentParentId = row.parentId;

    while (currentParentId) {
      visibleIds.add(currentParentId);
      currentParentId = rowsById.get(currentParentId)?.parentId;
    }
  });

  return {
    rows: data.filter((row) => visibleIds.has(row.id))
  };
}

function isColumnSortable(column: TableColumnConfig): boolean {
  return column.type !== 'dual-line';
}

function getColumnSortKind(column: TableColumnConfig, data: TableRowData[]): 'text' | 'number' | 'none' {
  return getColumnFilterKind(column, data);
}

function getSortTextValue(value: TableRowData['values'][string]): string {
  if (value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.join(' ');
  }

  return String(value);
}

function compareValues(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return String(left).localeCompare(String(right), undefined, { sensitivity: 'base', numeric: true });
}

function getRowSortValue(
  row: TableRowData,
  column: TableColumnConfig,
  kind: 'text' | 'number' | 'none'
): string | number {
  if (column.type === 'hierarchy') {
    return row.label;
  }

  if (column.type === 'bar' || kind === 'number') {
    return getNumericColumnValue(row, column);
  }

  if (column.type === 'text') {
    return getSortTextValue(row.values[column.valueField]);
  }

  return '';
}

function sortRows(
  rows: TableRowData[],
  columns: TableColumnConfig[],
  sortState: ColumnSortState | null | undefined
): TableRowData[] {
  if (!sortState) {
    return rows;
  }

  const sortColumn = columns.find((column) => column.id === sortState.columnId);
  if (!sortColumn || !isColumnSortable(sortColumn)) {
    return rows;
  }

  const directionFactor = sortState.direction === 'asc' ? 1 : -1;
  const sortKind = getColumnSortKind(sortColumn, rows);
  const compareRows = (left: TableRowData, right: TableRowData): number => {
    const leftValue = getRowSortValue(left, sortColumn, sortKind);
    const rightValue = getRowSortValue(right, sortColumn, sortKind);
    return compareValues(leftValue, rightValue) * directionFactor;
  };

  const hasHierarchy = rows.some((row) => Boolean(row.parentId));
  if (!hasHierarchy) {
    return [...rows].sort(compareRows);
  }

  const childrenByParentId = new Map<string, TableRowData[]>();
  rows.forEach((row) => {
    const parentKey = row.parentId ?? '__root__';
    const siblings = childrenByParentId.get(parentKey) ?? [];
    siblings.push(row);
    childrenByParentId.set(parentKey, siblings);
  });

  childrenByParentId.forEach((siblings, parentKey) => {
    if (parentKey === '__root__' || siblings.length > 1) {
      siblings.sort(compareRows);
    }
  });

  const orderedRows: TableRowData[] = [];
  const visit = (parentKey: string): void => {
    const siblings = childrenByParentId.get(parentKey) ?? [];
    siblings.forEach((row) => {
      orderedRows.push(row);
      visit(row.id);
    });
  };

  visit('__root__');
  return orderedRows;
}

function getBarGlobalMaxByColumn(data: TableRowData[], columns: TableColumnConfig[]): Map<string, number> {
  const maxByColumn = new Map<string, number>();

  columns.forEach((column) => {
    if (column.type !== 'bar') {
      return;
    }

    const maxValue = data.reduce((currentMax, row) => {
      const value = getNumericColumnValue(row, column);
      return Math.max(currentMax, value);
    }, 0);

    maxByColumn.set(column.id, Math.max(1, maxValue));
  });

  return maxByColumn;
}

function getBarLevelMaxByColumn(data: TableRowData[], columns: TableColumnConfig[]): Map<string, Map<number, number>> {
  const maxByColumn = new Map<string, Map<number, number>>();

  columns.forEach((column) => {
    if (column.type !== 'bar') {
      return;
    }

    const levelMax = new Map<number, number>();
    data.forEach((row) => {
      const value = getNumericColumnValue(row, column);
      levelMax.set(row.level, Math.max(levelMax.get(row.level) ?? 0, value));
    });
    levelMax.forEach((value, level) => levelMax.set(level, Math.max(1, value)));

    maxByColumn.set(column.id, levelMax);
  });

  return maxByColumn;
}

export type HierarchyExpandToOption = HierarchyExpandTo;

// Row levels are 0-indexed; "Down to level N" reveals rows up to level N-1's children.
export function computeInitialExpandedIds(rows: TableRowData[], expandTo: HierarchyExpandToOption | undefined): Set<string> {
  const expandedIds = new Set<string>();
  if (!expandTo || expandTo === 'level-1') {
    return expandedIds;
  }

  const maxAutoExpandLevel = expandTo === 'level-2' ? 1 : expandTo === 'level-3' ? 2 : Number.POSITIVE_INFINITY;
  rows.forEach((row) => {
    if (row.hasChildren && row.level < maxAutoExpandLevel) {
      expandedIds.add(row.id);
    }
  });

  return expandedIds;
}

interface BarScaleContext {
  levelMaxByColumn: Map<string, Map<number, number>>;
  rowsById: Map<string, TableRowData>;
}

function renderConfiguredCell(
  cell: HTMLElement,
  row: TableRowData,
  column: TableColumnConfig,
  barGlobalMaxByColumn: Map<string, number>,
  barScaleContext: BarScaleContext,
  sparklineInteractions?: {
    onPointHover: (payload: {
      clientX: number;
      clientY: number;
      pageX: number;
      pageY: number;
      phase: 'enter' | 'move';
      index: number;
      date?: string | number;
      currentValue?: number;
      previousValue?: number;
      line: 'current' | 'previous';
    }) => void;
    onPointLeave: () => void;
  }
): void {
  if (column.type === 'text') {
    const rawValue = row.values[column.valueField];
    applyTextAlignment(cell, column.alignment ?? 'left');

    if (isNumericLikeValue(rawValue)) {
      const numericValue = getNumberValue(rawValue);
      const matchedRule = findMatchingConditionRule(numericValue, column.conditions);
      const formatOptions = {
        decimals: column.decimals,
        formatStyle: column.formatStyle,
        currency: column.currency,
        scale: column.scale,
        suffix: column.suffix
      };

      cell.innerText = '';
      const valueSpan = document.createElement('span');
      valueSpan.innerText = formatNumericValueForTextColumn(numericValue, formatOptions);
      cell.appendChild(valueSpan);
      cell.style.color = matchedRule?.textColor ?? '';
      cell.style.backgroundColor = matchedRule?.shading ?? '';
      appendSecondaryMetricLabel(cell, getSecondaryMetricDisplay(column, row, numericValue, formatOptions));
      return;
    }

    cell.innerText = getTextValue(rawValue, column.suffix);
    return;
  }

  if (column.type === 'hierarchy') {
    cell.innerText = row.label;
    return;
  }

  if (column.type === 'bar') {
    const value = getNumberValue(
      row.values[getDerivedBarKey(column.id, 'value')] ?? row.values[column.valueField]
    );
    const fallbackGlobalMax = barGlobalMaxByColumn.get(column.id) ?? Math.max(1, value);

    let max: number;
    if (column.barScale === 'per-level') {
      max = barScaleContext.levelMaxByColumn.get(column.id)?.get(row.level) ?? fallbackGlobalMax;
    } else if (column.barScale === 'relative-to-parent') {
      const parentRow = row.parentId ? barScaleContext.rowsById.get(row.parentId) : undefined;
      const parentValue = parentRow ? getNumericColumnValue(parentRow, column) : 0;
      max = parentValue > 0 ? parentValue : fallbackGlobalMax;
    } else {
      const configuredMax = column.maxField
        ? getNumberValue(
          row.values[getDerivedBarKey(column.id, 'max')] ?? row.values[column.maxField]
        )
        : 0;

      // If max field is missing, invalid or equals value field, use global max.
      const hasValidConfiguredMax = Number.isFinite(configuredMax) && configuredMax > 0;
      max = !column.maxField || column.maxField === column.valueField || !hasValidConfiguredMax
        ? fallbackGlobalMax
        : Math.max(configuredMax, value, 1);
    }

    const matchedRule = findMatchingConditionRule(value, column.conditions);

    renderBarCell(cell, value, max, {
      barColor: matchedRule?.barColor ?? column.barColor,
      textColor: matchedRule?.textColor,
      decimals: column.decimals,
      formatStyle: column.formatStyle,
      currency: column.currency,
      scale: column.scale,
      secondaryLabel: getSecondaryMetricDisplay(column, row, value, {
        formatStyle: column.formatStyle,
        currency: column.currency,
        scale: column.scale
      })
    });
    return;
  }

  const dates = getDateArrayValue(
    row.values[getDerivedSeriesKey(column.id, 'date')] ?? row.values[column.dateField]
  );
  const primaryMetric = getNumberArrayValue(
    row.values[getDerivedSeriesKey(column.id, 'primary')] ?? row.values[column.primaryMetricField]
  );
  const secondaryMetric = column.compare === false
    ? []
    : getNumberArrayValue(
      row.values[getDerivedSeriesKey(column.id, 'secondary')] ?? row.values[column.secondaryMetricField]
    );
  renderSparklineCell(cell, dates, primaryMetric, secondaryMetric, {
    line1Color: column.line1Color,
    line2Color: column.line2Color,
    onPointHover: sparklineInteractions?.onPointHover,
    onPointLeave: sparklineInteractions?.onPointLeave
  });
}

function getDisplayTextForAutoFit(row: TableRowData, column: TableColumnConfig): string {
  if (column.type === 'hierarchy') {
    return row.label;
  }

  if (column.type === 'text') {
    const rawValue = row.values[column.valueField];
    if (isNumericLikeValue(rawValue)) {
      return formatNumericValueForTextColumn(getNumberValue(rawValue), {
        decimals: column.decimals,
        formatStyle: column.formatStyle,
        currency: column.currency,
        scale: column.scale,
        suffix: column.suffix
      });
    }

    return getTextValue(rawValue, column.suffix);
  }

  if (column.type === 'bar') {
    const rawValue = row.values[getDerivedBarKey(column.id, 'value')] ?? row.values[column.valueField];
    return formatNumericValueForTextColumn(getNumberValue(rawValue), {
      decimals: column.decimals,
      formatStyle: column.formatStyle,
      currency: column.currency,
      scale: column.scale
    });
  }

  const dates = getDateArrayValue(row.values[getDerivedSeriesKey(column.id, 'date')] ?? row.values[column.dateField]);
  if (dates.length >= 2) {
    return `${String(dates[0])} - ${String(dates[dates.length - 1])}`;
  }

  return dates.length === 1 ? String(dates[0]) : 'Trend';
}

function computeAutoFitWidth(column: TableColumnConfig, visibleRows: TableRowData[]): number {
  const minWidth = getMinColumnWidth(column);
  const sampleRows = visibleRows.slice(0, 400);

  const maxLength = sampleRows.reduce((currentMax, row) => {
    const cellText = getDisplayTextForAutoFit(row, column);
    return Math.max(currentMax, cellText.length);
  }, column.header.length);

  const estimatedWidth = Math.ceil(maxLength * 8 + 36);
  return Math.min(760, Math.max(minWidth, estimatedWidth));
}

export function renderTable(
  containerId: string,
  data: TableRowData[],
  columns: TableColumnConfig[],
  options?: TableRenderOptions
): void {
  const currentRenderToken = ++tableRenderToken;
  const container = document.getElementById(containerId);
  if (!container) return;

  const hoverWorksheet = resolveHoverWorksheet(options?.tableauWorksheet as HoverWorksheet | undefined);
  const hasNativeHoverApi = typeof hoverWorksheet?.hoverTupleAsync === 'function';
  let hoverFailureLogged = false;
  let nativeHoverStatus: 'idle' | 'pending' | 'ok' | 'ok-select' | 'error' | 'timeout' = hasNativeHoverApi ? 'idle' : 'error';
  let hoverDispatchTimer: ReturnType<typeof setTimeout> | null = null;
  let latestPendingHover: { tupleId: number; x: number; y: number } | null = null;
  let isHoverDispatchRunning = false;

  const oldTooltip = document.getElementById(SPARKLINE_TOOLTIP_ID);
  oldTooltip?.remove();

  const pointTooltip = document.createElement('div');
  pointTooltip.id = SPARKLINE_TOOLTIP_ID;
  pointTooltip.className = 'sparkline-point-tooltip';
  pointTooltip.style.display = 'none';
  document.body.appendChild(pointTooltip);

  const hidePointTooltip = (): void => {
    pointTooltip.style.display = 'none';
  };

  const clearTableauHover = (): void => {
    latestPendingHover = null;
  };

  const dispatchTableauHover = (tupleId: number, x: number, y: number, immediate = false): void => {
    const hoverTupleAsync = hoverWorksheet?.hoverTupleAsync;
    const safeTupleId = Math.trunc(tupleId);
    if (!hoverTupleAsync || !Number.isFinite(safeTupleId) || safeTupleId <= 0) {
      return;
    }

    const invokeNativeHoverWithFallback = async (
      baseTupleId: number,
      anchorX: number,
      anchorY: number,
      allowSelectFallback: boolean
    ): Promise<void> => {
      nativeHoverStatus = 'pending';
      const candidates = [baseTupleId, baseTupleId - 1].filter((id, idx, list) => id > 0 && list.indexOf(id) === idx);

      for (const candidateTupleId of candidates) {
        try {
          const callPromise = Promise.resolve(
            hoverTupleAsync(candidateTupleId, {
              tooltipAnchorPoint: { x: anchorX, y: anchorY }
            })
          ).then(() => true).catch(() => false);

          const timeoutPromise = new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), SPARKLINE_NATIVE_HOVER_TIMEOUT_MS);
          });

          const isSuccessful = await Promise.race([callPromise, timeoutPromise]);
          if (isSuccessful) {
            nativeHoverStatus = 'ok';
            return;
          }
        } catch {
          // Try next candidate tuple id.
        }
      }

      if (allowSelectFallback && typeof hoverWorksheet?.selectTuplesAsync === 'function') {
        const selectTuplesAsync = hoverWorksheet.selectTuplesAsync;
        const selectOptions = (window as unknown as {
          tableau?: { SelectOptions?: { Simple?: unknown } };
        }).tableau?.SelectOptions;
        const selectMode = selectOptions?.Simple ?? 'simple';

        for (const candidateTupleId of candidates) {
          try {
            const callPromise = Promise.resolve(
              selectTuplesAsync([candidateTupleId], selectMode, {
                tooltipAnchorPoint: { x: anchorX, y: anchorY }
              })
            ).then(() => true).catch(() => false);

            const timeoutPromise = new Promise<boolean>((resolve) => {
              setTimeout(() => resolve(false), SPARKLINE_NATIVE_HOVER_TIMEOUT_MS);
            });

            const isSuccessful = await Promise.race([callPromise, timeoutPromise]);
            if (isSuccessful) {
              nativeHoverStatus = 'ok-select';
              return;
            }
          } catch {
            // Try next candidate tuple id.
          }
        }
      }

      nativeHoverStatus = 'timeout';
      if (!hoverFailureLogged) {
        hoverFailureLogged = true;
        console.warn('Tableau native tooltip hover call timed out or failed. Falling back to local tooltip only.');
      }
    };

    if (immediate) {
      latestPendingHover = null;
      if (hoverDispatchTimer) {
        clearTimeout(hoverDispatchTimer);
        hoverDispatchTimer = null;
      }

      void invokeNativeHoverWithFallback(safeTupleId, x, y, true);
      return;
    }

    latestPendingHover = { tupleId: safeTupleId, x, y };
    if (hoverDispatchTimer) {
      return;
    }

    hoverDispatchTimer = setTimeout(() => {
      hoverDispatchTimer = null;

      if (currentRenderToken !== tableRenderToken) {
        latestPendingHover = null;
        return;
      }

      const request = latestPendingHover;
      latestPendingHover = null;
      if (!request) {
        return;
      }

      if (isHoverDispatchRunning) {
        latestPendingHover = request;
        return;
      }

      isHoverDispatchRunning = true;
      void invokeNativeHoverWithFallback(request.tupleId, request.x, request.y, false).finally(() => {
        isHoverDispatchRunning = false;
        if (latestPendingHover) {
          const next = latestPendingHover;
          latestPendingHover = null;
          dispatchTableauHover(next.tupleId, next.x, next.y);
        }
      });
    }, SPARKLINE_HOVER_THROTTLE_MS);
  };

  const activeElement = document.activeElement;
  const activeFilterFocus = activeElement instanceof HTMLInputElement
    && activeElement.classList.contains('column-filter-input')
    && activeElement.dataset.columnId
    ? {
      columnId: activeElement.dataset.columnId,
      selectionStart: activeElement.selectionStart ?? activeElement.value.length,
      selectionEnd: activeElement.selectionEnd ?? activeElement.value.length
    }
    : null;

  container.innerHTML = '';

  if (columns.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'table-empty-state';
    emptyState.innerText = 'No columns configured. Add a column in the configuration panel.';
    container.appendChild(emptyState);
    return;
  }

  // ---------------------------------------------------------------------------
  // Toolbar with Export Button
  // ---------------------------------------------------------------------------
  const toolbar = document.createElement('div');
  toolbar.className = 'table-toolbar';
  toolbar.style.display = 'flex';
  toolbar.style.justifyContent = 'flex-start'; // Aligne à gauche pour ne pas chevaucher la config à droite
  toolbar.style.marginBottom = '12px';
  toolbar.style.position = 'relative';
  toolbar.style.zIndex = '10'; // Garantit que le bouton est cliquable au-dessus des autres éléments

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'icon-only-btn';
  exportBtn.innerText = '⬇';
  exportBtn.setAttribute('aria-label', 'Export CSV');
  exportBtn.title = 'Export CSV';

  exportBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    // Export des lignes visibles/filtrées
    exportToExcel(visibleRows, columns, `Export_${new Date().toISOString().slice(0, 10)}.csv`);
  });

  toolbar.appendChild(exportBtn);
  container.appendChild(toolbar);

  const grid = document.createElement('div');
  grid.className = 'table-grid';
  const columnWidths = options?.columnWidths ?? {};
  const getEffectiveWidth = (column: TableColumnConfig): number => {
    const currentWidth = columnWidths[column.id] ?? getDefaultColumnWidth(column);
    return Math.max(getMinColumnWidth(column), currentWidth);
  };
  const templateColumns = columns.map((column) => `${getEffectiveWidth(column)}px`).join(' ');
  const columnFilters = options?.columnFilters ?? {};
  const sortState = options?.sortState ?? null;
  const filteredResult = applyColumnFilters(data, columns, columnFilters);
  const filteredData = sortRows(filteredResult.rows, columns, sortState);
  const expandedNodeIds = new Set<string>(options?.expandedNodeIds ?? new Set<string>());
  const effectiveExpandedNodeIds = new Set<string>(expandedNodeIds);
  const barGlobalMaxByColumn = getBarGlobalMaxByColumn(filteredData, columns);
  const barLevelMaxByColumn = getBarLevelMaxByColumn(filteredData, columns);
  const hierarchyColumnIndex = getHierarchyColumnIndex(columns);
  const hasHierarchy = hierarchyColumnIndex >= 0;
  const childrenMap = hasHierarchy ? buildChildrenMap(filteredData) : new Map<string, string[]>();
  const rowsById = new Map<string, TableRowData>(filteredData.map((row) => [row.id, row]));
  const barScaleContext: BarScaleContext = { levelMaxByColumn: barLevelMaxByColumn, rowsById };

  const isHierarchyRowVisible = (row: TableRowData): boolean => {
    let currentParentId = row.parentId;

    while (currentParentId) {
      if (!effectiveExpandedNodeIds.has(currentParentId)) {
        return false;
      }

      currentParentId = rowsById.get(currentParentId)?.parentId;
    }

    return true;
  };

  const visibleRows = hasHierarchy ? filteredData.filter((row) => isHierarchyRowVisible(row)) : filteredData;
  const MAX_RENDERED_ROWS = 12000;
  const isCapped = visibleRows.length > MAX_RENDERED_ROWS;
  const rowsToRender = isCapped ? visibleRows.slice(0, MAX_RENDERED_ROWS) : visibleRows;

  const headerRow = document.createElement('div');
  headerRow.className = 'table-row header';
  headerRow.style.gridTemplateColumns = templateColumns;

  let isHeaderDragActive = false;
  let sourceIndex: number | null = null;
  let targetIndex: number | null = null;

  const finishHeaderDrag = (): void => {
    if (!isHeaderDragActive) {
      return;
    }

    const canReorder = sourceIndex !== null
      && targetIndex !== null
      && sourceIndex !== targetIndex
      && Number.isFinite(sourceIndex)
      && Number.isFinite(targetIndex);

    if (canReorder) {
      const fromIndex = sourceIndex as number;
      const toIndex = targetIndex as number;
      const nextColumns = [...columns];
      const [moved] = nextColumns.splice(fromIndex, 1);
      nextColumns.splice(toIndex, 0, moved);
      options?.onColumnsReordered?.(nextColumns);
    }

    isHeaderDragActive = false;
    sourceIndex = null;
    targetIndex = null;
    clearHeaderDragState(headerRow);
  };

  columns.forEach((column, index) => {
    const headerCell = document.createElement('div');
    headerCell.className = 'cell';
    headerCell.style.position = 'relative';
    const headerContent = document.createElement('div');
    headerContent.className = 'header-cell-content';
    const headerLabel = document.createElement('span');
    headerLabel.className = 'header-label';
    headerLabel.innerText = column.header;
    headerContent.appendChild(headerLabel);

    if (isColumnSortable(column)) {
      const sortButton = document.createElement('button');
      sortButton.type = 'button';
      sortButton.className = 'sort-button';

      const isSortedColumn = sortState?.columnId === column.id;
      if (isSortedColumn && sortState?.direction === 'desc') {
        sortButton.innerText = '↓';
      } else if (isSortedColumn && sortState?.direction === 'asc') {
        sortButton.innerText = '↑';
      } else {
        sortButton.innerText = '↕';
      }

      sortButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      sortButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const currentSort = options?.sortState;
        let nextSort: ColumnSortState | null;

        if (currentSort?.columnId !== column.id) {
          nextSort = { columnId: column.id, direction: 'desc' };
        } else if (currentSort.direction === 'desc') {
          nextSort = { columnId: column.id, direction: 'asc' };
        } else {
          nextSort = null;
        }

        options?.onSortStateChange?.(nextSort);
      });

      headerContent.appendChild(sortButton);
    }

    headerCell.appendChild(headerContent);

    headerCell.dataset.columnIndex = String(index);

    const beginHeaderRename = (): void => {
      const existingEditor = headerCell.querySelector('.header-edit-input');
      if (existingEditor) {
        return;
      }

      const editor = document.createElement('input');
      editor.type = 'text';
      editor.className = 'header-edit-input';
      editor.value = column.header;
      headerCell.appendChild(editor);

      const commitRename = (): void => {
        const nextHeader = editor.value.trim();
        editor.remove();
        if (!nextHeader || nextHeader === column.header) {
          return;
        }

        const nextColumns = [...columns];
        nextColumns[index] = {
          ...nextColumns[index],
          header: nextHeader
        };
        options?.onColumnsReordered?.(nextColumns);
      };

      const cancelRename = (): void => {
        editor.remove();
      };

      editor.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitRename();
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          cancelRename();
        }
      });

      editor.addEventListener('blur', commitRename);
      editor.focus();
      editor.select();
    };

    headerCell.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.classList.contains('column-resize-handle')) {
        return;
      }

      if (target?.classList.contains('header-edit-input')) {
        return;
      }

      if (event.detail > 1) {
        return;
      }

      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      isHeaderDragActive = true;
      sourceIndex = index;
      targetIndex = index;
      clearHeaderDragState(headerRow);
      headerCell.classList.add('dragging');
      document.addEventListener('mouseup', finishHeaderDrag, { once: true });
    });

    headerCell.addEventListener('mouseenter', () => {
      if (!isHeaderDragActive) {
        return;
      }

      targetIndex = index;
      clearHeaderDragState(headerRow);
      const sourceCell = headerRow.querySelector<HTMLElement>(`.cell[data-column-index="${sourceIndex}"]`);
      sourceCell?.classList.add('dragging');
      headerCell.classList.add('drag-over');
    });

    headerCell.addEventListener('mouseup', (event) => {
      if (!isHeaderDragActive) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      finishHeaderDrag();
    });

    headerLabel.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      beginHeaderRename();
    });

    if (index < columns.length - 1) {
      const resizeHandle = document.createElement('span');
      resizeHandle.className = 'column-resize-handle';
      resizeHandle.setAttribute('role', 'separator');
      resizeHandle.setAttribute('aria-label', `Resize ${column.header} column`);

      const startResize = (startEvent: MouseEvent | PointerEvent): void => {
        startEvent.preventDefault();
        startEvent.stopPropagation();

        const startX = startEvent.clientX;
        const startWidth = getEffectiveWidth(column);
        const minWidth = getMinColumnWidth(column);

        const onMove = (moveEvent: MouseEvent): void => {
          const nextWidth = Math.max(minWidth, Math.round(startWidth + (moveEvent.clientX - startX)));
          options?.onColumnWidthsChange?.({
            ...columnWidths,
            [column.id]: nextWidth
          });
        };

        const onUp = (): void => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      };

      resizeHandle.addEventListener('mousedown', (event) => startResize(event));
      resizeHandle.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const autoWidth = computeAutoFitWidth(column, visibleRows);
        options?.onColumnWidthsChange?.({
          ...columnWidths,
          [column.id]: autoWidth
        });
      });
      headerCell.appendChild(resizeHandle);
    }

    headerRow.appendChild(headerCell);
  });
  grid.appendChild(headerRow);

  const filterRow = document.createElement('div');
  filterRow.className = 'table-row filters';
  filterRow.style.gridTemplateColumns = templateColumns;

  columns.forEach((column) => {
    const filterCell = document.createElement('div');
    filterCell.className = 'cell filter-cell';
    const currentFilter = columnFilters[column.id] ?? {};
    const kind = getColumnFilterKind(column, filteredData);

    if (kind === 'text') {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'column-filter-input';
      input.dataset.columnId = column.id;
      input.placeholder = 'Enter filter value';
      input.value = currentFilter.text ?? '';
      input.addEventListener('input', () => {
        const nextFilters = { ...columnFilters, [column.id]: { ...currentFilter, text: input.value } };
        options?.onColumnFiltersChange?.(nextFilters);
      });

      if (activeFilterFocus?.columnId === column.id) {
        const start = Math.min(activeFilterFocus.selectionStart, input.value.length);
        const end = Math.min(activeFilterFocus.selectionEnd, input.value.length);

        queueMicrotask(() => {
          input.focus();
          input.setSelectionRange(start, end);
        });
      }

      filterCell.appendChild(input);
    } else if (kind === 'number') {
      const values = getColumnFilterValues(data, column);
      const stats = getNumericFilterStats(values);
      const safeMin = stats.min;
      const safeMax = stats.max > stats.min ? stats.max : stats.min + 1;
      const currentMin = Math.max(safeMin, Math.min(currentFilter.min ?? safeMin, safeMax));
      const currentMax = Math.max(currentMin, Math.min(currentFilter.max ?? safeMax, safeMax));
      const rangeSpan = safeMax - safeMin;

      const labelRow = document.createElement('div');
      labelRow.className = 'filter-range-inputs';
      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.step = 'any';
      minInput.className = 'filter-bound-input';
      minInput.setAttribute('aria-label', 'Minimum value');
      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.step = 'any';
      maxInput.className = 'filter-bound-input';
      maxInput.setAttribute('aria-label', 'Maximum value');
      labelRow.appendChild(minInput);
      labelRow.appendChild(maxInput);

      const sliderTrack = document.createElement('div');
      sliderTrack.className = 'filter-range-track';
      const sliderFill = document.createElement('div');
      sliderFill.className = 'filter-range-fill';
      const minThumb = document.createElement('button');
      minThumb.type = 'button';
      minThumb.className = 'filter-range-thumb';
      minThumb.setAttribute('aria-label', 'Minimum filter value');
      const maxThumb = document.createElement('button');
      maxThumb.type = 'button';
      maxThumb.className = 'filter-range-thumb';
      maxThumb.setAttribute('aria-label', 'Maximum filter value');
      sliderTrack.appendChild(sliderFill);
      sliderTrack.appendChild(minThumb);
      sliderTrack.appendChild(maxThumb);

      let selectedMin = currentMin;
      let selectedMax = currentMax;

      maxInput.value = formatBoundValue(currentMax);
      minInput.value = formatBoundValue(currentMin);

      const toPercent = (value: number): number => {
        if (rangeSpan <= 0) {
          return 0;
        }

        return ((value - safeMin) / rangeSpan) * 100;
      };

      const renderSliderState = (): void => {
        const minPercent = toPercent(selectedMin);
        const maxPercent = toPercent(selectedMax);

        minThumb.style.left = `${minPercent}%`;
        maxThumb.style.left = `${maxPercent}%`;
        sliderFill.style.left = `${minPercent}%`;
        sliderFill.style.width = `${Math.max(0, maxPercent - minPercent)}%`;
        minInput.value = formatBoundValue(selectedMin);
        maxInput.value = formatBoundValue(selectedMax);
      };

      const publishFilter = (): void => {
        const nextFilters = { ...columnFilters };

        // Si le slider est revenu aux bornes exactes, on efface le filtre
        if (selectedMin <= safeMin && selectedMax >= safeMax) {
          delete nextFilters[column.id];
        } else {
          nextFilters[column.id] = { ...currentFilter, min: selectedMin, max: selectedMax };
        }

        options?.onColumnFiltersChange?.(nextFilters);
      };

      const setValueFromPointer = (thumb: 'min' | 'max', clientX: number): void => {
        const bounds = sliderTrack.getBoundingClientRect();
        const ratio = bounds.width > 0
          ? Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width))
          : 0;
        const rawValue = safeMin + ratio * rangeSpan;

        if (thumb === 'min') {
          selectedMin = Math.min(rawValue, selectedMax);
        } else {
          selectedMax = Math.max(rawValue, selectedMin);
        }

        renderSliderState();
      };

      const attachDrag = (thumb: 'min' | 'max', handle: HTMLElement): void => {
        handle.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          handle.setPointerCapture(event.pointerId);
          setValueFromPointer(thumb, event.clientX);

          const onMove = (moveEvent: PointerEvent): void => {
            setValueFromPointer(thumb, moveEvent.clientX);
          };

          const onUp = (upEvent: PointerEvent): void => {
            handle.releasePointerCapture(upEvent.pointerId);
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onUp);
            publishFilter();
          };

          handle.addEventListener('pointermove', onMove);
          handle.addEventListener('pointerup', onUp);
          handle.addEventListener('pointercancel', onUp);
        });
      };

      attachDrag('min', minThumb);
      attachDrag('max', maxThumb);

      const applyInputs = (origin: 'min' | 'max'): void => {
        const rawMin = Number.parseFloat(minInput.value);
        const rawMax = Number.parseFloat(maxInput.value);
        let nextMin = Number.isFinite(rawMin) ? rawMin : safeMin;
        let nextMax = Number.isFinite(rawMax) ? rawMax : safeMax;

        nextMin = Math.max(safeMin, Math.min(nextMin, safeMax));
        nextMax = Math.max(safeMin, Math.min(nextMax, safeMax));

        if (origin === 'min' && nextMin > nextMax) {
          nextMax = nextMin;
        }

        if (origin === 'max' && nextMax < nextMin) {
          nextMin = nextMax;
        }

        selectedMin = nextMin;
        selectedMax = nextMax;
        renderSliderState();
        publishFilter();
      };

      minInput.addEventListener('change', () => applyInputs('min'));
      maxInput.addEventListener('change', () => applyInputs('max'));
      minInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyInputs('min');
        }
      });
      maxInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyInputs('max');
        }
      });

      sliderTrack.addEventListener('pointerdown', (event) => {
        const minDistance = Math.abs(event.clientX - minThumb.getBoundingClientRect().left);
        const maxDistance = Math.abs(event.clientX - maxThumb.getBoundingClientRect().left);
        const nearestThumb = minDistance <= maxDistance ? 'min' : 'max';
        setValueFromPointer(nearestThumb, event.clientX);
        publishFilter();
      });

      renderSliderState();

      filterCell.appendChild(labelRow);
      filterCell.appendChild(sliderTrack);
    } else {
      const empty = document.createElement('span');
      empty.className = 'filter-empty';
      empty.innerText = '—';
      filterCell.appendChild(empty);
    }

    filterRow.appendChild(filterCell);
  });

  grid.appendChild(filterRow);

  if (isCapped) {
    const performanceNote = document.createElement('div');
    performanceNote.className = 'table-performance-note';
    performanceNote.innerText = `Rendering is limited to ${new Intl.NumberFormat('en-US').format(MAX_RENDERED_ROWS)} rows out of ${new Intl.NumberFormat('en-US').format(visibleRows.length)} to keep the interface smooth.`;
    grid.appendChild(performanceNote);
  }

  rowsToRender.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'table-row';
    rowEl.style.gridTemplateColumns = templateColumns;
    rowEl.dataset.id = row.id;

    if (hasHierarchy && row.parentId) {
      rowEl.dataset.parentId = row.parentId;
    }

    columns.forEach((column, columnIndex) => {
      const valueCell = document.createElement('div');
      const isHierarchyColumn = hasHierarchy && columnIndex === hierarchyColumnIndex && column.type === 'hierarchy';

      if (isHierarchyColumn) {
        valueCell.className = 'cell cell-hierarchy';
        valueCell.style.paddingLeft = `${row.level * 24 + 12}px`;
        const isExpanded = effectiveExpandedNodeIds.has(row.id);

        if (row.hasChildren) {
          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = 'toggle-btn';
          toggleBtn.dataset.nodeId = row.id;
          toggleBtn.innerText = isExpanded ? '▾' : '▸';
          toggleBtn.setAttribute('aria-expanded', String(isExpanded));
          toggleBtn.setAttribute('aria-label', `${isExpanded ? 'Collapse' : 'Expand'} ${row.label}`);
          toggleBtn.title = `${isExpanded ? 'Collapse' : 'Expand'} ${row.label}`;
          toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            const nextIsExpanded = !expandedNodeIds.has(row.id);

            if (nextIsExpanded) {
              expandedNodeIds.add(row.id);
            } else {
              expandedNodeIds.delete(row.id);
              getDescendantIds(row.id, childrenMap).forEach((descendantId) => {
                expandedNodeIds.delete(descendantId);
              });
            }

            options?.onExpandedNodeIdsChange?.(new Set(expandedNodeIds));
            renderTable(containerId, data, columns, {
              ...options,
              expandedNodeIds: new Set(expandedNodeIds),
              columnFilters,
              sortState
            });
          });
          valueCell.appendChild(toggleBtn);
        } else {
          const spacer = document.createElement('span');
          spacer.className = 'toggle-spacer';
          valueCell.appendChild(spacer);
        }

        const hierarchyText = document.createElement('span');
        hierarchyText.innerText = row.label;
        valueCell.appendChild(hierarchyText);
      } else {
        valueCell.className = 'cell';
        renderConfiguredCell(valueCell, row, column, barGlobalMaxByColumn, barScaleContext, column.type === 'dual-line'
          ? {
            onPointHover: (payload) => {
              const dateLabel = payload.date === undefined ? '-' : String(payload.date);
              const tupleLabel = typeof row.tupleId === 'number' && Number.isFinite(row.tupleId)
                ? String(Math.trunc(row.tupleId))
                : '-';
              const nativeStatus = hasNativeHoverApi
                ? ` | Native: ${nativeHoverStatus}`
                : ' | Native: unavailable';
              pointTooltip.textContent = `Date: ${dateLabel} | N: ${formatSparklineTooltipNumber(payload.currentValue)} | N-1: ${formatSparklineTooltipNumber(payload.previousValue)} | Tuple: ${tupleLabel}${nativeStatus}`;
              pointTooltip.style.display = 'block';
              pointTooltip.style.left = `${payload.clientX + 12}px`;
              pointTooltip.style.top = `${payload.clientY + 12}px`;

              if (typeof row.tupleId === 'number' && Number.isFinite(row.tupleId)) {
                dispatchTableauHover(row.tupleId, payload.pageX, payload.pageY, payload.phase === 'enter');
              }
            },
            onPointLeave: () => {
              hidePointTooltip();
              clearTableauHover();
            }
          }
          : undefined);
      }

      rowEl.appendChild(valueCell);
    });

    grid.appendChild(rowEl);
  });

  container.appendChild(grid);

  container.addEventListener('mouseleave', () => {
    hidePointTooltip();
    clearTableauHover();
  }, { once: true });
}
