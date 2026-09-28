// Live validation for the secondary-metric custom formula field (design-spec.md §4).
export interface FormulaValidationResult {
  valid: boolean;
  fieldCount: number;
  reason?: string;
}

// Functions formulaEngine.ts already strips as identity wrappers around an aggregated field.
const ALLOWED_FUNCTIONS = new Set(['SUM', 'SOMME', 'ATTR', 'AGG', 'MOYENNE', 'AVG']);

function hasBalancedParentheses(formula: string): boolean {
  let depth = 0;
  for (const char of formula) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

export function validateSecondaryMetricFormula(formula: string, availableFields: string[]): FormulaValidationResult {
  const trimmed = formula.trim();

  if (!trimmed) {
    return { valid: false, fieldCount: 0, reason: 'Formula is empty.' };
  }

  if (!hasBalancedParentheses(trimmed)) {
    return { valid: false, fieldCount: 0, reason: 'Unbalanced parentheses.' };
  }

  const fieldReferences = Array.from(trimmed.matchAll(/\[([^[\]]+)\]/g)).map((match) => match[1].trim());
  if (fieldReferences.length === 0) {
    return { valid: false, fieldCount: 0, reason: 'No field reference found — wrap field names in [brackets].' };
  }

  const knownFieldNames = new Set(availableFields.map((field) => field.toLowerCase()));
  const unknownField = fieldReferences.find((field) => !knownFieldNames.has(field.toLowerCase()));
  if (unknownField !== undefined) {
    return { valid: false, fieldCount: 0, reason: `Unknown field [${unknownField}].` };
  }

  const functionCalls = Array.from(trimmed.matchAll(/([A-Za-zÀ-ÿ_]+)\s*\(/g)).map((match) => match[1]);
  const unknownFunction = functionCalls.find((name) => !ALLOWED_FUNCTIONS.has(name.toUpperCase()));
  if (unknownFunction !== undefined) {
    return { valid: false, fieldCount: 0, reason: `Unknown function ${unknownFunction}().` };
  }

  return { valid: true, fieldCount: fieldReferences.length };
}
