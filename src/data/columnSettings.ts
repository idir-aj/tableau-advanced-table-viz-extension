import type { TableColumnConfig } from './mockData';

const COLUMN_SETTINGS_KEY = 'advanced-table.columns';
const PRIMARY_COLUMN_SETTINGS_KEY = 'advanced-table.primary-column';
const COLUMN_WIDTHS_SETTINGS_KEY = 'advanced-table.column-widths';

export interface PrimaryColumnConfig {
  header: string;
  field: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const CONDITION_OPERATORS = new Set([
  'between',
  'not-between',
  'equal',
  'not-equal',
  'greater',
  'less',
  'greater-equal',
  'less-equal'
]);

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isValidConditionRule(value: unknown, kind: 'bar' | 'text'): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const validCommon = typeof value.id === 'string'
    && typeof value.operator === 'string'
    && CONDITION_OPERATORS.has(value.operator)
    && (value.value === undefined || (typeof value.value === 'number' && Number.isFinite(value.value)))
    && (value.min === undefined || (typeof value.min === 'number' && Number.isFinite(value.min)))
    && (value.max === undefined || (typeof value.max === 'number' && Number.isFinite(value.max)));

  if (!validCommon) {
    return false;
  }

  const validTextColor = value.textColor === undefined || (typeof value.textColor === 'string' && HEX_COLOR_PATTERN.test(value.textColor));

  if (kind === 'bar') {
    const validBarColor = value.barColor === undefined || (typeof value.barColor === 'string' && HEX_COLOR_PATTERN.test(value.barColor));
    return validBarColor && validTextColor;
  }

  const validShading = value.shading === undefined || (typeof value.shading === 'string' && HEX_COLOR_PATTERN.test(value.shading));
  return validTextColor && validShading;
}

function isValidConditionRules(value: unknown, kind: 'bar' | 'text'): boolean {
  return value === undefined || (Array.isArray(value) && value.every((rule) => isValidConditionRule(rule, kind)));
}

function isValidSecondaryMetricConfig(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return typeof value.enabled === 'boolean'
    && (value.sourceType === 'field' || value.sourceType === 'formula')
    && (value.comparisonField === undefined || typeof value.comparisonField === 'string')
    && (value.comparisonFormula === undefined || typeof value.comparisonFormula === 'string')
    && (value.calculationType === 'PERCENTAGE' || value.calculationType === 'POINTS' || value.calculationType === 'ABSOLUTE')
    && (value.colorMode === 'auto' || value.colorMode === 'inverted' || value.colorMode === 'none')
    && typeof value.decimals === 'number' && Number.isFinite(value.decimals) && value.decimals >= 0 && value.decimals <= 6;
}

function isTextColumnConfig(value: unknown): value is Extract<TableColumnConfig, { type: 'text' }> {
  const validAlignment = value && isRecord(value)
    ? value.alignment === undefined || value.alignment === 'left' || value.alignment === 'center' || value.alignment === 'right'
    : false;

  const validFormatStyle = value && isRecord(value)
    ? value.formatStyle === undefined || value.formatStyle === 'number' || value.formatStyle === 'currency' || value.formatStyle === 'percent'
    : false;

  const validScale = value && isRecord(value)
    ? value.scale === undefined || value.scale === 'auto' || value.scale === 'none' || value.scale === 'k' || value.scale === 'm'
    : false;

  const validDecimals = value && isRecord(value)
    ? value.decimals === undefined || (typeof value.decimals === 'number' && Number.isFinite(value.decimals) && value.decimals >= 0 && value.decimals <= 6)
    : false;

  return isRecord(value)
    && value.type === 'text'
    && typeof value.id === 'string'
    && typeof value.header === 'string'
    && typeof value.valueField === 'string'
    && validAlignment
    && validDecimals
    && validFormatStyle
    && (value.currency === undefined || value.currency === 'EUR' || value.currency === 'USD' || value.currency === 'GBP')
    && validScale
    && (value.suffix === undefined || typeof value.suffix === 'string')
    && isValidConditionRules(value.conditions, 'text')
    && isValidSecondaryMetricConfig(value.secondaryMetric);
}

function isBarColumnConfig(value: unknown): value is Extract<TableColumnConfig, { type: 'bar' }> {
  const validBarColor = value && isRecord(value)
    ? value.barColor === undefined || (typeof value.barColor === 'string' && HEX_COLOR_PATTERN.test(value.barColor))
    : false;

  const validBarScale = value && isRecord(value)
    ? value.barScale === undefined || value.barScale === 'per-level' || value.barScale === 'relative-to-parent' || value.barScale === 'whole-table'
    : false;

  const validFormatStyle = value && isRecord(value)
    ? value.formatStyle === undefined || value.formatStyle === 'number' || value.formatStyle === 'currency' || value.formatStyle === 'percent'
    : false;

  const validScale = value && isRecord(value)
    ? value.scale === undefined || value.scale === 'auto' || value.scale === 'none' || value.scale === 'k' || value.scale === 'm'
    : false;

  const validDecimals = value && isRecord(value)
    ? value.decimals === undefined || (typeof value.decimals === 'number' && Number.isFinite(value.decimals) && value.decimals >= 0 && value.decimals <= 6)
    : false;

  return isRecord(value)
    && value.type === 'bar'
    && typeof value.id === 'string'
    && typeof value.header === 'string'
    && typeof value.valueField === 'string'
    && (value.maxField === undefined || typeof value.maxField === 'string')
    && validBarColor
    && validBarScale
    && validDecimals
    && validFormatStyle
    && (value.currency === undefined || value.currency === 'EUR' || value.currency === 'USD' || value.currency === 'GBP')
    && validScale
    && isValidConditionRules(value.conditions, 'bar')
    && isValidSecondaryMetricConfig(value.secondaryMetric);
}

function isDualLineColumnConfig(value: unknown): value is Extract<TableColumnConfig, { type: 'dual-line' }> {
  const validLine1Color = value && isRecord(value)
    ? value.line1Color === undefined || (typeof value.line1Color === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.line1Color))
    : false;

  const validLine2Color = value && isRecord(value)
    ? value.line2Color === undefined || (typeof value.line2Color === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.line2Color))
    : false;

  return isRecord(value)
    && value.type === 'dual-line'
    && typeof value.id === 'string'
    && typeof value.header === 'string'
    && typeof value.dateField === 'string'
    && typeof value.primaryMetricField === 'string'
    && typeof value.secondaryMetricField === 'string'
    && (value.compare === undefined || typeof value.compare === 'boolean')
    && (value.label2 === undefined || typeof value.label2 === 'string')
    && validLine1Color
    && validLine2Color;
}

function isHierarchyColumnConfig(value: unknown): value is Extract<TableColumnConfig, { type: 'hierarchy' }> {
  const validLevelCount = value && isRecord(value)
    ? value.levelCount === undefined
      || (typeof value.levelCount === 'number' && Number.isInteger(value.levelCount) && value.levelCount >= 1 && value.levelCount <= 6)
    : false;

  const validExpandTo = value && isRecord(value)
    ? value.expandTo === undefined || value.expandTo === 'level-1' || value.expandTo === 'level-2' || value.expandTo === 'level-3' || value.expandTo === 'all'
    : false;

  return isRecord(value)
    && value.type === 'hierarchy'
    && typeof value.id === 'string'
    && typeof value.header === 'string'
    && typeof value.level1Field === 'string'
    && (value.level2Field === undefined || typeof value.level2Field === 'string')
    && (value.level3Field === undefined || typeof value.level3Field === 'string')
    && (value.level4Field === undefined || typeof value.level4Field === 'string')
    && (value.level5Field === undefined || typeof value.level5Field === 'string')
    && (value.level6Field === undefined || typeof value.level6Field === 'string')
    && validLevelCount
    && validExpandTo;
}

function isTableColumnConfig(value: unknown): value is TableColumnConfig {
  return isTextColumnConfig(value)
    || isBarColumnConfig(value)
    || isDualLineColumnConfig(value)
    || isHierarchyColumnConfig(value);
}

function isPrimaryColumnConfig(value: unknown): value is PrimaryColumnConfig {
  return isRecord(value)
    && typeof value.header === 'string'
    && typeof value.field === 'string';
}

function isColumnWidthsConfig(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 60 && entry <= 2000
  );
}

export function getDefaultColumnSettings(): TableColumnConfig[] {
  return [];
}

export function getDefaultPrimaryColumnSettings(): PrimaryColumnConfig {
  return {
    header: 'Libelle',
    field: ''
  };
}

export function getDefaultColumnWidthsSettings(): Record<string, number> {
  return {};
}

export function serializeColumnSettings(columns: TableColumnConfig[]): string {
  return JSON.stringify(columns);
}

export function parseColumnSettings(rawValue: string | undefined): TableColumnConfig[] {
  if (!rawValue) {
    return getDefaultColumnSettings();
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return getDefaultColumnSettings();
    }

    const validColumns = parsed.filter(isTableColumnConfig);
    return validColumns;
  } catch {
    console.warn('Invalid column configuration found in Tableau settings.');
    return getDefaultColumnSettings();
  }
}

export function loadColumnSettingsFromTableau(): TableColumnConfig[] {
  const rawValue = window.tableau?.extensions?.settings?.get(COLUMN_SETTINGS_KEY);
  return parseColumnSettings(rawValue);
}

export function parseColumnWidthsSettings(rawValue: string | undefined): Record<string, number> {
  if (!rawValue) {
    return getDefaultColumnWidthsSettings();
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return isColumnWidthsConfig(parsed) ? parsed : getDefaultColumnWidthsSettings();
  } catch {
    console.warn('Invalid column widths configuration found in Tableau settings.');
    return getDefaultColumnWidthsSettings();
  }
}

export function loadColumnWidthsSettingsFromTableau(): Record<string, number> {
  const rawValue = window.tableau?.extensions?.settings?.get(COLUMN_WIDTHS_SETTINGS_KEY);
  return parseColumnWidthsSettings(rawValue);
}

export function parsePrimaryColumnSettings(rawValue: string | undefined): PrimaryColumnConfig {
  if (!rawValue) {
    return getDefaultPrimaryColumnSettings();
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return isPrimaryColumnConfig(parsed) ? parsed : getDefaultPrimaryColumnSettings();
  } catch {
    console.warn('Invalid primary column configuration found in Tableau settings.');
    return getDefaultPrimaryColumnSettings();
  }
}

export function loadPrimaryColumnSettingsFromTableau(): PrimaryColumnConfig {
  const rawValue = window.tableau?.extensions?.settings?.get(PRIMARY_COLUMN_SETTINGS_KEY);
  return parsePrimaryColumnSettings(rawValue);
}

export async function saveColumnSettingsToTableau(columns: TableColumnConfig[]): Promise<void> {
  const settings = window.tableau?.extensions?.settings;
  if (!settings) {
    throw new Error('Settings Tableau indisponibles.');
  }

  settings.set(COLUMN_SETTINGS_KEY, serializeColumnSettings(columns));
  await settings.saveAsync();
}

export async function savePrimaryColumnSettingsToTableau(primaryColumn: PrimaryColumnConfig): Promise<void> {
  const settings = window.tableau?.extensions?.settings;
  if (!settings) {
    throw new Error('Settings Tableau indisponibles.');
  }

  settings.set(PRIMARY_COLUMN_SETTINGS_KEY, JSON.stringify(primaryColumn));
  await settings.saveAsync();
}

export async function saveColumnWidthsSettingsToTableau(columnWidths: Record<string, number>): Promise<void> {
  const settings = window.tableau?.extensions?.settings;
  if (!settings) {
    throw new Error('Settings Tableau indisponibles.');
  }

  settings.set(COLUMN_WIDTHS_SETTINGS_KEY, JSON.stringify(columnWidths));
  await settings.saveAsync();
}

export function ensureDefaultColumnSettings(): void {
  const settings = window.tableau?.extensions?.settings;
  if (!settings || settings.get(COLUMN_SETTINGS_KEY)) {
    return;
  }

  settings.set(COLUMN_SETTINGS_KEY, serializeColumnSettings(getDefaultColumnSettings()));
}

export function ensureDefaultPrimaryColumnSettings(): void {
  const settings = window.tableau?.extensions?.settings;
  if (!settings || settings.get(PRIMARY_COLUMN_SETTINGS_KEY)) {
    return;
  }

  settings.set(PRIMARY_COLUMN_SETTINGS_KEY, JSON.stringify(getDefaultPrimaryColumnSettings()));
}

export function ensureDefaultColumnWidthsSettings(): void {
  const settings = window.tableau?.extensions?.settings;
  if (!settings || settings.get(COLUMN_WIDTHS_SETTINGS_KEY)) {
    return;
  }

  settings.set(COLUMN_WIDTHS_SETTINGS_KEY, JSON.stringify(getDefaultColumnWidthsSettings()));
}

export { COLUMN_SETTINGS_KEY, PRIMARY_COLUMN_SETTINGS_KEY, COLUMN_WIDTHS_SETTINGS_KEY };