interface AILike { complete: (opts: any) => Promise<string> }

const EXTRACT_PROMPT = [
  'Extraé memoria del cliente de esta conversación. Respondé SOLO JSON con esta forma:',
  '{"profile":{...},"preferences":{...},"summary":"resumen corto en una o dos frases"}',
  'En profile poné solo datos seguros que el cliente haya dicho (nombre, edad, situacion_previsional, localidad).',
  'No inventes. Si no hay datos para un campo, omitilo.',
].join('\n');

export async function extractMemoryPatch(ai: AILike, turns: Array<{ role: string; content: string }>): Promise<{
  profile: Record<string, any>; preferences: Record<string, any>; summary: string | null;
}> {
  const convo = turns.map((t) => `${t.role === 'user' ? 'Cliente' : 'Bot'}: ${t.content}`).join('\n');
  try {
    const raw = await ai.complete({ systemPrompt: EXTRACT_PROMPT, userMessage: convo, jsonMode: true, temperature: 0 });
    const parsed = JSON.parse(raw);
    return {
      profile: parsed.profile ?? {},
      preferences: parsed.preferences ?? {},
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
    };
  } catch {
    return { profile: {}, preferences: {}, summary: null };
  }
}
