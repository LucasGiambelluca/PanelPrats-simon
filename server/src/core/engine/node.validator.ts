import { z } from 'zod';

export const MessageNodeSchema = z.object({
    text: z.string().optional(),
    message: z.string().optional(),
}).refine(data => data.text || data.message, {
    message: "Either 'text' or 'message' must be provided"
});

export const QuestionNodeSchema = z.object({
    question: z.string(),
    variable: z.string().optional(),
});

export const PollNodeSchema = z.object({
    question: z.string(),
    options: z.array(z.string()).min(1),
    variable: z.string().optional(),
});

export const ConditionNodeSchema = z.object({
    variable: z.string(),
    operator: z.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than']).optional(),
    expectedValue: z.any().optional(),
});

export const NodeSchemas: Record<string, z.ZodTypeAny> = {
    'messageNode': MessageNodeSchema,
    'questionNode': QuestionNodeSchema,
    'pollNode': PollNodeSchema,
    'conditionNode': ConditionNodeSchema,
    // Add more as needed
};

export function validateNode(type: string, data: any) {
    const schema = NodeSchemas[type];
    if (!schema) return { success: true, data }; // Skip if no schema defined
    return schema.safeParse(data);
}
