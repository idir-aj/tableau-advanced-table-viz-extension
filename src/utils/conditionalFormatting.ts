import type { ConditionOperator } from '../data/mockData';

interface ConditionRuleLike {
  operator: ConditionOperator;
  value?: number;
  min?: number;
  max?: number;
}

export function matchesConditionRule(value: number, rule: ConditionRuleLike): boolean {
  switch (rule.operator) {
    case 'between': {
      const min = rule.min ?? Number.NEGATIVE_INFINITY;
      const max = rule.max ?? Number.POSITIVE_INFINITY;
      return value >= min && value <= max;
    }
    case 'not-between': {
      const min = rule.min ?? Number.NEGATIVE_INFINITY;
      const max = rule.max ?? Number.POSITIVE_INFINITY;
      return value < min || value > max;
    }
    case 'equal':
      return value === (rule.value ?? 0);
    case 'not-equal':
      return value !== (rule.value ?? 0);
    case 'greater':
      return value > (rule.value ?? 0);
    case 'less':
      return value < (rule.value ?? 0);
    case 'greater-equal':
      return value >= (rule.value ?? 0);
    case 'less-equal':
      return value <= (rule.value ?? 0);
    default:
      return false;
  }
}

// Returns the first matching rule; rule order defines precedence.
export function findMatchingConditionRule<T extends ConditionRuleLike>(
  value: number,
  rules: T[] | undefined
): T | undefined {
  if (!rules) {
    return undefined;
  }

  return rules.find((rule) => matchesConditionRule(value, rule));
}
