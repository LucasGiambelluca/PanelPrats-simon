import axios from 'axios';
import { logger } from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

export interface AICompletionOptions {
    systemPrompt: string;
    userMessage: string;
    history?: { role: 'user' | 'assistant', content: string }[];
    jsonMode?: boolean;
    maxTokens?: number;
    temperature?: number;
    apiKey?: string; // Clave opcional inyectada desde el nodo
    model?: string;  // Modelo opcional inyectado desde el nodo
}

/**
 * Core AI Service — now supports Google Gemini for reasoning.
 * Keeps Groq Whisper for ultra-fast audio transcription.
 */
export class AIService {
    private static GEMINI_MODEL = 'gemini-pro';
    private static GROQ_MODEL = 'llama-3.3-70b-versatile';
    private static OPENAI_MODEL = 'gpt-4o-mini';

    static isAvailable(): boolean {
        return !!OPENAI_API_KEY || !!GROQ_API_KEY || !!GEMINI_API_KEY;
    }

    /**
     * Completes a text prompt using Groq (priority) or Gemini.
     */
    static async complete(options: AICompletionOptions): Promise<string> {
        const { systemPrompt, userMessage, history = [], jsonMode = false, maxTokens = 1024, temperature = 0.1 } = options;

        const apiMessagesBase = [
            { role: 'system', content: systemPrompt },
            ...history.map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: userMessage },
        ];
        const wantsJson = jsonMode || systemPrompt.includes('JSON');

        // Try OpenAI FIRST si hay key (formato OpenAI estándar).
        if (OPENAI_API_KEY) {
            try {
                // Key/model inyectados desde el nodo solo si parecen de OpenAI.
                const apiKey = options.apiKey?.startsWith('sk-') ? options.apiKey : OPENAI_API_KEY;
                const model = options.model?.includes('gpt') ? options.model : AIService.OPENAI_MODEL;

                const response = await axios.post(
                    OPENAI_API_URL,
                    {
                        model,
                        messages: apiMessagesBase,
                        max_tokens: maxTokens,
                        temperature,
                        ...(wantsJson ? { response_format: { type: 'json_object' } } : {}),
                    },
                    { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20000 }
                );
                return response.data?.choices?.[0]?.message?.content || '';
            } catch (err: any) {
                const msg = err.response?.data?.error?.message || err.message;
                logger.warn(`[AI] OpenAI failed, probando siguiente proveedor`, { error: msg });
            }
        }

        // Try Groq (Ultra fast & Reliable)
        if (GROQ_API_KEY) {
            try {
                const apiMessages = [
                    { role: 'system', content: systemPrompt },
                    ...history.map(h => ({ role: h.role, content: h.content })),
                    { role: 'user', content: userMessage }
                ];

                // Si el usuario inyectó una clave que no parece de Groq, usamos la del .env
                const isGroqKey = options.apiKey?.startsWith('gsk_');
                const currentApiKey = isGroqKey ? options.apiKey : GROQ_API_KEY;

                // Si el modelo inyectado no parece de Groq (o no hay), usamos el default
                const isGroqModel = options.model?.includes('llama') || options.model?.includes('mixtral');
                const currentModel = isGroqModel ? options.model : AIService.GROQ_MODEL;

                const isJson = jsonMode || systemPrompt.includes('JSON');

                const response = await axios.post(
                    GROQ_API_URL,
                    {
                        model: currentModel,
                        messages: apiMessages,
                        max_tokens: maxTokens,
                        temperature,
                        ...(isJson ? { response_format: { type: 'json_object' } } : {}),
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${currentApiKey}`,
                            'Content-Type': 'application/json',
                        },
                        timeout: 10000,
                    }
                );

                const content = response.data?.choices?.[0]?.message?.content || '';
                return content;
            } catch (err: any) {
                const msg = err.response?.data?.error?.message || err.message;
                logger.warn(`[AI] Groq failed, falling back to Gemini`, { error: msg });
            }
        }

        // --- FALLBACK A GEMINI ---
        // Solo usamos la apiKey inyectada si parece ser de Google (empieza con AIza)
        const isGeminiKey = options.apiKey?.startsWith('AIza');
        const currentGeminiKey = isGeminiKey ? options.apiKey : GEMINI_API_KEY;

        // Solo usamos el modelo inyectado si parece ser de Gemini
        const isGeminiModel = options.model?.includes('gemini');
        const currentGeminiModel = isGeminiModel ? options.model : 'gemini-1.5-flash';

        // Fallback to Gemini (REST call for maximum reliability)
        if (currentGeminiKey) {
            try {
                // Usamos v1beta para máxima compatibilidad con modelos nuevos
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentGeminiModel}:generateContent?key=${currentGeminiKey}`;

                // Construct contents for Gemini REST API
                const contents = [
                    { role: 'user', parts: [{ text: `INSTRUCCIONES DEL SISTEMA:\n${systemPrompt}` }] },
                    { role: 'model', parts: [{ text: "Entendido. Procesaré la solicitud siguiendo esas pautas." }] }
                ];

                // Add history
                if (history && history.length > 0) {
                    contents.push(...history.map(h => ({
                        role: h.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: h.content }]
                    })));
                }

                // Add current message
                contents.push({ role: 'user', parts: [{ text: userMessage }] });

                const sanitizedUrl = url.replace(/key=.*$/, 'key=***');
                logger.info(`[AI] Calling Gemini REST: ${sanitizedUrl}`);

                const response = await axios.post(url, {
                    contents,
                    generationConfig: {
                        maxOutputTokens: maxTokens,
                        temperature: temperature,
                    }
                }, { timeout: 15000 });

                const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (!text) throw new Error("Respuesta vacía de Gemini");
                return text;
            } catch (err: any) {
                const msg = err.response?.data?.error?.message || err.message;
                logger.error(`[AI] Gemini REST fallback error`, { error: msg });
                throw new Error(`AI Services unavailable: ${msg}`);
            }
        }

        throw new Error('No AI provider configured');
    }

  /**
   * Completion con function-calling (OpenAI/Groq compatible). Para el AgentRuntime.
   * Devuelve { content } si el modelo respondió texto, o { toolCalls } si pidió tools.
   * Usa el endpoint OpenAI (primario) o Groq como fallback; Gemini NO se usa acá
   * (su API de tools difiere; el agente piloto corre sobre OpenAI/Groq).
   */
  static async completeWithTools(opts: {
    systemPrompt: string;
    messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; name?: string }>;
    tools: any[];
    apiKey?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ content?: string; toolCalls?: Array<{ id: string; name: string; args: any }> }> {
    const messages = [{ role: 'system', content: opts.systemPrompt }, ...opts.messages];
    const body: any = {
      messages,
      tools: opts.tools,
      tool_choice: 'auto',
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.3,
    };

    const targets: Array<{ url: string; key?: string; model: string }> = [];
    if (OPENAI_API_KEY || opts.apiKey?.startsWith('sk-')) {
      targets.push({ url: OPENAI_API_URL, key: opts.apiKey?.startsWith('sk-') ? opts.apiKey : OPENAI_API_KEY, model: opts.model?.includes('gpt') ? opts.model : AIService.OPENAI_MODEL });
    }
    if (GROQ_API_KEY) targets.push({ url: GROQ_API_URL, key: GROQ_API_KEY, model: AIService.GROQ_MODEL });

    let lastErr: any;
    for (const t of targets) {
      try {
        const resp = await axios.post(t.url, { ...body, model: t.model },
          { headers: { Authorization: `Bearer ${t.key}`, 'Content-Type': 'application/json' }, timeout: 25000 });
        const msg = resp.data?.choices?.[0]?.message ?? {};
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
          const toolCalls = msg.tool_calls.map((c: any) => {
            let args: any = {};
            try { args = JSON.parse(c.function?.arguments ?? '{}'); } catch { args = {}; }
            return { id: c.id, name: c.function?.name, args };
          });
          return { toolCalls };
        }
        return { content: msg.content ?? '' };
      } catch (err: any) {
        lastErr = err;
        logger.warn('[AI] completeWithTools proveedor falló, probando siguiente', { error: err?.response?.data?.error?.message ?? err?.message });
      }
    }
    throw lastErr ?? new Error('Sin proveedor de IA disponible para tools');
  }

    /**
     * Transcribes audio using Groq Whisper.
     */
    static async transcribe(audioBuffer: Buffer, fileName: string = 'audio.ogg'): Promise<string> {
        if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured for transcription');

        try {
            const formData = new FormData();
            const blob = new Blob([new Uint8Array(audioBuffer)]);
            formData.append('file', blob, fileName);
            formData.append('model', 'whisper-large-v3');
            formData.append('response_format', 'json');
            formData.append('language', 'es');

            const response = await axios.post(
                'https://api.groq.com/openai/v1/audio/transcriptions',
                formData,
                {
                    headers: {
                        'Authorization': `Bearer ${GROQ_API_KEY}`,
                    },
                    timeout: 25000,
                }
            );

            const text = response.data?.text || '';

            // PERSISTENT LOG FOR AUDITING
            fs.appendFileSync('audit_conversations.log', `[${new Date().toISOString()}] [WHISPER] AUDIO TRANSCRIPTION: "${text}"\n`);

            // LOG AUDITING (as requested by user)
            logger.info(`[AUDIT] Audio Transcription: "${text}"`, { fileName });

            return text;
        } catch (err: any) {
            const msg = err.response?.data?.error?.message || err.message;
            logger.error(`[AI] Groq Transcription error`, { error: msg });
            throw new Error(`Groq Whisper: ${msg}`);
        }
    }

    /**
     * Structured JSON extraction.
     */
    static async extractJSON<T = any>(options: AICompletionOptions): Promise<T | null> {
        try {
            const raw = await AIService.complete({ ...options, jsonMode: true });

            // Gemini sometimes wraps JSON in markdown blocks
            const cleanRaw = raw.replace(/```json\n?/, '').replace(/```\n?$/, '').trim();

            return JSON.parse(cleanRaw) as T;
        } catch (err: any) {
            logger.warn(`[AI] JSON extraction failed`, { error: err.message });
            return null;
        }
    }
}
