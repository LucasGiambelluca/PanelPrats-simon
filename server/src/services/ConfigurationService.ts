// src/services/ConfigurationService.ts
//
// VERSIÓN REDUCIDA (Plan 2, Task 3): el ConfigurationService original leía/escribía
// tablas de comercio (`whatsapp_config`, `public_branding`) para branding, coords
// de tienda, política de envío, plantillas de pedido, etc. Para el motor genérico
// multicuenta NO portamos esa lógica de comercio. Mantenemos:
//   - `syncBotPhoneNumber(phone)`  -> no-op seguro (sin tablas de comercio).
//   - `getFullConfig()`            -> devuelve defaults genéricos en memoria.
//   - `clearCache()`               -> limpia el cache local.
// Cuando exista una fuente de configuración genérica por `account_id`
// (planes posteriores) se reconectarán las lecturas.

import { logger } from '../utils/logger';

export interface AppConfig {
    // Branding
    business_name: string;
    logo_url: string;
    accent_color: string;

    // Store Location
    store_lat: number | null;
    store_lng: number | null;
    store_address: string | null;
    store_city: string;

    // Business Logic
    shipping_policy: string;
    auto_print: boolean;
    auto_accept_orders: boolean;
    checkout_message: string;
    sileo_api_key: string | null;
    whatsapp_phone: string | null;

    // WhatsApp Templates
    template_confirmed?: string;
    template_preparation?: string;
    template_transit?: string;
    template_delivered?: string;
    template_cancelled?: string;
    template_ready?: string;
    template_arrived?: string;
}

const DEFAULT_CONFIG: AppConfig = {
    business_name: 'Negocio',
    logo_url: '',
    accent_color: '#dc2626',
    store_lat: null,
    store_lng: null,
    store_address: null,
    store_city: 'Bahía Blanca',
    shipping_policy: 'smart',
    auto_print: false,
    auto_accept_orders: false,
    checkout_message: '¡Gracias por tu pedido!',
    sileo_api_key: null,
    whatsapp_phone: null,
};

export class ConfigurationService {
    private static cache: AppConfig | null = null;
    private static lastFetch: number = 0;
    private static CACHE_TTL = 30000; // 30 seconds

    /**
     * Devuelve la configuración genérica (defaults en memoria).
     * Stub reducido: no consulta tablas de comercio.
     */
    public static async getFullConfig(_forceRefresh = false): Promise<AppConfig> {
        if (!this.cache) {
            this.cache = { ...DEFAULT_CONFIG };
            this.lastFetch = Date.now();
        }
        return this.cache;
    }

    /**
     * Limpia el cache de configuración.
     */
    public static clearCache(): void {
        this.cache = null;
        this.lastFetch = 0;
    }

    /**
     * Auto-sincroniza el número del bot. Stub reducido: no escribe tablas de
     * comercio; solo registra el número detectado (se reconectará a una fuente
     * genérica por account_id en planes posteriores).
     */
    public static async syncBotPhoneNumber(phone: string): Promise<void> {
        try {
            if (!phone) return;
            const cleanPhone = phone.replace(/\D/g, '');
            logger.info(`[ConfigurationService] (stub) bot phone detectado: ${cleanPhone}`);
        } catch (e: any) {
            logger.warn(`[ConfigurationService] Failed to sync bot phone number: ${e.message}`);
        }
    }
}
