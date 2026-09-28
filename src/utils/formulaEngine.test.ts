import { describe, expect, it } from 'vitest';
import { evaluateCustomFormula } from './formulaEngine';

describe('evaluateCustomFormula', () => {
  it('applies parentheses precedence correctly', () => {
    const result = evaluateCustomFormula('(Profit + Sales) / 2', {
      Profit: 10,
      Sales: 30
    });

    expect(result).toBe(20);
  });

  it('returns 0 on division by zero', () => {
    const result = evaluateCustomFormula('Sales / Quantity', {
      Sales: 150,
      Quantity: 0
    });

    expect(result).toBe(0);
  });

  it('resolves aliases from wrapped and bracketed field names', () => {
    const result = evaluateCustomFormula('Profit / Sales', {
      'SUM([Profit])': 50,
      'SUM([Sales])': 200
    });

    expect(result).toBe(0.25);
  });
});