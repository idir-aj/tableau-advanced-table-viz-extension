import { describe, expect, it } from 'vitest';
import { validateSecondaryMetricFormula } from './formulaValidation';

const fields = ['non_quality_cost_n_0', 'non_quality_cost_n_1', 'qty_returned_1stlife_n_0'];

describe('validateSecondaryMetricFormula', () => {
  it('accepts a valid formula referencing a known field', () => {
    const result = validateSecondaryMetricFormula('SUM([non_quality_cost_n_1])', fields);
    expect(result).toEqual({ valid: true, fieldCount: 1 });
  });

  it('rejects an empty formula', () => {
    expect(validateSecondaryMetricFormula('   ', fields).valid).toBe(false);
  });

  it('rejects unbalanced parentheses', () => {
    const result = validateSecondaryMetricFormula('SUM([non_quality_cost_n_1]', fields);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/parenthes/i);
  });

  it('rejects a formula with no field reference', () => {
    const result = validateSecondaryMetricFormula('SUM(1)', fields);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/field reference/i);
  });

  it('rejects an unknown field', () => {
    const result = validateSecondaryMetricFormula('SUM([unknown_field])', fields);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unknown field/i);
  });

  it('rejects an unknown function', () => {
    const result = validateSecondaryMetricFormula('MIN([non_quality_cost_n_1])', fields);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unknown function/i);
  });

  it('counts multiple field references and accepts localized SOMME', () => {
    const result = validateSecondaryMetricFormula('SOMME([non_quality_cost_n_1]) + SOMME([qty_returned_1stlife_n_0])', fields);
    expect(result).toEqual({ valid: true, fieldCount: 2 });
  });
});
