import type { DataTable, DataValue } from '@tableau/extensions-api-types/ExternalContract/Shared/DataTableInterfaces';
import { TableCellValue, TableColumnConfig, TableRowData, mockTableData } from './mockData';
import type { SecondaryMetricConfig } from './mockData';
import { evaluateCustomFormula } from '../utils/formulaEngine';
import { computeSecondaryMetricValue } from '../utils/secondaryMetric';

let latestTableauFieldNames: string[] = [];
function normalizeKey(value: string): string { 
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Strips Tableau aggregation wrappers: 'ATTR(sport_depa)' → 'sport_depa', 'MOIS(date)' → 'date'.
function stripTableauFunctionWrapper(fieldName: string): string {
  const firstParen = fieldName.indexOf('(');
  const lastParen = fieldName.lastIndexOf(')');
  if (firstParen > 0 && lastParen > firstParen && /^[A-Z_]+$/.test(fieldName.slice(0, firstParen).trim())) {
    return fieldName.slice(firstParen + 1, lastParen).trim();
  }
  return fieldName;
}

// Strips both ATTR() wrappers and table qualifiers: 'ATTR(sport_depa (table))' → 'sport_depa'.
function canonicalizeFieldName(fieldName: string): string {
  const stripped = stripTableauFunctionWrapper(fieldName);
  const spaceParenIdx = stripped.indexOf(' (');
  return spaceParenIdx > 0 ? stripped.slice(0, spaceParenIdx) : stripped;
}

function isDimensionLikeDataType(dataType: unknown): boolean {
  const kind = String(dataType ?? '').toLowerCase();
  return kind.includes('string')
    || kind.includes('str')
    || kind.includes('date')
    || kind.includes('time')
    || kind.includes('bool');
}

function getCellNativeValue(cell: DataValue | undefined): unknown {
  if (!cell) {
    return null;
  }

  if (cell.nativeValue !== undefined && cell.nativeValue !== null) {
    return cell.nativeValue;
  }

  if (cell.value !== undefined && cell.value !== null) {
    return cell.value;
  }

  return cell.formattedValue ?? null;
}

function getStringValue(cell: DataValue | undefined, fallback = ''): string {
  const value = getCellNativeValue(cell);
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function getNumberArrayValue(cell: DataValue | undefined): number[] {
  const value = getCellNativeValue(cell);
  if (Array.isArray(value)) {
    return value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
  }
  if (typeof value !== 'string') {
    return [];
  }

  if (!/[;|]/.test(value)) {
    return [];
  }

  return value
    .split(/[;|]/)
    .map((chunk) => Number(chunk.trim().replace(',', '.')))
    .filter((entry) => Number.isFinite(entry));
}

function getStringArrayValue(cell: DataValue | undefined): string[] {
  const value = getCellNativeValue(cell);
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value !== 'string') {
    return [];
  }

  if (!/[;|]/.test(value)) {
    return [];
  }

  return value
    .split(/[;|]/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function getTableCellValue(columnKey: string, cell: DataValue | undefined): TableCellValue | undefined {
  const rawValue = getCellNativeValue(cell);

  if (rawValue === null || rawValue === undefined) {
    return undefined;
  }

  if (rawValue instanceof Date) {
    return rawValue.toISOString();
  }

  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return rawValue;
  }

  if (typeof rawValue === 'string') {
    if (columnKey.includes('date')) {
      const values = getStringArrayValue(cell);
      return values.length > 0 ? values : rawValue;
    }

    if (columnKey.includes('trend') || columnKey.includes('serie') || columnKey.includes('series')) {
      const numericValues = getNumberArrayValue(cell);
      if (numericValues.length > 1) {
        return numericValues;
      }

      const parsedNumeric = Number(rawValue.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(parsedNumeric) ? parsedNumeric : rawValue;
    }

    return rawValue;
  }

  if (Array.isArray(rawValue)) {
    return rawValue as TableCellValue;
  }

  return String(rawValue);
}

function resolveLabelIndex(summaryData: DataTable, normalizedColumns: string[]): number {
  // Exact match only — 'modellabel'.endsWith('label') must not fire as a false positive.
  const exactIndex = normalizedColumns.findIndex((col) => col === 'label' || col === 'libelle' || col === 'name');
  if (exactIndex >= 0) {
    return exactIndex;
  }

  const stringColumnIndex = summaryData.columns.findIndex((column) => column.dataType === 'string');
  if (stringColumnIndex >= 0) {
    return stringColumnIndex;
  }

  return summaryData.columns.length > 0 ? 0 : -1;
}

function buildDisplayGroupingFields(summaryData: DataTable, _columns: TableColumnConfig[], labelFieldName: string): string[] {
  const groupingFields = new Set<string>([labelFieldName]);

  // Keep grouping fully independent from configurable columns.
  // Use only dimension-like source fields from Tableau metadata.
  summaryData.columns.forEach((summaryColumn) => {
    const fieldName = summaryColumn.fieldName;
    const dataType = String(summaryColumn.dataType).toLowerCase();
    if (dataType === 'string' || dataType === 'date' || dataType === 'datetime' || dataType === 'bool' || dataType === 'boolean') {
      groupingFields.add(fieldName);
    }
  });

  return Array.from(groupingFields);
}

function getNumericValue(value: TableCellValue | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function getStringFromCellValue(value: TableCellValue | undefined, fallback = ''): string {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]) : fallback;
  }

  return String(value);
}

function getNumberFromCellValue(value: TableCellValue | undefined, fallback = 0): number {
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

function findHierarchyColumn(columns: TableColumnConfig[]): Extract<TableColumnConfig, { type: 'hierarchy' }> | undefined {
  return columns.find((column): column is Extract<TableColumnConfig, { type: 'hierarchy' }> => column.type === 'hierarchy');
}

function getHierarchyLevelValues(row: TableRowData, hierarchyColumn: Extract<TableColumnConfig, { type: 'hierarchy' }>): string[] {
  const resolveField = (fieldName: string): string => {
    if (!fieldName) return '';
    const norm = normalizeKey(fieldName);
    const direct = row.values[fieldName];
    if (direct !== undefined) return getStringFromCellValue(direct);
    const byNorm = row.values[norm];
    if (byNorm !== undefined) return getStringFromCellValue(byNorm);
    // Full scan: handles any qualified Tableau field name format.
    for (const [key, value] of Object.entries(row.values)) {
      if (value === undefined) continue;
      if (normalizeKey(key) === norm) return getStringFromCellValue(value);
      const lastSeg = key.split(/[.\[\]]+/).filter(Boolean).pop() ?? '';
      if (lastSeg === fieldName || normalizeKey(lastSeg) === norm) return getStringFromCellValue(value);
      // Strip ATTR() or other Tableau function wrappers from stored keys.
      const stripped = stripTableauFunctionWrapper(key);
      if (stripped !== key && (stripped === fieldName || normalizeKey(stripped) === norm)) return getStringFromCellValue(value);
      // Canonical: strip both ATTR() wrapper and table qualifier 'field (table)' → 'field'.
      const canonical = canonicalizeFieldName(key);
      if (canonical !== key && (canonical === fieldName || normalizeKey(canonical) === norm)) return getStringFromCellValue(value);
    }
    return '';
  };

  const maxLevelCount = Math.max(1, Math.min(6, hierarchyColumn.levelCount ?? 3));
  const rawLevels = [
    resolveField(hierarchyColumn.level1Field),
    resolveField(hierarchyColumn.level2Field ?? ''),
    resolveField(hierarchyColumn.level3Field ?? ''),
    resolveField(hierarchyColumn.level4Field ?? ''),
    resolveField(hierarchyColumn.level5Field ?? ''),
    resolveField(hierarchyColumn.level6Field ?? '')
  ];

  return rawLevels
    .map((level) => level.trim())
    .filter((level) => level.length > 0)
    .slice(0, maxLevelCount);
}

function aggregateTextField(rows: TableRowData[], field: string): TableCellValue | undefined {
  const values = rows
    .map((row) => row.values[field])
    .filter((value): value is TableCellValue => value !== undefined);

  if (values.length === 0) {
    return undefined;
  }

  const numericValues = values
    .map((value) => getNumberFromCellValue(value, Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (numericValues.length === values.length) {
    return numericValues.reduce((sum, value) => sum + value, 0);
  }

  const uniqueValues = Array.from(new Set(values.map((value) => getStringFromCellValue(value))));
  return uniqueValues.length === 1 ? uniqueValues[0] : uniqueValues[0];
}

function aggregateSeriesByDate(
  rows: TableRowData[],
  dateField: string,
  primaryMetricField: string,
  secondaryMetricField: string
): { dates: string[]; primary: number[]; secondary: number[] } {
  const aggregates = new Map<string, { primary: number; secondary: number; order: number }>();

  rows.forEach((row, rowIndex) => {
    const rawDate = asDisplayDate(row.values[dateField]);
    const dateKey = String(rawDate);
    const existing = aggregates.get(dateKey);
    const primary = getNumericValue(row.values[primaryMetricField]);
    const secondary = getNumericValue(row.values[secondaryMetricField]);

    if (existing) {
      existing.primary += primary;
      existing.secondary += secondary;
      return;
    }

    aggregates.set(dateKey, {
      primary,
      secondary,
      order: rowIndex
    });
  });

  const orderedEntries = Array.from(aggregates.entries()).sort((left, right) => {
    const leftTime = getSortableTime(left[0]);
    const rightTime = getSortableTime(right[0]);

    if (leftTime === rightTime) {
      return left[1].order - right[1].order;
    }

    return leftTime - rightTime;
  });

  return {
    dates: orderedEntries.map(([date]) => date),
    primary: orderedEntries.map(([, aggregate]) => aggregate.primary),
    secondary: orderedEntries.map(([, aggregate]) => aggregate.secondary)
  };
}

function applyConfiguredHierarchy(
  rows: TableRowData[],
  hierarchyColumn: Extract<TableColumnConfig, { type: 'hierarchy' }>,
  columns: TableColumnConfig[]
): TableRowData[] {
  type HierarchyNode = {
    id: string;
    parentId?: string;
    label: string;
    level: number;
    hasChildren: boolean;
    sourceRows: TableRowData[];
  };

  const nodesById = new Map<string, HierarchyNode>();
  const childrenByParent = new Map<string, string[]>();
  const rootIds: string[] = [];

  rows.forEach((row) => {
    const levels = getHierarchyLevelValues(row, hierarchyColumn);
    if (levels.length === 0) {
      return;
    }

    let parentId: string | undefined;
    levels.forEach((label, depth) => {
      const currentId = levels.slice(0, depth + 1).join('||');
      let node = nodesById.get(currentId);
      if (!node) {
        node = {
          id: currentId,
          parentId,
          label,
          level: depth,
          hasChildren: false,
          sourceRows: []
        };
        nodesById.set(currentId, node);

        if (parentId) {
          const children = childrenByParent.get(parentId) ?? [];
          children.push(currentId);
          childrenByParent.set(parentId, children);
        } else {
          rootIds.push(currentId);
        }
      }

      node.sourceRows.push(row);
      if (parentId) {
        const parentNode = nodesById.get(parentId);
        if (parentNode) {
          parentNode.hasChildren = true;
        }
      }

      parentId = currentId;
    });
  });

  const orderedNodeIds: string[] = [];
  const appendNode = (nodeId: string): void => {
    orderedNodeIds.push(nodeId);
    const children = childrenByParent.get(nodeId) ?? [];
    children.forEach(appendNode);
  };
  rootIds.forEach(appendNode);

  return orderedNodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is HierarchyNode => Boolean(node))
    .map((node) => {
      const values: Record<string, TableCellValue | undefined> = {};

      columns.forEach((column) => {
        if (column.type === 'hierarchy') {
          values[column.level1Field] = node.label;
          return;
        }

        if (column.type === 'text') {
          if (column.valueField === '__custom_formula__' && (column as any).customFormula) {
            // 1. Cumul des sous-totaux des mesures brutes (Profit, Sales...) pour le nœud
            const nodeSums: Record<string, number> = {};
            node.sourceRows.forEach((sourceRow) => {
              Object.entries(sourceRow.values).forEach(([k, v]) => {
                nodeSums[k] = (nodeSums[k] ?? 0) + getNumericValue(v);
              });
            });

            // 2. Évaluation de la formule sur les sous-totaux cumulés
            values[column.valueField] = evaluateCustomFormula((column as any).customFormula, nodeSums);
          } else {
            values[column.valueField] = aggregateTextField(node.sourceRows, column.valueField);
          }

          if (column.secondaryMetric?.enabled) {
            const comparisonValue = resolveHierarchyComparisonValue(column.secondaryMetric, node.sourceRows);
            values[getDerivedDeltaKey(column.id)] = computeSecondaryMetricValue(
              getNumericValue(values[column.valueField]),
              comparisonValue,
              column.secondaryMetric.calculationType
            );
          }

          return;
        }

        if (column.type === 'bar') {
          if (column.valueField === '__custom_formula__' && (column as any).customFormula) {
            // 1. Cumul des sous-totaux des mesures brutes pour le nœud
            const nodeSums: Record<string, number> = {};
            node.sourceRows.forEach((sourceRow) => {
              Object.entries(sourceRow.values).forEach(([k, v]) => {
                nodeSums[k] = (nodeSums[k] ?? 0) + getNumericValue(v);
              });
            });

            // 2. Évaluation de la formule sur les sous-totaux
            values[getDerivedBarKey(column.id, 'value')] = evaluateCustomFormula((column as any).customFormula, nodeSums);
          } else {
            values[getDerivedBarKey(column.id, 'value')] = node.sourceRows.reduce(
              (sum, sourceRow) => sum + getNumericValue(sourceRow.values[column.valueField]),
              0
            );
          }

          if (column.maxField) {
            const maxField = column.maxField;
            values[getDerivedBarKey(column.id, 'max')] = node.sourceRows.reduce((max, sourceRow) => {
              const candidate = getNumericValue(sourceRow.values[maxField]);
              return Math.max(max, candidate);
            }, 0);
          }

          if (column.secondaryMetric?.enabled) {
            const comparisonValue = resolveHierarchyComparisonValue(column.secondaryMetric, node.sourceRows);
            values[getDerivedDeltaKey(column.id)] = computeSecondaryMetricValue(
              getNumericValue(values[getDerivedBarKey(column.id, 'value')]),
              comparisonValue,
              column.secondaryMetric.calculationType
            );
          }

          return;
        }

        const aggregatedSeries = aggregateSeriesByDate(
          node.sourceRows,
          column.dateField,
          column.primaryMetricField,
          column.compare === false ? '' : column.secondaryMetricField
        );

        values[getDerivedSeriesKey(column.id, 'date')] = aggregatedSeries.dates;
        values[getDerivedSeriesKey(column.id, 'primary')] = aggregatedSeries.primary;
        values[getDerivedSeriesKey(column.id, 'secondary')] = aggregatedSeries.secondary;
      });

      return {
        id: node.id,
        tupleId: node.sourceRows[0]?.tupleId,
        parentId: node.parentId,
        label: node.label,
        level: node.level,
        hasChildren: node.hasChildren,
        values
      } satisfies TableRowData;
    });
}

function getSortableTime(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
  }

  return Number.MAX_SAFE_INTEGER;
}

function asDisplayDate(value: TableCellValue | undefined): string | number {
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === undefined) {
    return '';
  }

  return String(value);
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

// Resolves the N-1 comparison value from a node's raw source rows (hierarchy path only).
function resolveHierarchyComparisonValue(config: SecondaryMetricConfig, sourceRows: TableRowData[]): number | undefined {
  if (config.sourceType === 'formula') {
    if (!config.comparisonFormula || !config.comparisonFormula.trim()) {
      return undefined;
    }

    const nodeSums: Record<string, number> = {};
    sourceRows.forEach((sourceRow) => {
      Object.entries(sourceRow.values).forEach(([k, v]) => {
        nodeSums[k] = (nodeSums[k] ?? 0) + getNumericValue(v);
      });
    });

    return evaluateCustomFormula(config.comparisonFormula, nodeSums);
  }

  const field = config.comparisonField;
  if (!field) {
    return undefined;
  }

  const fieldExists = sourceRows.some((sourceRow) => sourceRow.values[field] !== undefined);
  if (!fieldExists) {
    return undefined;
  }

  return sourceRows.reduce((sum, sourceRow) => sum + getNumericValue(sourceRow.values[field]), 0);
}

// Resolves the N-1 comparison value from an already-aggregated values map (flat/grouped path).
function resolveFlatComparisonValue(
  config: SecondaryMetricConfig,
  values: Record<string, TableCellValue | undefined>
): number | undefined {
  if (config.sourceType === 'formula') {
    if (!config.comparisonFormula || !config.comparisonFormula.trim()) {
      return undefined;
    }

    return evaluateCustomFormula(config.comparisonFormula, values);
  }

  const field = config.comparisonField;
  if (!field || values[field] === undefined) {
    return undefined;
  }

  return getNumericValue(values[field]);
}

let latestTotalRowCount = 0;
let latestWasCapped = false;
let onPageProgress: ((processedRows: number, totalRows: number) => void) | null = null;

export function setPageLoadProgressCallback(cb: ((processedRows: number, totalRows: number) => void) | null): void {
  onPageProgress = cb;
}

export function getLatestTotalRowCount(): number {
  return latestTotalRowCount;
}

export function getLatestWasCapped(): boolean {
  return latestWasCapped;
}

interface AggEntry {
  representativeTupleId?: number;
  label: string;
  seqIndex: number;
  values: Record<string, TableCellValue | undefined>;
  numericSums: Record<string, number>;
  barAcc: Record<string, { value: number; max: number }>;
  seriesAcc: Record<string, Map<string, { primary: number; secondary: number }>>;
}

type SourceColumnMeta = {
  fieldName: string;
  dataType: unknown;
};

type SourceColumnProjection = SourceColumnMeta & {
  sourceIndex: number;
  normKey: string;
};

type IndexedSourceColumnMeta = SourceColumnMeta & {
  sourceIndex: number;
};

type SourceRow = {
  tupleId?: number;
  label: string;
  values: Record<string, TableCellValue | undefined>;
};

type SourceCache = {
  columns: SourceColumnMeta[];
  availableFieldNames: string[];
  rows: SourceRow[];
  labelFieldName: string;
  containsAllMeasures: boolean;
};

let sourceCache: SourceCache | null = null;

// Groups by hierarchy levels + date fields only; text columns are aggregated, never used as grouping keys.
// Without this, adding model_label creates 466k groups (one per mark) instead of ~2k (one per family/month).
function resolveGroupingFields(summaryData: DataTable, columns: TableColumnConfig[], labelFieldName: string): string[] {
  const hierarchyCol = columns.find((c): c is Extract<TableColumnConfig, { type: 'hierarchy' }> => c.type === 'hierarchy');

  if (hierarchyCol) {
    const fields = new Set<string>();
    const hierarchyLevelCount = Math.max(1, Math.min(6, hierarchyCol.levelCount ?? 3));
    ([hierarchyCol.level1Field, hierarchyCol.level2Field, hierarchyCol.level3Field, hierarchyCol.level4Field, hierarchyCol.level5Field, hierarchyCol.level6Field] as Array<string | undefined>)
      .slice(0, hierarchyLevelCount)
      .filter((f): f is string => Boolean(f))
      .forEach((f) => fields.add(f));

    columns
      .filter((c): c is Extract<TableColumnConfig, { type: 'dual-line' }> => c.type === 'dual-line')
      .forEach((c) => fields.add(c.dateField));

    const result = Array.from(fields).filter(Boolean);
    if (result.length > 0) return result;
  }

  return buildDisplayGroupingFields(summaryData, columns, labelFieldName);
}

function buildValueMapFromDataRow(
  row: DataValue[],
  columnProjections: SourceColumnProjection[]
): Record<string, TableCellValue | undefined> {
  const values: Record<string, TableCellValue | undefined> = {};

  columnProjections.forEach((columnProjection) => {
    const rawName = columnProjection.fieldName;
    const normKey = columnProjection.normKey;
    const v = getTableCellValue(normKey, row[columnProjection.sourceIndex]);
    values[rawName] = v;
  });

  return values;
}

function buildSourceColumnProjections(columns: IndexedSourceColumnMeta[]): SourceColumnProjection[] {
  return columns.map((column) => {
    const fieldName = column.fieldName;
    const normKey = normalizeKey(fieldName);

    return {
      fieldName,
      dataType: column.dataType,
      sourceIndex: column.sourceIndex,
      normKey
    };
  });
}

function getFieldAliasKeys(fieldName: string): string[] {
  const keys = new Set<string>();
  const push = (value: string): void => {
    if (value) {
      keys.add(value);
    }
  };

  push(fieldName);
  push(normalizeKey(fieldName));

  const lastSeg = fieldName.split(/[.\[\]]+/).filter(Boolean).pop() ?? '';
  push(lastSeg);
  push(normalizeKey(lastSeg));

  const stripped = stripTableauFunctionWrapper(fieldName);
  push(stripped);
  push(normalizeKey(stripped));

  const canonical = canonicalizeFieldName(fieldName);
  push(canonical);
  push(normalizeKey(canonical));

  return Array.from(keys);
}

function buildSourceFieldLookup(columns: SourceColumnMeta[]): Map<string, string> {
  const lookup = new Map<string, string>();

  columns.forEach((column) => {
    getFieldAliasKeys(column.fieldName).forEach((aliasKey) => {
      if (!lookup.has(aliasKey)) {
        lookup.set(aliasKey, column.fieldName);
      }
    });
  });

  return lookup;
}

function resolveSourceFieldName(fieldName: string, fieldLookup: Map<string, string>): string {
  if (!fieldName) {
    return '';
  }

  return fieldLookup.get(fieldName)
    ?? fieldLookup.get(normalizeKey(fieldName))
    ?? fieldName;
}

function resolveFieldIndex(columns: SourceColumnMeta[], requestedField: string): number {
  if (!requestedField) {
    return -1;
  }

  const normalized = normalizeKey(requestedField);

  let index = columns.findIndex((column) => column.fieldName === requestedField);
  if (index >= 0) {
    return index;
  }

  index = columns.findIndex((column) => normalizeKey(column.fieldName) === normalized);
  if (index >= 0) {
    return index;
  }

  index = columns.findIndex((column) => {
    const lastSeg = column.fieldName.split(/[.\[\]]+/).filter(Boolean).pop() ?? '';
    return lastSeg === requestedField || normalizeKey(lastSeg) === normalized;
  });
  if (index >= 0) {
    return index;
  }

  index = columns.findIndex((column) => {
    const stripped = stripTableauFunctionWrapper(column.fieldName);
    return stripped !== column.fieldName && (stripped === requestedField || normalizeKey(stripped) === normalized);
  });
  if (index >= 0) {
    return index;
  }

  return columns.findIndex((column) => {
    const canonical = canonicalizeFieldName(column.fieldName);
    return canonical !== column.fieldName && (canonical === requestedField || normalizeKey(canonical) === normalized);
  });
}

function hasCustomFormulaColumn(columns: TableColumnConfig[]): boolean {
  return columns.some((column) => {
    if (column.type !== 'text' && column.type !== 'bar') {
      return false;
    }

    return column.valueField === '__custom_formula__'
      && typeof (column as any).customFormula === 'string'
      && (column as any).customFormula.trim().length > 0;
  });
}

function getRequiredSourceFields(columns: TableColumnConfig[]): string[] {
  const fields = new Set<string>();

  columns.forEach((column) => {
    if (column.type === 'text') {
      if (column.valueField && column.valueField !== '__custom_formula__') {
        fields.add(column.valueField);
      }
      if (column.secondaryMetric?.enabled && column.secondaryMetric.sourceType === 'field' && column.secondaryMetric.comparisonField) {
        fields.add(column.secondaryMetric.comparisonField);
      }
      return;
    }

    if (column.type === 'bar') {
      if (column.valueField && column.valueField !== '__custom_formula__') {
        fields.add(column.valueField);
      }
      if (column.maxField) {
        fields.add(column.maxField);
      }
      if (column.secondaryMetric?.enabled && column.secondaryMetric.sourceType === 'field' && column.secondaryMetric.comparisonField) {
        fields.add(column.secondaryMetric.comparisonField);
      }
      return;
    }

    if (column.type === 'dual-line') {
      fields.add(column.dateField);
      fields.add(column.primaryMetricField);
      if (column.compare !== false && column.secondaryMetricField) {
        fields.add(column.secondaryMetricField);
      }
      return;
    }

    fields.add(column.level1Field);
    const hierarchyLevelCount = Math.max(1, Math.min(6, column.levelCount ?? 3));
    if (hierarchyLevelCount >= 2 && column.level2Field) {
      fields.add(column.level2Field);
    }
    if (hierarchyLevelCount >= 3 && column.level3Field) {
      fields.add(column.level3Field);
    }
    if (hierarchyLevelCount >= 4 && column.level4Field) {
      fields.add(column.level4Field);
    }
    if (hierarchyLevelCount >= 5 && column.level5Field) {
      fields.add(column.level5Field);
    }
    if (hierarchyLevelCount >= 6 && column.level6Field) {
      fields.add(column.level6Field);
    }
  });

  return Array.from(fields);
}

function sourceCacheSatisfiesColumns(columns: TableColumnConfig[]): boolean {
  const cache = sourceCache;
  if (!cache) {
    return false;
  }

  if (hasCustomFormulaColumn(columns) && !cache.containsAllMeasures) {
    return false;
  }

  return getRequiredSourceFields(columns).every((fieldName) => resolveFieldIndex(cache.columns, fieldName) >= 0);
}

export function canProjectColumnsFromSourceCache(columns: TableColumnConfig[]): boolean {
  return sourceCacheSatisfiesColumns(columns);
}

function projectRowsFromSourceCache(columns: TableColumnConfig[]): TableRowData[] {
  if (!sourceCache) {
    return [];
  }

  const summaryShape = {
    columns: sourceCache.columns,
    data: []
  } as unknown as DataTable;

  const sourceFieldLookup = buildSourceFieldLookup(sourceCache.columns);
  const groupingFields = resolveGroupingFields(summaryShape, columns, sourceCache.labelFieldName);
  const groupingFieldKeys = groupingFields.map((field) => resolveSourceFieldName(field, sourceFieldLookup));
  const groupingFieldSet = new Set(groupingFieldKeys);

  const barResolutions = columns
    .filter((c): c is Extract<TableColumnConfig, { type: 'bar' }> => c.type === 'bar')
    .map((c) => ({
      id: c.id,
      valueFieldKey: resolveSourceFieldName(c.valueField, sourceFieldLookup),
      maxFieldKey: c.maxField ? resolveSourceFieldName(c.maxField, sourceFieldLookup) : ''
    }));

  const seriesResolutions = columns
    .filter((c): c is Extract<TableColumnConfig, { type: 'dual-line' }> => c.type === 'dual-line')
    .map((c) => ({
      id: c.id,
      dateFieldKey: resolveSourceFieldName(c.dateField, sourceFieldLookup),
      primaryFieldKey: resolveSourceFieldName(c.primaryMetricField, sourceFieldLookup),
      secondaryFieldKey: c.compare === false ? '' : resolveSourceFieldName(c.secondaryMetricField, sourceFieldLookup)
    }));

  const measureColumns = sourceCache.columns
    .filter((column) => !groupingFieldSet.has(column.fieldName) && !isDimensionLikeDataType(column.dataType))
    .map((column) => ({
      fieldName: column.fieldName,
      aliasKeys: getFieldAliasKeys(column.fieldName)
    }));

  const agg = new Map<string, AggEntry>();
  let seqCounter = 0;

  for (const sourceRow of sourceCache.rows) {
    const groupKey = groupingFieldKeys
      .map((fieldKey) => getStringFromCellValue(sourceRow.values[fieldKey], ''))
      .join('\x00');

    let entry = agg.get(groupKey);
    if (!entry) {
      entry = {
        representativeTupleId: sourceRow.tupleId,
        label: sourceRow.label || `Ligne ${seqCounter + 1}`,
        seqIndex: seqCounter++,
        values: { ...sourceRow.values },
        numericSums: Object.create(null) as Record<string, number>,
        barAcc: {},
        seriesAcc: {}
      };
      agg.set(groupKey, entry);
    }

    for (const measureColumn of measureColumns) {
      const numVal = getNumericValue(sourceRow.values[measureColumn.fieldName]);
      if (!Number.isFinite(numVal)) {
        continue;
      }

      for (const key of measureColumn.aliasKeys) {
        entry.numericSums[key] = (entry.numericSums[key] ?? 0) + numVal;
      }
    }

    for (const { id, valueFieldKey, maxFieldKey } of barResolutions) {
      const value = getNumericValue(sourceRow.values[valueFieldKey]);
      const maxValue = maxFieldKey ? getNumericValue(sourceRow.values[maxFieldKey]) : 0;
      const acc = entry.barAcc[id] ?? { value: 0, max: 0 };
      acc.value += value;
      if (maxFieldKey) {
        acc.max = Math.max(acc.max, maxValue);
      }
      entry.barAcc[id] = acc;
    }

    for (const { id, dateFieldKey, primaryFieldKey, secondaryFieldKey } of seriesResolutions) {
      const dateKey = String(asDisplayDate(sourceRow.values[dateFieldKey]));
      const primary = getNumericValue(sourceRow.values[primaryFieldKey]);
      const secondary = getNumericValue(sourceRow.values[secondaryFieldKey]);
      let seriesMap = entry.seriesAcc[id];
      if (!seriesMap) {
        seriesMap = new Map();
        entry.seriesAcc[id] = seriesMap;
      }
      const pt = seriesMap.get(dateKey) ?? { primary: 0, secondary: 0 };
      pt.primary += primary;
      pt.secondary += secondary;
      seriesMap.set(dateKey, pt);
    }
  }

  const projectedRows = Array.from(agg.values())
    .sort((a, b) => a.seqIndex - b.seqIndex)
    .map((entry, idx) => {
      const values: Record<string, TableCellValue | undefined> = { ...entry.values };

      Object.entries(entry.numericSums).forEach(([key, sum]) => {
        values[key] = sum;
      });

      for (const { id, maxFieldKey } of barResolutions) {
        const acc = entry.barAcc[id];
        if (acc) {
          values[getDerivedBarKey(id, 'value')] = acc.value;
          if (maxFieldKey) values[getDerivedBarKey(id, 'max')] = acc.max;
        }
      }

      for (const { id } of seriesResolutions) {
        const seriesMap = entry.seriesAcc[id];
        if (seriesMap) {
          const sorted = Array.from(seriesMap.entries())
            .sort(([a], [b]) => getSortableTime(a) - getSortableTime(b));
          values[getDerivedSeriesKey(id, 'date')] = sorted.map(([d]) => d);
          values[getDerivedSeriesKey(id, 'primary')] = sorted.map(([, v]) => v.primary);
          values[getDerivedSeriesKey(id, 'secondary')] = sorted.map(([, v]) => v.secondary);
        }
      }

      columns.forEach((column) => {
        if (column.type === 'text' && column.valueField === '__custom_formula__' && (column as any).customFormula) {
          values[column.valueField] = evaluateCustomFormula((column as any).customFormula, values);
        }

        if (column.type === 'bar' && column.valueField === '__custom_formula__' && (column as any).customFormula) {
          values[getDerivedBarKey(column.id, 'value')] = evaluateCustomFormula((column as any).customFormula, values);
        }

        if (column.type === 'text' && column.secondaryMetric?.enabled) {
          const comparisonValue = resolveFlatComparisonValue(column.secondaryMetric, values);
          values[getDerivedDeltaKey(column.id)] = computeSecondaryMetricValue(
            getNumericValue(values[column.valueField]),
            comparisonValue,
            column.secondaryMetric.calculationType
          );
        }

        if (column.type === 'bar' && column.secondaryMetric?.enabled) {
          const comparisonValue = resolveFlatComparisonValue(column.secondaryMetric, values);
          values[getDerivedDeltaKey(column.id)] = computeSecondaryMetricValue(
            getNumericValue(values[getDerivedBarKey(column.id, 'value')]),
            comparisonValue,
            column.secondaryMetric.calculationType
          );
        }
      });

      return {
        id: `row-${idx}`,
        tupleId: entry.representativeTupleId,
        label: entry.label,
        level: 0,
        hasChildren: false,
        values
      } satisfies TableRowData;
    });

  const hierarchyColumn = findHierarchyColumn(columns);
  return hierarchyColumn ? applyConfiguredHierarchy(projectedRows, hierarchyColumn, columns) : projectedRows;
}

export async function fetchTableauData(
  columns: TableColumnConfig[],
  options?: { forceRefresh?: boolean }
): Promise<TableRowData[]> {
  const forceRefresh = options?.forceRefresh ?? false;

  if (!window.tableau?.extensions?.worksheetContent?.worksheet) {
    latestTableauFieldNames = [];
    latestTotalRowCount = 0;
    latestWasCapped = false;
    sourceCache = null;
    return mockTableData;
  }

  const cache = sourceCache;
  if (!forceRefresh && cache && sourceCacheSatisfiesColumns(columns)) {
    latestTableauFieldNames = [...cache.availableFieldNames];
    latestTotalRowCount = cache.rows.length;
    latestWasCapped = false;
    const projected = projectRowsFromSourceCache(columns);
    return projected.length > 0 ? projected : mockTableData;
  }

  const worksheet = window.tableau.extensions.worksheetContent.worksheet;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = await (worksheet as any).getSummaryDataReaderAsync() as {
    totalRowCount: number;
    pageRowCount: number;
    getPageAsync(n: number): Promise<DataTable>;
    releaseAsync(): Promise<void>;
  };

  try {
    latestTotalRowCount = reader.totalRowCount;
    latestWasCapped = false;

    if (latestTotalRowCount === 0) {
      console.warn('The Tableau worksheet returned no rows; falling back to mock data.');
      return mockTableData;
    }

    // Calcule dynamiquement le nombre de pages en fonction de la taille de tranche de Tableau
    const pageRowCount = reader.pageRowCount || 10000;
    const totalPages = Math.ceil(latestTotalRowCount / pageRowCount);

    const firstPage = await reader.getPageAsync(0);
    const allColumns = firstPage.columns.map((column) => ({
      fieldName: column.fieldName,
      dataType: column.dataType
    }));
    latestTableauFieldNames = Array.from(new Set(allColumns.map((c) => c.fieldName)));

    const normalizedCols = allColumns.map((column) => normalizeKey(column.fieldName));
    const labelIdx = resolveLabelIndex(firstPage, normalizedCols);
    const labelFieldName = allColumns[labelIdx]?.fieldName ?? '';
    const tableColumns = allColumns.map((column, index) => ({
      ...column,
      sourceIndex: index
    }));

    const columnProjections = buildSourceColumnProjections(tableColumns);
    const cachedRows: SourceRow[] = [];

    firstPage.data.forEach((row, rowIndex) => {
      const values = buildValueMapFromDataRow(row, columnProjections);
      const label = labelIdx >= 0 ? getStringValue(row[labelIdx], `Ligne ${rowIndex + 1}`) : `Ligne ${rowIndex + 1}`;
      cachedRows.push({ tupleId: rowIndex + 1, label, values });
    });

    onPageProgress?.(Math.min(pageRowCount, latestTotalRowCount), latestTotalRowCount);

    for (let pageNum = 1; pageNum < totalPages; pageNum++) {
      const page = await reader.getPageAsync(pageNum);
      page.data.forEach((row, rowIndex) => {
        const values = buildValueMapFromDataRow(row, columnProjections);
        const globalRowIndex = pageNum * pageRowCount + rowIndex;
        const label = labelIdx >= 0 ? getStringValue(row[labelIdx], `Ligne ${globalRowIndex + 1}`) : `Ligne ${globalRowIndex + 1}`;
        cachedRows.push({ tupleId: globalRowIndex + 1, label, values });
      });
      const processedRows = Math.min((pageNum + 1) * pageRowCount, latestTotalRowCount);
      onPageProgress?.(processedRows, latestTotalRowCount);
    }

    sourceCache = {
      columns: tableColumns,
      availableFieldNames: [...latestTableauFieldNames],
      rows: cachedRows,
      labelFieldName,
      containsAllMeasures: true
    };

    const rawRows = projectRowsFromSourceCache(columns);

    if (rawRows.length === 0) {
      console.warn('No matching Tableau columns found; falling back to mock data.');
      return mockTableData;
    }

    return rawRows;
  } finally {
    await reader.releaseAsync();
  }
}

export function getLatestTableauFieldNames(): string[] {
  return [...latestTableauFieldNames];
}