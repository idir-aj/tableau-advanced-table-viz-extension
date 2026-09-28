function parseNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  return Number(String(value ?? 0).replace(/\s/g, '').replace(',', '.')) || 0;
}

function prepareFormulaVariables(values: Record<string, unknown>): Record<string, number> {
  // Use a null-prototype object to avoid prototype pollution through keys.
  const vars: Record<string, number> = Object.create(null) as Record<string, number>;

  Object.entries(values).forEach(([rawKey, val]) => {
    if (rawKey === '__proto__' || rawKey === 'constructor' || rawKey === 'prototype') {
      return;
    }

    const numericVal = parseNumber(val);

    vars[rawKey] = numericVal;

    const openParenIdx = rawKey.indexOf('(');
    const closeParenIdx = rawKey.lastIndexOf(')');
    let cleanKey = rawKey;

    if (openParenIdx > 0 && closeParenIdx > openParenIdx) {
      cleanKey = rawKey.slice(openParenIdx + 1, closeParenIdx);
    } else {
      cleanKey = rawKey.replace(/^(SOMME|SUM|AGG|MOYENNE|AVG|ATTR)\s*/i, '');
    }

    cleanKey = cleanKey.replace(/[\[\]]/g, '').trim();

    if (cleanKey && cleanKey !== '__proto__' && cleanKey !== 'constructor') {
      vars[cleanKey] = numericVal;
      vars[cleanKey.toLowerCase()] = numericVal;
    }
  });

  return vars;
}

function parseAndEvaluateMath(tokens: string[], variables: Record<string, number>): number {
  const valuesStack: number[] = [];
  const operatorsStack: string[] = [];

  const precedence = (op: string): number => {
    if (op === '+' || op === '-') return 1;
    if (op === '*' || op === '/') return 2;
    return 0;
  };

  const applyOp = (): void => {
    const op = operatorsStack.pop();
    const right = valuesStack.pop() ?? 0;
    const left = valuesStack.pop() ?? 0;

    switch (op) {
      case '+':
        valuesStack.push(left + right);
        break;
      case '-':
        valuesStack.push(left - right);
        break;
      case '*':
        valuesStack.push(left * right);
        break;
      case '/':
        valuesStack.push(right !== 0 ? left / right : 0);
        break;
    }
  };

  for (const token of tokens) {
    if (!token) continue;

    if (!Number.isNaN(Number(token))) {
      valuesStack.push(Number(token));
    } else if (token in variables) {
      valuesStack.push(variables[token]);
    } else if (token === '(') {
      operatorsStack.push(token);
    } else if (token === ')') {
      while (operatorsStack.length > 0 && operatorsStack[operatorsStack.length - 1] !== '(') {
        applyOp();
      }
      operatorsStack.pop();
    } else if (['+', '-', '*', '/'].includes(token)) {
      while (
        operatorsStack.length > 0
        && precedence(operatorsStack[operatorsStack.length - 1]) >= precedence(token)
      ) {
        applyOp();
      }
      operatorsStack.push(token);
    }
  }

  while (operatorsStack.length > 0) {
    applyOp();
  }

  return valuesStack.length > 0 ? valuesStack[0] : 0;
}

export function evaluateCustomFormula(formula: string, values: Record<string, unknown>): number {
  if (!formula || !formula.trim()) return 0;

  try {
    const variables = prepareFormulaVariables(values);
    const cleanFormula = formula.replace(/[\[\]]/g, '');
    const rawTokens = cleanFormula.match(/([a-zA-Z0-9_\s]+|[-+*/()])/g) ?? [];
    const tokens = rawTokens.map((token) => token.trim()).filter(Boolean);

    const result = parseAndEvaluateMath(tokens, variables);
    return Number.isFinite(result) ? result : 0;
  } catch {
    const safeFormula = String(formula).replace(/[\r\n\t]/g, ' ').slice(0, 100);
    console.warn(`Formula evaluation error: ${safeFormula}`);
    return 0;
  }
}