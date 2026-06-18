import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

export class ConditionExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        const { variable, operator = 'equals', expectedValue } = data;
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
            try {
                const n = Function(`"use strict";return (${expectedResolved.trim()});`)();
                if (typeof n === 'number' && isFinite(n)) expectedResolved = String(n);
            } catch { /* dejar el literal si no evalúa */ }
        }
        const val2 = expectedResolved.trim().toLowerCase();

        // Extract numeric part (e.g. from "1." or "*1.*" or "opción 1")
        const matchesNumeric = (text: string, expected: string) => {
            if (!text || !expected) return false;
            const pattern = new RegExp(`(^|\\D)${expected}(\\D|$)`);
            return pattern.test(text);
        };

        const isNumericMatch = matchesNumeric(val1, val2) || matchesNumeric(valRaw, val2);

        // Also check if val1 (the text) is simply contained in the expected option (loose match)
        const isLooseMatch = (val1.length >= 3 && val2.includes(val1)) || (valRaw.length >= 3 && val2.includes(valRaw));

        console.log(`[ConditionExecutor] Comparing "${val1}" / Raw: "${valRaw}" / Index: "${valIndex}" ${operator} "${val2}"`);

        let result = false;
        if (operator === 'equals') {
            result = (val1 === val2 || valRaw === val2 || isNumericMatch || isLooseMatch || valIndex === val2);
        } else if (operator === 'not_equals') {
            result = (val1 !== val2 && valRaw !== val2 && !isNumericMatch && !isLooseMatch && valIndex !== val2);
        } else if (operator === 'contains') {
            result = val1.includes(val2) || valRaw.includes(val2);
        } else if (operator === 'greater_than' || operator === 'less_than') {
            const a = Number(val1); const b = Number(val2);
            if (isNaN(a) || isNaN(b)) {
                console.warn(`[ConditionExecutor] Non-numeric compare "${val1}" ${operator} "${val2}" → false`);
                result = false;
            } else {
                result = operator === 'greater_than' ? a > b : a < b;
            }
        } else {
            // Unknown operator → safest default is equals semantics
            console.warn(`[ConditionExecutor] Unknown operator "${operator}" → using equals.`);
            result = (val1 === val2 || valRaw === val2 || isNumericMatch || isLooseMatch || valIndex === val2);
        }

        console.log(`[ConditionExecutor] Result: ${result} (Numeric: ${isNumericMatch}, Loose: ${isLooseMatch})`);

        // conditionNode doesn't send messages, just returns boolean for routing
        return {
            messages: [],
            wait_for_input: false,
            conditionResult: result
        };
    }
}
