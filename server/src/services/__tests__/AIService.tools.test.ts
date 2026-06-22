import { describe, it, expect, vi, beforeEach } from 'vitest';

const posts: any[] = [];
let nextResponse: any = { data: { choices: [{ message: { content: 'hola' } }] } };
vi.mock('axios', () => ({
  default: { post: (url: string, body: any) => { posts.push({ url, body }); return Promise.resolve(nextResponse); } },
}));

import { AIService } from '../AIService';

describe('AIService.completeWithTools', () => {
  beforeEach(() => { posts.length = 0; process.env.OPENAI_API_KEY = 'sk-test'; });

  it('devuelve texto cuando el modelo no pide tools', async () => {
    nextResponse = { data: { choices: [{ message: { content: 'Hola, soy Sofía' } }] } };
    const res = await AIService.completeWithTools({ systemPrompt: 'sos sofía', messages: [{ role: 'user', content: 'hola' }], tools: [] });
    expect(res.content).toContain('Sofía');
    expect(res.toolCalls).toBeUndefined();
    expect(posts[0].body.tools).toEqual([]);
  });

  it('parsea tool_calls (name + args JSON) cuando el modelo invoca una tool', async () => {
    nextResponse = { data: { choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'search_knowledge', arguments: '{"query":"moratoria"}' } }] } }] } };
    const res = await AIService.completeWithTools({ systemPrompt: 's', messages: [{ role: 'user', content: 'moratoria?' }], tools: [{ type: 'function', function: { name: 'search_knowledge' } }] as any });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0]).toMatchObject({ id: 'c1', name: 'search_knowledge', args: { query: 'moratoria' } });
  });
});
