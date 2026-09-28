import type {
  BarConditionalRule,
  BarScaleMode,
  ConditionOperator,
  HierarchyExpandTo,
  SecondaryMetricCalculationType,
  SecondaryMetricConfig,
  TableColumnConfig,
  TableRowData,
  TextConditionalRule
} from '../data/mockData';
import { evaluateCustomFormula } from '../utils/formulaEngine';
import { computeSecondaryMetricValue, formatSecondaryMetricLabel, getSecondaryMetricTone } from '../utils/secondaryMetric';
import { validateSecondaryMetricFormula } from '../utils/formulaValidation';
import { renderSparklineCell } from './sparklineRenderer';

interface ConfigPanelOptions {
  containerId: string;
  columns: TableColumnConfig[];
  rows: TableRowData[];
  availableFields?: string[];
  canPersist: boolean;
  onSave: (columns: TableColumnConfig[]) => Promise<void>;
  onReset: () => Promise<void>;
}

type ColumnType = TableColumnConfig['type'];
type ConditionRule = BarConditionalRule | TextConditionalRule;
type Dir = 'bad' | 'good';

const CUSTOM_FORMULA_FIELD = '__custom_formula__';
const BAR_COLOR_SWATCHES = [
  { value: '#0E7A68', label: 'Teal' },
  { value: '#3643BA', label: 'Blue' },
  { value: '#C26A00', label: 'Orange' },
  { value: '#5B6470', label: 'Grey' }
];

function sanitizeUiText(value: unknown): string {
  return String(value ?? '').replace(/[<>"'`]/g, '');
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function cloneColumn<T extends TableColumnConfig>(column: T): T {
  return JSON.parse(JSON.stringify(column)) as T;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultColumn(fields: string[]): TableColumnConfig {
  return {
    id: generateId('column'),
    header: `New column`,
    type: 'text',
    valueField: fields[0] ?? '',
    suffix: ''
  };
}

function getAvailableFields(rows: TableRowData[]): string[] {
  const keys = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row.values).forEach((key) => {
      if (!key.startsWith('__')) {
        keys.add(key);
      }
    });
  });

  return Array.from(keys).sort((left, right) => left.localeCompare(right));
}

function getColumnTypeLabel(type: ColumnType): string {
  if (type === 'dual-line') return 'Trend';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function getColumnSubLabel(column: TableColumnConfig): string {
  if (column.type === 'hierarchy') {
    return [column.level1Field, column.level2Field, column.level3Field, column.level4Field, column.level5Field, column.level6Field]
      .filter((field): field is string => Boolean(field))
      .join(' \u203a ');
  }
  if (column.type === 'dual-line') {
    return column.primaryMetricField || column.dateField;
  }
  return column.valueField === CUSTOM_FORMULA_FIELD ? 'Custom formula' : column.valueField;
}

function colorModeToDir(colorMode: SecondaryMetricConfig['colorMode'] | undefined): Dir | undefined {
  if (colorMode === 'inverted') return 'bad';
  if (colorMode === 'auto') return 'good';
  return undefined;
}

function dirToColorMode(dir: Dir): SecondaryMetricConfig['colorMode'] {
  return dir === 'bad' ? 'inverted' : 'auto';
}

// ---------------------------------------------------------------------------
// Generic field/control builders (design/config-panel.css component patterns)
// ---------------------------------------------------------------------------

function createFormField(
  labelText: string,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  helpText?: string,
  keySuffix?: string
): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  const fieldKey = keySuffix ? `${slugify(labelText)}-${keySuffix}` : slugify(labelText);
  const id = `cp-field-${fieldKey}`;
  control.id = id;
  control.dataset.fieldKey = fieldKey;
  label.htmlFor = id;
  label.textContent = labelText;
  field.append(label, control);
  if (helpText) {
    const help = document.createElement('span');
    help.className = 'field-help';
    help.textContent = helpText;
    field.appendChild(help);
  }
  return field;
}

function createGroupField(labelText: string, group: HTMLElement, helpText?: string): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'field';
  const labelId = generateId('cp-label');
  const label = document.createElement('span');
  label.className = 'field-label';
  label.id = labelId;
  label.textContent = labelText;
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', labelId);
  field.append(label, group);
  if (helpText) {
    const help = document.createElement('span');
    help.className = 'field-help';
    help.textContent = helpText;
    field.appendChild(help);
  }
  return field;
}

function createSelect(value: string, choices: Array<{ value: string; label: string }>, onChange: (value: string) => void): HTMLSelectElement {
  const select = document.createElement('select');
  choices.forEach((choice) => {
    const option = document.createElement('option');
    option.value = choice.value;
    option.textContent = choice.label;
    select.appendChild(option);
  });
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function createFieldSelect(
  value: string,
  fields: string[],
  onChange: (value: string) => void,
  options?: { includeEmptyNone?: boolean; includeCustomFormula?: boolean }
): HTMLSelectElement {
  const choices: Array<{ value: string; label: string }> = [];
  if (options?.includeEmptyNone) {
    choices.push({ value: '', label: '(none)' });
  }
  if (options?.includeCustomFormula) {
    choices.push({ value: CUSTOM_FORMULA_FIELD, label: '+ Custom formula (Calculated)' });
  }
  fields.forEach((field) => choices.push({ value: field, label: field }));
  return createSelect(value, choices, onChange);
}

function createTextInput(value: string, onChange: (value: string) => void, placeholder?: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = sanitizeUiText(value);
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener('input', () => onChange(sanitizeUiText(input.value)));
  return input;
}

interface FocusSnapshot {
  fieldKey: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

// Full redraws rebuild every control; without this, typing loses focus after each keystroke.
function captureFocusSnapshot(host: HTMLElement): FocusSnapshot | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !host.contains(active)) {
    return null;
  }

  const fieldKey = active.dataset.fieldKey;
  if (!fieldKey) {
    return null;
  }

  let selectionStart: number | null = null;
  let selectionEnd: number | null = null;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    try {
      selectionStart = active.selectionStart;
      selectionEnd = active.selectionEnd;
    } catch {
      // Some input types (e.g. number) don't support selection ranges.
    }
  }

  return { fieldKey, selectionStart, selectionEnd };
}

function restoreFocusSnapshot(host: HTMLElement, snapshot: FocusSnapshot | null): void {
  if (!snapshot) {
    return;
  }

  const restored = host.querySelector<HTMLElement>(`[data-field-key="${snapshot.fieldKey}"]`);
  if (!restored) {
    return;
  }

  restored.focus();
  if ((restored instanceof HTMLInputElement || restored instanceof HTMLTextAreaElement) && snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
    try {
      restored.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    } catch {
      // Some input types (e.g. number) don't support selection ranges.
    }
  }
}

function createNumberInput(value: number, min: number, max: number, onChange: (value: number) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener('input', () => {
    const parsed = Math.max(min, Math.min(max, Number.parseInt(input.value, 10) || 0));
    onChange(parsed);
  });
  return input;
}

function createColorInput(value: string, onChange: (value: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  return input;
}

function createSegmented<T extends string>(value: T, choices: Array<{ value: T; label: string }>, onChange: (value: T) => void): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'segmented';
  choices.forEach((choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    const isActive = choice.value === value;
    button.className = isActive ? 'seg-btn is-active' : 'seg-btn';
    button.textContent = choice.label;
    button.setAttribute('aria-pressed', String(isActive));
    button.addEventListener('click', () => onChange(choice.value));
    group.appendChild(button);
  });
  return group;
}

function createSwatches(value: string, onChange: (value: string) => void): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'swatches';
  const normalized = (value ?? '').toLowerCase();
  const matchesPreset = BAR_COLOR_SWATCHES.some((swatch) => swatch.value.toLowerCase() === normalized);

  BAR_COLOR_SWATCHES.forEach((swatch) => {
    const button = document.createElement('button');
    button.type = 'button';
    const isActive = swatch.value.toLowerCase() === normalized;
    button.className = isActive ? 'swatch is-active' : 'swatch';
    button.style.background = swatch.value;
    button.setAttribute('aria-label', isActive ? `${swatch.label} (selected)` : swatch.label);
    button.addEventListener('click', () => onChange(swatch.value));
    group.appendChild(button);
  });

  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.className = matchesPreset ? 'swatch swatch-custom' : 'swatch swatch-custom is-active';
  customInput.value = /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value : '#3643ba';
  customInput.dataset.fieldKey = 'bar-color-custom';
  customInput.setAttribute('aria-label', 'Custom color');
  customInput.addEventListener('input', () => onChange(customInput.value));
  group.appendChild(customInput);

  return group;
}

function createSwitchControl(isOn: boolean, labelId: string, onChange: (isOn: boolean) => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = isOn ? 'switch is-on' : 'switch';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(isOn));
  button.setAttribute('aria-labelledby', labelId);
  const knob = document.createElement('span');
  knob.className = 'switch-knob';
  button.appendChild(knob);
  button.addEventListener('click', () => onChange(!isOn));
  return button;
}

function createSwitchRow(labelText: string, helpText: string, isOn: boolean, onChange: (isOn: boolean) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'switch-row';
  const labels = document.createElement('div');
  labels.className = 'switch-labels';
  const labelId = generateId('cp-switch');
  const label = document.createElement('span');
  label.className = 'field-label';
  label.id = labelId;
  label.textContent = labelText;
  const help = document.createElement('span');
  help.className = 'field-help';
  help.textContent = helpText;
  labels.append(label, help);
  row.append(labels, createSwitchControl(isOn, labelId, onChange));
  return row;
}

function createDirCard(dir: Dir, isActive: boolean, onSelect: (dir: Dir) => void): HTMLButtonElement {
  const title = dir === 'bad' ? 'An increase is bad' : 'An increase is good';
  const sub = dir === 'bad' ? 'Costs, returns, defects' : 'Sales, satisfaction, availability';
  const positiveClass = dir === 'bad' ? 'badge badge-bad' : 'badge badge-good';
  const negativeClass = dir === 'bad' ? 'badge badge-good' : 'badge badge-bad';

  const card = document.createElement('button');
  card.type = 'button';
  card.className = isActive ? 'dir-card is-active' : 'dir-card';
  card.setAttribute('aria-pressed', String(isActive));

  const titleEl = document.createElement('span');
  titleEl.className = 'dir-card-title';
  titleEl.textContent = title;

  const subEl = document.createElement('span');
  subEl.className = 'dir-card-sub';
  subEl.textContent = sub;

  const badges = document.createElement('span');
  badges.className = 'dir-card-badges';
  const positiveBadge = document.createElement('span');
  positiveBadge.className = positiveClass;
  positiveBadge.textContent = '\u25b2 +12 %';
  const negativeBadge = document.createElement('span');
  negativeBadge.className = negativeClass;
  negativeBadge.textContent = '\u25bc \u22128 %';
  badges.append(positiveBadge, negativeBadge);

  card.append(titleEl, subEl, badges);
  card.addEventListener('click', () => onSelect(dir));
  return card;
}

function createDirGroup(value: Dir | undefined, onChange: (dir: Dir) => void): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'dir-group';
  group.append(
    createDirCard('bad', value === 'bad', onChange),
    createDirCard('good', value === 'good', onChange)
  );
  return group;
}

function createChevronIcon(isClosed: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', isClosed ? 'chev is-closed' : 'chev');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', '#545D69');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 5l4 4 4-4');
  svg.appendChild(path);
  return svg;
}

function createCollapsibleCard(
  title: string,
  summary: string,
  isOpen: boolean,
  onToggle: () => void,
  buildBody: (body: HTMLDivElement) => void
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'card';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'card-toggle';
  toggle.setAttribute('aria-expanded', String(isOpen));

  const titleEl = document.createElement('span');
  titleEl.className = 'card-toggle-title';
  titleEl.textContent = title;

  const summaryEl = document.createElement('span');
  summaryEl.className = 'card-toggle-summary';
  summaryEl.appendChild(document.createTextNode(summary));
  summaryEl.appendChild(createChevronIcon(!isOpen));

  toggle.append(titleEl, summaryEl);
  toggle.addEventListener('click', onToggle);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.hidden = !isOpen;
  buildBody(body);

  section.append(toggle, body);
  return section;
}

// ---------------------------------------------------------------------------
// Conditional formatting rules
// ---------------------------------------------------------------------------

const OPERATOR_CHOICES: Array<{ value: ConditionOperator; label: string }> = [
  { value: 'between', label: 'Is between' },
  { value: 'equal', label: 'Is equal to' },
  { value: 'greater', label: 'Greater than' },
  { value: 'less', label: 'Less than' },
  { value: 'not-between', label: 'Is not between' },
  { value: 'not-equal', label: 'Is not equal to' },
  { value: 'greater-equal', label: 'Greater than or equal to' },
  { value: 'less-equal', label: 'Less than or equal to' }
];

function isBetweenOperator(operator: ConditionOperator): boolean {
  return operator === 'between' || operator === 'not-between';
}

function createDefaultConditionRule(columnType: 'bar' | 'text'): ConditionRule {
  if (columnType === 'bar') {
    return { id: generateId('rule'), operator: 'greater', value: 0, barColor: '#3643BA', textColor: '#111111' };
  }
  return { id: generateId('rule'), operator: 'greater', value: 0, textColor: '#111111', shading: '#FFFFFF' };
}

function createRuleRow(
  rule: ConditionRule,
  columnType: 'bar' | 'text',
  onChange: (rule: ConditionRule) => void,
  onRemove: () => void,
  ruleIndex: number
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cond-rule-row';

  const operatorSelect = createSelect(rule.operator, OPERATOR_CHOICES, (value) => {
    onChange({ ...rule, operator: value as ConditionOperator });
  });
  row.appendChild(createFormField('Rule', operatorSelect, undefined, String(ruleIndex)));

  if (isBetweenOperator(rule.operator)) {
    row.appendChild(createFormField('Min', createNumberInput(rule.min ?? 0, -1_000_000_000, 1_000_000_000, (value) => onChange({ ...rule, min: value })), undefined, String(ruleIndex)));
    row.appendChild(createFormField('Max', createNumberInput(rule.max ?? 0, -1_000_000_000, 1_000_000_000, (value) => onChange({ ...rule, max: value })), undefined, String(ruleIndex)));
  } else {
    row.appendChild(createFormField('Value', createNumberInput(rule.value ?? 0, -1_000_000_000, 1_000_000_000, (value) => onChange({ ...rule, value })), undefined, String(ruleIndex)));
  }

  if (columnType === 'bar') {
    const barRule = rule as BarConditionalRule;
    row.appendChild(createFormField('Bar color', createColorInput(barRule.barColor ?? '#3643BA', (value) => onChange({ ...rule, barColor: value })), undefined, String(ruleIndex)));
    row.appendChild(createFormField('Text color', createColorInput(barRule.textColor ?? '#111111', (value) => onChange({ ...rule, textColor: value })), undefined, String(ruleIndex)));
  } else {
    const textRule = rule as TextConditionalRule;
    row.appendChild(createFormField('Text color', createColorInput(textRule.textColor ?? '#111111', (value) => onChange({ ...rule, textColor: value })), undefined, String(ruleIndex)));
    row.appendChild(createFormField('Shading', createColorInput(textRule.shading ?? '#FFFFFF', (value) => onChange({ ...rule, shading: value })), undefined, String(ruleIndex)));
  }

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn btn-outline';
  removeButton.textContent = 'Remove rule';
  removeButton.addEventListener('click', onRemove);
  row.appendChild(removeButton);

  return row;
}

function buildConditionalFormattingBody(
  body: HTMLDivElement,
  conditions: ConditionRule[],
  columnType: 'bar' | 'text',
  onChange: (conditions: ConditionRule[]) => void
): void {
  if (conditions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-rule';
    const text = document.createElement('span');
    text.textContent = 'Color the value or the row when a condition is met.';
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn-outline';
    addButton.textContent = 'Add rule';
    addButton.addEventListener('click', () => onChange([...conditions, createDefaultConditionRule(columnType)]));
    empty.append(text, addButton);
    body.appendChild(empty);
    return;
  }

  conditions.forEach((rule, ruleIndex) => {
    body.appendChild(createRuleRow(
      rule,
      columnType,
      (nextRule) => onChange(conditions.map((current, i) => (i === ruleIndex ? nextRule : current))),
      () => onChange(conditions.filter((_, i) => i !== ruleIndex)),
      ruleIndex
    ));
  });

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn-outline';
  addButton.textContent = 'Add rule';
  addButton.addEventListener('click', () => onChange([...conditions, createDefaultConditionRule(columnType)]));
  body.appendChild(addButton);
}

function summarizeConditionalFormatting(conditions: ConditionRule[] | undefined): string {
  const count = conditions?.length ?? 0;
  return count === 0 ? 'No rules' : `${count} rule${count > 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------------------
// Secondary metric section
// ---------------------------------------------------------------------------

const DEFAULT_SECONDARY_METRIC: SecondaryMetricConfig = {
  enabled: false,
  sourceType: 'field',
  comparisonField: '',
  comparisonFormula: '',
  calculationType: 'PERCENTAGE',
  colorMode: 'auto',
  decimals: 1
};

function summarizeSecondaryMetric(config: SecondaryMetricConfig | undefined): string {
  if (!config?.enabled) {
    return 'Off';
  }
  const calcLabel = config.calculationType === 'ABSOLUTE' ? 'Absolute variance' : config.calculationType === 'POINTS' ? 'Points' : '% variance';
  const sourceLabel = config.sourceType === 'formula' ? 'custom formula' : (config.comparisonField || 'no field selected');
  const dir = colorModeToDir(config.colorMode);
  const dirLabel = dir === 'bad' ? 'increase = bad' : dir === 'good' ? 'increase = good' : 'no color';
  return `${calcLabel} \u00b7 ${sourceLabel} \u00b7 ${dirLabel}`;
}

function buildSecondaryMetricBody(
  body: HTMLDivElement,
  config: SecondaryMetricConfig | undefined,
  fields: string[],
  onChange: (config: SecondaryMetricConfig) => void
): void {
  const current = config ?? DEFAULT_SECONDARY_METRIC;

  body.appendChild(createSwitchRow(
    'Show variation badge',
    'Displayed next to the main value.',
    current.enabled,
    (isOn) => onChange({ ...current, enabled: isOn })
  ));

  if (!current.enabled) {
    return;
  }

  const sourceType = current.sourceType ?? 'field';
  body.appendChild(createGroupField(
    'Compare with',
    createSegmented(sourceType, [
      { value: 'field', label: 'Comparison field' },
      { value: 'formula', label: 'Custom formula' }
    ], (value) => onChange({ ...current, sourceType: value }))
  ));

  if (sourceType === 'formula') {
    const formulaField = document.createElement('div');
    formulaField.className = 'field field-formula';

    const label = document.createElement('label');
    const textareaId = generateId('cp-formula');
    label.htmlFor = textareaId;
    label.textContent = 'Custom formula (N-1)';

    const textarea = document.createElement('textarea');
    textarea.id = textareaId;
    textarea.rows = 3;
    textarea.spellcheck = false;
    textarea.value = current.comparisonFormula ?? '';
    textarea.dataset.fieldKey = 'secondary-formula';
    textarea.addEventListener('input', () => onChange({ ...current, comparisonFormula: textarea.value }));

    const chips = document.createElement('div');
    chips.className = 'chips';
    const chipsLabel = document.createElement('span');
    chipsLabel.className = 'chips-label';
    chipsLabel.textContent = 'Insert field';
    chips.appendChild(chipsLabel);
    fields.forEach((field) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = `[${field}]`;
      chip.addEventListener('click', () => {
        const insertion = `[${field}]`;
        const cursor = textarea.selectionStart ?? textarea.value.length;
        const nextValue = `${textarea.value.slice(0, cursor)}${insertion}${textarea.value.slice(cursor)}`;
        onChange({ ...current, comparisonFormula: nextValue });
      });
      chips.appendChild(chip);
    });

    const validationLine = document.createElement('div');
    const result = validateSecondaryMetricFormula(current.comparisonFormula ?? '', fields);
    validationLine.className = result.valid ? 'validation is-ok' : 'validation is-error';
    const icon = document.createElement('span');
    icon.textContent = result.valid ? '\u2713' : '!';
    const text = document.createElement('span');
    text.textContent = result.valid
      ? `Valid formula \u00b7 ${result.fieldCount} field${result.fieldCount > 1 ? 's' : ''} referenced`
      : (result.reason ?? 'Invalid formula.');
    validationLine.append(icon, text);

    formulaField.append(label, textarea, chips, validationLine);
    body.appendChild(formulaField);
  } else {
    body.appendChild(createFormField(
      'Comparison field (N-1)',
      createFieldSelect(current.comparisonField ?? '', fields, (value) => onChange({ ...current, comparisonField: value }), { includeEmptyNone: true })
    ));
  }

  const calcRow = document.createElement('div');
  calcRow.className = 'grid-2';
  calcRow.style.maxWidth = '520px';
  calcRow.appendChild(createFormField(
    'Calculation',
    createSelect(current.calculationType, [
      { value: 'ABSOLUTE', label: 'Absolute variance' },
      { value: 'PERCENTAGE', label: '% variance' },
      { value: 'POINTS', label: 'Points' }
    ], (value) => onChange({ ...current, calculationType: value as SecondaryMetricCalculationType }))
  ));
  calcRow.appendChild(createFormField(
    'Decimals',
    createNumberInput(current.decimals ?? 1, 0, 3, (value) => onChange({ ...current, decimals: value })),
    undefined,
    'secondary'
  ));
  body.appendChild(calcRow);

  body.appendChild(createGroupField(
    'How to read the variation',
    createDirGroup(colorModeToDir(current.colorMode), (dir) => onChange({ ...current, colorMode: dirToColorMode(dir) }))
  ));
}

// ---------------------------------------------------------------------------
// Hierarchy levels
// ---------------------------------------------------------------------------

const HIERARCHY_LEVEL_KEYS = ['level1Field', 'level2Field', 'level3Field', 'level4Field', 'level5Field', 'level6Field'] as const;
const MAX_HIERARCHY_LEVELS = 6;

function getHierarchyLevels(column: Extract<TableColumnConfig, { type: 'hierarchy' }>): string[] {
  return HIERARCHY_LEVEL_KEYS
    .map((key) => column[key])
    .filter((field): field is string => Boolean(field))
    .slice(0, Math.max(1, Math.min(MAX_HIERARCHY_LEVELS, column.levelCount ?? 3)));
}

function withHierarchyLevels(
  column: Extract<TableColumnConfig, { type: 'hierarchy' }>,
  levels: string[]
): Extract<TableColumnConfig, { type: 'hierarchy' }> {
  const clampedLevels = levels.slice(0, MAX_HIERARCHY_LEVELS);
  const next = { ...column } as Extract<TableColumnConfig, { type: 'hierarchy' }>;
  HIERARCHY_LEVEL_KEYS.forEach((key, index) => {
    next[key] = clampedLevels[index];
  });
  next.levelCount = Math.max(1, clampedLevels.length) as 1 | 2 | 3 | 4 | 5 | 6;
  return next;
}

function buildLevelsCard(
  column: Extract<TableColumnConfig, { type: 'hierarchy' }>,
  fields: string[],
  onChange: (column: Extract<TableColumnConfig, { type: 'hierarchy' }>) => void
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'card';

  const title = document.createElement('h3');
  title.textContent = 'Levels';
  section.appendChild(title);

  const levels = getHierarchyLevels(column);
  let dragSourceIndex: number | null = null;

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '8px';

  levels.forEach((levelField, levelIndex) => {
    const row = document.createElement('div');
    row.className = 'level-row';

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'drag-handle';
    handle.setAttribute('aria-label', `Drag to reorder level ${levelIndex + 1}`);
    handle.textContent = '\u283f';
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      dragSourceIndex = levelIndex;
      row.classList.add('dragging');
    });

    row.addEventListener('mouseenter', () => {
      if (dragSourceIndex === null || dragSourceIndex === levelIndex) {
        return;
      }
      const nextLevels = [...levels];
      const [moved] = nextLevels.splice(dragSourceIndex, 1);
      nextLevels.splice(levelIndex, 0, moved);
      dragSourceIndex = levelIndex;
      onChange(withHierarchyLevels(column, nextLevels));
    });

    const select = createFieldSelect(levelField, fields, (value) => {
      const nextLevels = [...levels];
      nextLevels[levelIndex] = value;
      onChange(withHierarchyLevels(column, nextLevels));
    });

    row.append(handle, select);

    if (levels.length > 1) {
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'level-remove';
      removeButton.setAttribute('aria-label', `Remove level ${levelIndex + 1}`);
      removeButton.textContent = '\u00d7';
      removeButton.addEventListener('click', () => {
        onChange(withHierarchyLevels(column, levels.filter((_, i) => i !== levelIndex)));
      });
      row.appendChild(removeButton);
    }

    list.appendChild(row);
  });

  document.addEventListener('mouseup', () => {
    dragSourceIndex = null;
    list.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  }, { once: true });

  section.appendChild(list);

  if (levels.length < MAX_HIERARCHY_LEVELS) {
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn-dashed';
    addButton.textContent = 'Add level';
    addButton.addEventListener('click', () => {
      const fallbackField = fields.find((field) => !levels.includes(field)) ?? fields[0] ?? '';
      onChange(withHierarchyLevels(column, [...levels, fallbackField]));
    });
    section.appendChild(addButton);
  }

  section.appendChild(createFormField(
    'Expand rows to',
    createSelect(column.expandTo ?? 'level-1', [
      { value: 'level-1', label: 'Level 1 only' },
      { value: 'level-2', label: 'Down to level 2' },
      { value: 'level-3', label: 'Down to level 3' },
      { value: 'all', label: 'All levels' }
    ], (value) => onChange({ ...column, expandTo: value as HierarchyExpandTo }))
  ));

  return section;
}

// ---------------------------------------------------------------------------
// Preview pane
// ---------------------------------------------------------------------------

function getPreviewScaleInfo(value: number, scale: 'auto' | 'none' | 'k' | 'm' | undefined): { divisor: number; suffix: string } {
  if (scale === 'k') return { divisor: 1_000, suffix: 'K' };
  if (scale === 'm') return { divisor: 1_000_000, suffix: 'M' };
  if (scale === 'auto') {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return { divisor: 1_000_000, suffix: 'M' };
    if (abs >= 1_000) return { divisor: 1_000, suffix: 'K' };
  }
  return { divisor: 1, suffix: '' };
}

function formatPreviewValue(
  value: number,
  options: { decimals?: number; formatStyle?: 'number' | 'currency' | 'percent'; currency?: 'EUR' | 'USD' | 'GBP'; scale?: 'auto' | 'none' | 'k' | 'm' }
): string {
  const decimals = Math.max(0, Math.min(6, options.decimals ?? 0));
  const locale = options.currency === 'USD' ? 'en-US' : options.currency === 'GBP' ? 'en-GB' : 'fr-FR';

  if (options.formatStyle === 'percent') {
    const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return `${formatter.format(value * 100)} %`;
  }

  const { divisor, suffix } = getPreviewScaleInfo(value, options.scale);
  const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const formatted = formatter.format(value / divisor);

  if (options.formatStyle === 'currency') {
    if (options.currency === 'USD') return `$${formatted}${suffix}`;
    if (options.currency === 'GBP') return `\u00a3${formatted}${suffix}`;
    return suffix ? `${formatted} ${suffix}\u20ac` : `${formatted} \u20ac`;
  }

  return `${formatted}${suffix ? ` ${suffix}` : ''}`;
}

function getNumeric(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

// Mirrors table.ts's derived-key convention: aggregated Bar/Trend values live under __bar__/__series__, not the raw field.
function getDerivedBarValue(row: TableRowData, columnId: string, valueField: string): unknown {
  return row.values[`__bar__${columnId}__value`] ?? row.values[valueField];
}

function getDerivedSeriesValue(row: TableRowData, columnId: string, part: 'date' | 'primary' | 'secondary', fallbackField: string): unknown {
  return row.values[`__series__${columnId}__${part}`] ?? row.values[fallbackField];
}

function resolvePreviewComparisonValue(config: SecondaryMetricConfig, row: TableRowData): number | undefined {
  if (config.sourceType === 'formula') {
    if (!config.comparisonFormula?.trim()) return undefined;
    return evaluateCustomFormula(config.comparisonFormula, row.values);
  }
  if (!config.comparisonField || row.values[config.comparisonField] === undefined) {
    return undefined;
  }
  return getNumeric(row.values[config.comparisonField]);
}

function appendPreviewBadge(
  container: HTMLElement,
  config: SecondaryMetricConfig | undefined,
  currentValue: number,
  row: TableRowData,
  formatOptions: { formatStyle?: 'number' | 'currency' | 'percent'; currency?: 'EUR' | 'USD' | 'GBP'; scale?: 'auto' | 'none' | 'k' | 'm' }
): void {
  if (!config?.enabled) {
    return;
  }

  const comparisonValue = resolvePreviewComparisonValue(config, row);
  const delta = computeSecondaryMetricValue(currentValue, comparisonValue, config.calculationType);
  if (delta === undefined) {
    return;
  }

  const { divisor, suffix } = getPreviewScaleInfo(currentValue, formatOptions.scale);
  const label = formatSecondaryMetricLabel(delta, config.calculationType, {
    decimals: config.decimals,
    formatStyle: formatOptions.formatStyle,
    currency: formatOptions.currency,
    scaleDivisor: divisor,
    scaleSuffix: suffix
  });
  const tone = getSecondaryMetricTone(delta, config.colorMode);
  const badge = document.createElement('span');
  badge.className = tone === 'inherit' ? 'badge' : `badge badge-${tone === 'positive' ? 'good' : tone === 'negative' ? 'bad' : 'good'}`;
  const arrow = delta > 0 ? '\u25b2' : delta < 0 ? '\u25bc' : '\u2013';
  badge.textContent = `${arrow} ${label}`;
  container.appendChild(badge);
}

function buildPreviewPane(column: TableColumnConfig | undefined, rows: TableRowData[]): HTMLElement {
  const aside = document.createElement('aside');
  aside.className = 'preview';
  aside.setAttribute('aria-label', 'Live preview');

  const head = document.createElement('div');
  head.className = 'preview-head';
  const heading = document.createElement('h2');
  heading.textContent = 'Live preview';
  const description = document.createElement('p');
  description.textContent = 'Sample rows. Applied to the viz on Save.';
  head.append(heading, description);
  aside.appendChild(head);

  if (!column) {
    const note = document.createElement('p');
    note.className = 'preview-note';
    note.textContent = 'Select a column to preview it here.';
    aside.appendChild(note);
    return aside;
  }

  const sampleRows = rows.slice(0, 4);
  const table = document.createElement('div');
  table.className = 'preview-table';

  const columnHeader = document.createElement('div');
  columnHeader.className = 'preview-col-header';
  columnHeader.textContent = column.header || getColumnTypeLabel(column.type);
  table.appendChild(columnHeader);

  if (sampleRows.length === 0) {
    const emptyRow = document.createElement('div');
    emptyRow.className = 'preview-row';
    emptyRow.textContent = 'No sample data available yet.';
    table.appendChild(emptyRow);
    aside.append(table);
    return aside;
  }

  if (column.type === 'hierarchy') {
    sampleRows.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'preview-row';
      const label = document.createElement('span');
      label.className = 'preview-hierarchy-row';
      label.style.paddingLeft = `${row.level * 16}px`;
      label.title = row.label;
      label.textContent = row.label;
      rowEl.appendChild(label);
      table.appendChild(rowEl);
    });
  } else if (column.type === 'text' || column.type === 'bar') {
    const formatOptions = { formatStyle: column.formatStyle, currency: column.currency, scale: column.scale, decimals: column.decimals };
    const values = sampleRows.map((row) => getNumeric(
      column.type === 'bar' ? getDerivedBarValue(row, column.id, column.valueField) : row.values[column.valueField]
    ));
    const maxValue = Math.max(1, ...values.map((value) => Math.abs(value)));

    sampleRows.forEach((row, rowIndex) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'preview-row';
      const inner = document.createElement('div');
      inner.className = 'preview-row-inner';

      if (column.type === 'bar') {
        const bar = document.createElement('div');
        bar.className = 'mini-bar';
        const fill = document.createElement('div');
        fill.className = 'mini-bar-fill';
        fill.style.width = `${Math.min(100, Math.max(0, (Math.abs(values[rowIndex]) / maxValue) * 100))}%`;
        bar.appendChild(fill);
        inner.appendChild(bar);
      }

      const valueEl = document.createElement('span');
      valueEl.className = 'preview-val';
      valueEl.textContent = formatPreviewValue(values[rowIndex], formatOptions);
      inner.appendChild(valueEl);

      appendPreviewBadge(inner, column.secondaryMetric, values[rowIndex], row, formatOptions);

      rowEl.appendChild(inner);
      table.appendChild(rowEl);
    });
  } else {
    sampleRows.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'preview-row';
      const inner = document.createElement('div');
      inner.className = 'preview-row-inner';

      const sparklineContainer = document.createElement('div');
      const dateValue = getDerivedSeriesValue(row, column.id, 'date', column.dateField);
      const dates = Array.isArray(dateValue) ? dateValue as Array<string | number> : [];
      const primaryValue = getDerivedSeriesValue(row, column.id, 'primary', column.primaryMetricField);
      const primary = Array.isArray(primaryValue) ? primaryValue as number[] : [];
      const secondaryValue = column.compare === false ? undefined : getDerivedSeriesValue(row, column.id, 'secondary', column.secondaryMetricField);
      const secondary = Array.isArray(secondaryValue) ? secondaryValue as number[] : [];
      renderSparklineCell(sparklineContainer, dates, primary, secondary, {
        line1Color: column.line1Color,
        line2Color: column.line2Color
      });
      inner.appendChild(sparklineContainer);
      rowEl.appendChild(inner);
      table.appendChild(rowEl);
    });

    if (column.compare !== false) {
      const caption = document.createElement('div');
      caption.className = 'preview-sparkline-caption';
      const primaryCaption = document.createElement('span');
      const primaryDot = document.createElement('span');
      primaryDot.className = 'legend-dot';
      primaryDot.style.background = column.line1Color ?? '#3643BA';
      primaryCaption.append(primaryDot, document.createTextNode(column.primaryMetricField || 'Metric 1'));
      const secondaryCaption = document.createElement('span');
      const secondaryDot = document.createElement('span');
      secondaryDot.className = 'legend-dot';
      secondaryDot.style.background = column.line2Color ?? '#D9DDE1';
      secondaryCaption.append(secondaryDot, document.createTextNode(column.label2 || column.secondaryMetricField || 'Metric 2'));
      caption.append(primaryCaption, secondaryCaption);
      aside.appendChild(caption);
    }
  }

  aside.append(table);

  const note = document.createElement('p');
  note.className = 'preview-note';
  note.textContent = 'Values sit in a fixed right-aligned column so they line up across rows.';
  aside.appendChild(note);

  return aside;
}

// ---------------------------------------------------------------------------
// Column type conversion (preserves compatible fields across type switches)
// ---------------------------------------------------------------------------

function cloneColumnWithType(column: TableColumnConfig, nextType: ColumnType, fields: string[]): TableColumnConfig {
  const fallbackField = fields[0] ?? '';

  if (nextType === 'text') {
    return {
      id: column.id,
      header: column.header,
      type: 'text',
      valueField: 'valueField' in column ? column.valueField : fallbackField,
      alignment: 'alignment' in column && typeof column.alignment === 'string' ? column.alignment : 'left',
      decimals: 'decimals' in column && typeof column.decimals === 'number' ? column.decimals : 0,
      formatStyle: 'formatStyle' in column && typeof column.formatStyle === 'string' ? column.formatStyle : 'number',
      currency: 'currency' in column && typeof column.currency === 'string' ? column.currency : 'EUR',
      scale: 'scale' in column && typeof column.scale === 'string' ? column.scale : 'none',
      suffix: 'suffix' in column ? column.suffix ?? '' : '',
      conditions: 'conditions' in column ? column.conditions as TextConditionalRule[] | undefined : undefined,
      secondaryMetric: 'secondaryMetric' in column ? column.secondaryMetric : undefined
    };
  }

  if (nextType === 'bar') {
    return {
      id: column.id,
      header: column.header,
      type: 'bar',
      valueField: 'valueField' in column ? column.valueField : fallbackField,
      barColor: 'barColor' in column && typeof column.barColor === 'string' ? column.barColor : '#3643BA',
      decimals: 'decimals' in column && typeof column.decimals === 'number' ? column.decimals : 0,
      formatStyle: 'formatStyle' in column && typeof column.formatStyle === 'string' ? column.formatStyle : 'number',
      currency: 'currency' in column && typeof column.currency === 'string' ? column.currency : 'EUR',
      scale: 'scale' in column && typeof column.scale === 'string' ? column.scale : 'auto',
      secondaryMetric: 'secondaryMetric' in column ? column.secondaryMetric : undefined
    };
  }

  if (nextType === 'hierarchy') {
    return {
      id: column.id,
      header: column.header,
      type: 'hierarchy',
      level1Field: 'valueField' in column ? column.valueField : ('level1Field' in column ? column.level1Field : fallbackField),
      levelCount: 1
    };
  }

  return {
    id: column.id,
    header: column.header,
    type: 'dual-line',
    dateField: 'dateField' in column ? column.dateField : fallbackField,
    primaryMetricField: 'primaryMetricField' in column ? column.primaryMetricField : ('valueField' in column ? column.valueField : fallbackField),
    secondaryMetricField: 'secondaryMetricField' in column ? column.secondaryMetricField : fallbackField,
    compare: 'compare' in column ? column.compare : true,
    line1Color: 'line1Color' in column && typeof column.line1Color === 'string' ? column.line1Color : '#3643BA',
    line2Color: 'line2Color' in column && typeof column.line2Color === 'string' ? column.line2Color : '#D9DDE1'
  };
}

// ---------------------------------------------------------------------------
// Main render entry point
// ---------------------------------------------------------------------------

export function renderConfigPanel(options: ConfigPanelOptions): void {
  const host = document.getElementById(options.containerId);
  if (!host) {
    return;
  }

  const fields = ((options.availableFields && options.availableFields.length > 0)
    ? options.availableFields
    : getAvailableFields(options.rows))
    .map((field) => sanitizeUiText(field))
    .filter((field) => field.length > 0);

  let workingColumns = options.columns.map(cloneColumn);
  let savedColumns = workingColumns.map(cloneColumn);
  let selectedIndex = workingColumns.length > 0 ? 0 : -1;
  let isDirty = false;
  let isSaving = false;
  const openSections = new Map<string, boolean>();

  const isSectionOpen = (columnId: string, section: string, defaultOpen: boolean): boolean => {
    const key = `${columnId}:${section}`;
    if (!openSections.has(key)) {
      openSections.set(key, defaultOpen);
    }
    return Boolean(openSections.get(key));
  };

  const toggleSection = (columnId: string, section: string, defaultOpen: boolean): void => {
    const key = `${columnId}:${section}`;
    openSections.set(key, !isSectionOpen(columnId, section, defaultOpen));
  };

  const updateSelectedColumn = (updater: (column: TableColumnConfig) => TableColumnConfig): void => {
    if (selectedIndex < 0) return;
    workingColumns = workingColumns.map((column, index) => (index === selectedIndex ? updater(column) : column));
    isDirty = true;
    redraw();
  };

  const redraw = (): void => {
    const focusSnapshot = captureFocusSnapshot(host);
    host.replaceChildren();

    const panel = document.createElement('div');
    panel.className = 'panel';

    // ---- topbar ----
    const topbar = document.createElement('header');
    topbar.className = 'topbar';

    const titles = document.createElement('div');
    titles.className = 'topbar-titles';
    const h1 = document.createElement('h1');
    h1.textContent = 'Column configuration';
    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent = `${workingColumns.length} column${workingColumns.length === 1 ? '' : 's'} \u00b7 ${options.canPersist ? 'synced with Tableau' : 'local mode, not saved'}`;
    titles.append(h1, subtitle);

    const topActions = document.createElement('div');
    topActions.className = 'topbar-actions';

    if (isDirty) {
      const dirtyFlag = document.createElement('span');
      dirtyFlag.className = 'dirty-flag';
      const dot = document.createElement('span');
      dot.className = 'dirty-dot';
      dirtyFlag.append(dot, document.createTextNode('Unsaved changes'));
      topActions.appendChild(dirtyFlag);
    }

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'btn btn-ghost';
    resetButton.textContent = 'Reset to defaults';
    resetButton.addEventListener('click', () => {
      void options.onReset();
    });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-outline';
    cancelButton.textContent = 'Cancel';
    cancelButton.disabled = !isDirty;
    cancelButton.addEventListener('click', () => {
      workingColumns = savedColumns.map(cloneColumn);
      isDirty = false;
      if (selectedIndex >= workingColumns.length) {
        selectedIndex = workingColumns.length - 1;
      }
      redraw();
    });

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn-primary';
    saveButton.textContent = isSaving ? 'Saving\u2026' : 'Save';
    saveButton.disabled = !isDirty || isSaving;
    saveButton.addEventListener('click', () => {
      isSaving = true;
      redraw();
      void options.onSave(workingColumns).then(() => {
        savedColumns = workingColumns.map(cloneColumn);
        isDirty = false;
        isSaving = false;
        redraw();
      }).catch(() => {
        isSaving = false;
        redraw();
      });
    });

    topActions.append(resetButton, cancelButton, saveButton);
    topbar.append(titles, topActions);

    // ---- body ----
    const body = document.createElement('div');
    body.className = 'body';

    body.append(
      buildSidebar(),
      buildDetail(),
      buildPreviewPane(workingColumns[selectedIndex], options.rows)
    );

    panel.append(topbar, body);
    host.appendChild(panel);
    restoreFocusSnapshot(host, focusSnapshot);
  };

  function buildSidebar(): HTMLElement {
    const sidebar = document.createElement('nav');
    sidebar.className = 'sidebar';
    sidebar.setAttribute('aria-label', 'Columns');

    const head = document.createElement('div');
    head.className = 'sidebar-head';
    const heading = document.createElement('h2');
    heading.textContent = 'Columns';
    const count = document.createElement('span');
    count.className = 'muted';
    count.textContent = String(workingColumns.length);
    head.append(heading, count);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Drag to reorder. Top to bottom = left to right in the table.';

    const list = document.createElement('ul');
    list.className = 'col-list';

    let dragSourceIndex: number | null = null;

    workingColumns.forEach((column, index) => {
      const item = document.createElement('li');
      item.className = index === selectedIndex ? 'col-row selected' : 'col-row';

      const rowButton = document.createElement('button');
      rowButton.type = 'button';
      rowButton.className = 'col-row-btn';

      const dragHandle = document.createElement('span');
      dragHandle.className = 'drag-handle';
      dragHandle.setAttribute('aria-hidden', 'true');
      dragHandle.textContent = '\u283f';
      dragHandle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dragSourceIndex = index;
        item.classList.add('dragging');
      });

      const text = document.createElement('span');
      text.className = 'col-row-text';
      const name = document.createElement('span');
      name.className = 'col-row-name';
      name.textContent = column.header || `Column ${index + 1}`;
      const sub = document.createElement('span');
      sub.className = 'col-row-sub';
      sub.textContent = getColumnSubLabel(column);
      text.append(name, sub);

      const typePill = document.createElement('span');
      typePill.className = 'type-pill';
      typePill.textContent = getColumnTypeLabel(column.type);

      rowButton.append(dragHandle, text, typePill);
      rowButton.addEventListener('click', () => {
        selectedIndex = index;
        redraw();
      });

      const moreButton = document.createElement('button');
      moreButton.type = 'button';
      moreButton.className = 'row-more';
      moreButton.setAttribute('aria-label', `Remove ${column.header || 'column'}`);
      moreButton.textContent = '\u00d7';
      moreButton.addEventListener('click', (event) => {
        event.stopPropagation();
        workingColumns = workingColumns.filter((_, i) => i !== index);
        if (selectedIndex >= workingColumns.length) {
          selectedIndex = workingColumns.length - 1;
        }
        isDirty = true;
        redraw();
      });

      item.addEventListener('mouseenter', () => {
        if (dragSourceIndex === null || dragSourceIndex === index) {
          return;
        }
        const nextColumns = [...workingColumns];
        const [moved] = nextColumns.splice(dragSourceIndex, 1);
        nextColumns.splice(index, 0, moved);
        if (selectedIndex === dragSourceIndex) {
          selectedIndex = index;
        }
        dragSourceIndex = index;
        workingColumns = nextColumns;
        isDirty = true;
        redraw();
      });

      item.append(rowButton, moreButton);
      list.appendChild(item);
    });

    document.addEventListener('mouseup', () => {
      dragSourceIndex = null;
    }, { once: true });

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn-dashed';
    addButton.textContent = 'Add column';
    addButton.addEventListener('click', () => {
      workingColumns = [...workingColumns, createDefaultColumn(fields)];
      selectedIndex = workingColumns.length - 1;
      isDirty = true;
      redraw();
    });

    sidebar.append(head, hint, list, addButton);
    return sidebar;
  }

  function buildDetail(): HTMLElement {
    const detail = document.createElement('main');
    detail.className = 'detail';

    const column = selectedIndex >= 0 ? workingColumns[selectedIndex] : undefined;
    if (!column) {
      const emptyHeading = document.createElement('div');
      emptyHeading.className = 'detail-heading';
      const h2 = document.createElement('h2');
      h2.textContent = 'No column selected';
      emptyHeading.appendChild(h2);
      detail.appendChild(emptyHeading);
      return detail;
    }

    const heading = document.createElement('div');
    heading.className = 'detail-heading';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = `Column ${selectedIndex + 1} of ${workingColumns.length}`;
    const h2 = document.createElement('h2');
    h2.textContent = column.header || getColumnTypeLabel(column.type);
    heading.append(eyebrow, h2);
    detail.appendChild(heading);

    // ---- header + type card ----
    const headerCard = document.createElement('section');
    headerCard.className = 'card';
    const headerGrid = document.createElement('div');
    headerGrid.className = 'grid-2';
    headerGrid.appendChild(createFormField(
      'Header',
      createTextInput(column.header, (value) => updateSelectedColumn((c) => ({ ...c, header: value })))
    ));
    headerGrid.appendChild(createGroupField(
      'Type',
      createSegmented(column.type, [
        { value: 'text', label: 'Text' },
        { value: 'bar', label: 'Bar' },
        { value: 'hierarchy', label: 'Hierarchy' },
        { value: 'dual-line', label: 'Trend' }
      ], (value) => {
        updateSelectedColumn((c) => cloneColumnWithType(c, value as ColumnType, fields));
      })
    ));
    headerCard.appendChild(headerGrid);
    detail.appendChild(headerCard);

    if (column.type === 'hierarchy') {
      detail.appendChild(buildLevelsCard(column, fields, (nextColumn) => updateSelectedColumn(() => nextColumn)));
      detail.appendChild(buildDangerRow());
      return detail;
    }

    if (column.type === 'dual-line') {
      detail.appendChild(buildTrendValueCard(column));
      detail.appendChild(buildDangerRow());
      return detail;
    }

    detail.appendChild(buildValueCard(column));
    detail.appendChild(buildFormatCard(column));
    detail.appendChild(buildSecondaryMetricCard(column));
    detail.appendChild(buildConditionalFormattingCard(column));
    detail.appendChild(buildDangerRow());

    return detail;
  }

  function buildDangerRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'danger-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-danger';
    button.textContent = 'Remove this column';
    button.addEventListener('click', () => {
      workingColumns = workingColumns.filter((_, i) => i !== selectedIndex);
      selectedIndex = Math.min(selectedIndex, workingColumns.length - 1);
      isDirty = true;
      redraw();
    });
    row.appendChild(button);
    return row;
  }

  function buildValueCard(column: Extract<TableColumnConfig, { type: 'text' } | { type: 'bar' }>): HTMLElement {
    const section = document.createElement('section');
    section.className = 'card';
    const title = document.createElement('h3');
    title.textContent = 'Value';
    section.appendChild(title);

    section.appendChild(createFormField(
      'Value field',
      createFieldSelect(column.valueField, fields, (value) => updateSelectedColumn((c) => ({ ...c, valueField: value })), { includeCustomFormula: true })
    ));

    if (column.valueField === CUSTOM_FORMULA_FIELD) {
      section.appendChild(createFormField(
        'Custom formula',
        createTextInput(
          (column as unknown as { customFormula?: string }).customFormula ?? '',
          (value) => updateSelectedColumn((c) => ({ ...c, customFormula: value } as unknown as TableColumnConfig)),
          'e.g. Profit / Sales'
        )
      ));
    }

    if (column.type === 'bar') {
      const optsRow = document.createElement('div');
      optsRow.className = 'grid-2 opts-row';
      optsRow.appendChild(createGroupField('Bar color', createSwatches(column.barColor ?? '#3643BA', (value) => updateSelectedColumn((c) => ({ ...c, barColor: value })))));
      optsRow.appendChild(createGroupField(
        'Bar scale',
        createSegmented<BarScaleMode>(column.barScale ?? 'whole-table', [
          { value: 'per-level', label: 'Per level' },
          { value: 'relative-to-parent', label: 'Relative to parent' },
          { value: 'whole-table', label: 'Whole table' }
        ], (value) => updateSelectedColumn((c) => ({ ...c, barScale: value }))),
        'Bars compare rows of the same level, so deep levels stay readable.'
      ));
      section.appendChild(optsRow);
    }

    return section;
  }

  function buildFormatCard(column: Extract<TableColumnConfig, { type: 'text' } | { type: 'bar' }>): HTMLElement {
    const summary = column.formatStyle === 'currency'
      ? `Currency ${column.currency ?? 'EUR'} \u00b7 ${column.decimals ?? 0} dec. \u00b7 ${column.scale ?? 'none'}`
      : `${column.formatStyle ?? 'number'} \u00b7 ${column.decimals ?? 0} dec. \u00b7 ${column.scale ?? 'none'}`;

    return createCollapsibleCard(
      'Number format',
      summary,
      isSectionOpen(column.id, 'format', true),
      () => { toggleSection(column.id, 'format', true); redraw(); },
      (body) => {
        const grid = document.createElement('div');
        grid.className = 'grid-4';
        grid.appendChild(createFormField('Format', createSelect(column.formatStyle ?? 'number', [
          { value: 'number', label: 'Number' },
          { value: 'currency', label: 'Currency' },
          { value: 'percent', label: 'Percent' }
        ], (value) => updateSelectedColumn((c) => ({ ...c, formatStyle: value as 'number' | 'currency' | 'percent' })))));
        grid.appendChild(createFormField('Decimals', createNumberInput(column.decimals ?? 0, 0, 3, (value) => updateSelectedColumn((c) => ({ ...c, decimals: value }))), undefined, 'format'));
        if (column.formatStyle === 'currency') {
          grid.appendChild(createFormField('Currency', createSelect(column.currency ?? 'EUR', [
            { value: 'EUR', label: 'EUR (\u20ac)' },
            { value: 'USD', label: 'USD ($)' },
            { value: 'GBP', label: 'GBP (\u00a3)' }
          ], (value) => updateSelectedColumn((c) => ({ ...c, currency: value as 'EUR' | 'USD' | 'GBP' })))));
        }
        grid.appendChild(createFormField('Scale', createSelect(column.scale ?? 'none', [
          { value: 'auto', label: 'Auto (K/M)' },
          { value: 'none', label: 'None' },
          { value: 'k', label: 'Thousands (K)' },
          { value: 'm', label: 'Millions (M)' }
        ], (value) => updateSelectedColumn((c) => ({ ...c, scale: value as 'auto' | 'none' | 'k' | 'm' })))));
        body.appendChild(grid);

        if (column.type === 'text') {
          body.appendChild(createFormField('Suffix', createTextInput(column.suffix ?? '', (value) => updateSelectedColumn((c) => ({ ...c, suffix: value })))));
        }
      }
    );
  }

  function buildSecondaryMetricCard(column: Extract<TableColumnConfig, { type: 'text' } | { type: 'bar' }>): HTMLElement {
    return createCollapsibleCard(
      'Secondary metric \u00b7 variation vs N-1',
      summarizeSecondaryMetric(column.secondaryMetric),
      isSectionOpen(column.id, 'sec', true),
      () => { toggleSection(column.id, 'sec', true); redraw(); },
      (body) => buildSecondaryMetricBody(body, column.secondaryMetric, fields, (config) => updateSelectedColumn((c) => ({ ...c, secondaryMetric: config })))
    );
  }

  function buildConditionalFormattingCard(column: Extract<TableColumnConfig, { type: 'text' } | { type: 'bar' }>): HTMLElement {
    return createCollapsibleCard(
      'Conditional formatting',
      summarizeConditionalFormatting(column.conditions),
      isSectionOpen(column.id, 'cond', false),
      () => { toggleSection(column.id, 'cond', false); redraw(); },
      (body) => buildConditionalFormattingBody(body, column.conditions ?? [], column.type, (conditions) => updateSelectedColumn((c) => ({ ...c, conditions } as TableColumnConfig)))
    );
  }

  function buildTrendValueCard(column: Extract<TableColumnConfig, { type: 'dual-line' }>): HTMLElement {
    const section = document.createElement('section');
    section.className = 'card';
    const title = document.createElement('h3');
    title.textContent = 'Value';
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'grid-2';
    grid.appendChild(createFormField('Date field', createFieldSelect(column.dateField, fields, (value) => updateSelectedColumn((c) => ({ ...c, dateField: value })))));
    grid.appendChild(createFormField('Metric 1', createFieldSelect(column.primaryMetricField, fields, (value) => updateSelectedColumn((c) => ({ ...c, primaryMetricField: value })))));
    section.appendChild(grid);

    section.appendChild(createSwitchRow(
      'Show second curve',
      'Compares against a second metric on the same chart.',
      column.compare !== false,
      (isOn) => updateSelectedColumn((c) => ({ ...c, compare: isOn }))
    ));

    if (column.compare !== false) {
      const compareGrid = document.createElement('div');
      compareGrid.className = 'grid-2';
      compareGrid.appendChild(createFormField('Metric 2', createFieldSelect(column.secondaryMetricField, fields, (value) => updateSelectedColumn((c) => ({ ...c, secondaryMetricField: value })))));
      compareGrid.appendChild(createFormField('Legend label 2', createTextInput(column.label2 ?? '', (value) => updateSelectedColumn((c) => ({ ...c, label2: value })))));
      section.appendChild(compareGrid);

      const colorGrid = document.createElement('div');
      colorGrid.className = 'grid-2';
      colorGrid.appendChild(createFormField('Line 1 color', createColorInput(column.line1Color ?? '#3643BA', (value) => updateSelectedColumn((c) => ({ ...c, line1Color: value })))));
      colorGrid.appendChild(createFormField('Line 2 color', createColorInput(column.line2Color ?? '#D9DDE1', (value) => updateSelectedColumn((c) => ({ ...c, line2Color: value })))));
      section.appendChild(colorGrid);
    }

    return section;
  }

  redraw();
}