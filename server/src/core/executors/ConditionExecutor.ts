import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

// Evaluador aritmético acotado (+ - * / y paréntesis), SIN Function()/eval.
// Solo se llama sobre cadenas ya validadas como `[\d\s+\-*/().]`.
function safeArith(expr: string): number | null {
  const s = expr;
  let i = 0;
  const skip = () => { while (i < s.length && s[i] === ' ') i++; };
  const factor = (): number => {
    skip();
    if (s[i] === '(') { i++; const v = expr2(); skip(); if (s[i] === ')') i++; return v; }
    if (s[i] === '-') { i++; return -factor(); }
    let num = '';
    while (i < s.length && /[\d.]/.test(s[i])) num += s[i++];
    return parseFloat(num);
  };
  const term = (): number => {
    let v = factor(); skip();
    while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const f = factor(); v = op === '*' ? v * f : v / f; skip(); }
    return v;
  };
  function expr2(): number {
    let v = term(); skip();
    while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const t = term(); v = op === '+' ? v + t : v - t; skip(); }
    return v;
  }
  try { skip(); const v = expr2(); return Number.isFinite(v) ? v : null; } catch { return null; }
}

export class ConditionExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        const { variable, operator: rawOp = 'equals', expectedValue } = data;
        // Normaliza operadores simbólicos a nombrados (acepta >, <, >=, <=, ==, !=).
        const OP_ALIAS: Record<string, string> = {
            '>': 'greater_than', '<': 'less_than',
            '>=': 'greater_or_equal', '=>': 'greater_or_equal',
            '<=': 'less_or_equal', '=<': 'less_or_equal',
            '==': 'equals', '===': 'equals', '=': 'equals',
            '!=': 'not_equals', '!==': 'not_equals', '<>': 'not_equals',
        };
        const operator = OP_ALIAS[String(rawOp).trim()] || rawOp;
        const variableName = data.variable ? data.variable.trim() : '';
        const actualValue = variableName ? context[variableName] : undefined;
        const actualValueRaw = variableName ? context[`${variableName}_raw`] : undefined;
        const actualValueIndex = variableName ? context[`${variableName}_index`] : undefined;

        // Clean input: remove common WhatsApp markdown (*, _) and trim
        let val1 = String(actualValue || '').replace(/[\*_]/g, '').trim().toLowerCase();
        let valRaw = String(actualValueRaw || '').replace(/[\*_]/g, '').trim().toLowerCase();
        let valIndex = String(actualValueIndex || '').trim().toLowerCase();

        // expectedValue admite {{variables}} y aritmética simple. Ej: "9 - {{hijos}}"
        // permite comparar (aportes > 9 - hijos) ≡ (aportes + hijos ≥ 10).
        let expectedResolved = String(expectedValue || '');
        if (expectedResolved.includes('{{')) {
            expectedResolved = expectedResolved.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, v: string) => {
                const cv = context[v];
                return cv === undefined || cv === null ? '0' : String(cv);
            });
        }
        // Si quedó una expresión puramente aritmética, evaluarla de forma acotada.
        if (/[+\-*/]/.test(expectedResolved) && /^[\d\s+\-*/().]+$/.test(expectedResolved.trim())) {
            const n = safeArith(expectedResolved.trim());
            if (n !== null) expectedResolved = String(n);
        }
        const val2 = expectedResolved.trim().toLowerCase();

        // Extract numeric part (e.g. from "1." or "*1.*" or "opción 1")
        const matchesNumeric = (text: string, expected: string) => {
            if (!text || !expected) return false;
            const pattern = new RegExp(`(^|\\D)${expected}(\\D|$)`);
            return pattern.test(text);
        };

        const isNumericMatch = matchesNumeric(val1, val2) || matchesNumeric(valRaw, val2);

        // NOTA: el "loose match" por substring (val2.includes(val1)) se quitó de equals:
        // hacía que `equals "conductor"` matcheara "con" y ruteara mal el embudo. Para
        // coincidencia parcial existe el operador `contains`.

        console.log(`[ConditionExecutor] Comparing "${val1}" / Raw: "${valRaw}" / Index: "${valIndex}" ${operator} "${val2}"`);

        let result = false;
        if (operator === 'equals') {
            result = (val1 === val2 || valRaw === val2 || isNumericMatch || valIndex === val2);
        } else if (operator === 'not_equals') {
            result = (val1 !== val2 && valRaw !== val2 && !isNumericMatch && valIndex !== val2);
        } else if (operator === 'contains') {
            result = val1.includes(val2) || valRaw.includes(val2);
        } else if (['greater_than', 'less_than', 'greater_or_equal', 'less_or_equal'].includes(operator)) {
            const a = Number(val1); const b = Number(val2);
            if (isNaN(a) || isNaN(b)) {
                console.warn(`[ConditionExecutor] Non-numeric compare "${val1}" ${operator} "${val2}" → false`);
                result = false;
            } else {
                result = operator === 'greater_than' ? a > b
                       : operator === 'less_than' ? a < b
                       : operator === 'greater_or_equal' ? a >= b
                       : a <= b;
            }
        } else {
            // Unknown operator → safest default is equals semantics
            console.warn(`[ConditionExecutor] Unknown operator "${operator}" → using equals.`);
            result = (val1 === val2 || valRaw === val2 || isNumericMatch || valIndex === val2);
        }

        console.log(`[ConditionExecutor] Result: ${result} (Numeric: ${isNumericMatch})`);

        // conditionNode doesn't send messages, just returns boolean for routing
        return {
            messages: [],
            wait_for_input: false,
            conditionResult: result
        };
    }
}
