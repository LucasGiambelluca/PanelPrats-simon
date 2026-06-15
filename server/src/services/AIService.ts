import axios from 'axios';
import { logger } from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

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

    static isAvailable(): boolean {
        return !!GROQ_API_KEY || !!GEMINI_API_KEY;
    }

    /**
     * Completes a text prompt using Groq (priority) or Gemini.
     */
    static async complete(options: AICompletionOptions): Promise<string> {
        const { systemPrompt, userMessage, history = [], jsonMode = false, maxTokens = 1024, temperature = 0.1 } = options;

        // Try Groq FIRST (Ultra fast & Reliable)
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
