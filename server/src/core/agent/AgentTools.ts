// ─── AgentTools (Panel genérico) ──────────────────────────────────────────────
// Versión generalizada para el panel multicuenta: se conserva la API original
// (findProductWithScore, loadToolsContext, formatToolsForPrompt, resolveItems)
// para que AgentNode.ts no necesite cambiar, pero la carga de catálogo /
// pedidos / horarios desde Supabase fue REEMPLAZADA por contexto vacío/genérico.
// El agente queda como "LLM con memoria conversacional" sin acoplamiento a comercio.
//
// La similitud Jaccard (Pilar 4) se mantiene intacta: si en el futuro alguien
// inyecta un catálogo, resolveItems/findProductWithScore siguen funcionando.

import type { Product, Order, BusinessHours, ToolsContext, ProductMatch } from './AgentTypes';

// ─── Jaccard Similarity (Pilar 4) ────────────────────────────────────────────
// Tomado sin cambios porque el algoritmo es correcto y puro (sin DB).

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')   // quita acentos
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(Boolean);
}

function jaccardScore(a: string[], b: string[]): number {
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = [...setA].filter(t => setB.has(t)).length;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 0 : intersection / union;
}

export function findProductWithScore(
    query: string,
    products: Product[],
    threshold = 0.15
): ProductMatch | null {
    const queryTokens = tokenize(query);
    let best: ProductMatch | null = null;

    for (const product of products) {
        const productTokens = tokenize(product.name);
        const score = jaccardScore(queryTokens, productTokens);
        if (score >= threshold && (!best || score > best.score)) {
            best = { product, score };
        }
    }

    return best;
}

// ─── Tool: Stock — GENERALIZADO (sin catálogo de comercio) ────────────────────
// Antes consultaba ProductService/Supabase. Ahora devuelve catálogo vacío:
// el panel genérico no asume un modelo de productos.

export async function fetchStock(): Promise<Product[]> {
    return [];
}

// ─── Tool: Último pedido — GENERALIZADO (sin tabla de pedidos) ────────────────
// Antes consultaba la tabla `orders` de Supabase. Ahora devuelve null.

export async function fetchLastOrder(_clientPhone: string): Promise<Order | null> {
    return null;
}

// ─── Tool: Horarios — GENERALIZADO (sin config de comercio) ───────────────────
// Antes leía `app_settings.business_hours`. Ahora devuelve un default fail-open
// (siempre "abierto") sin tocar la DB.

export async function fetchBusinessHours(): Promise<BusinessHours> {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return {
        open: '00:00',
        close: '23:59',
        isOpen: true,
        message: `Disponible (${currentTime}hs).`,
    };
}

// ─── Carga todos los tools en paralelo (contexto genérico) ────────────────────
// Se conserva la firma y la forma del ToolsContext; el contenido es genérico.

export async function loadToolsContext(clientPhone?: string): Promise<ToolsContext> {
    const [products, lastOrder, businessHours] = await Promise.all([
        fetchStock(),
        clientPhone ? fetchLastOrder(clientPhone) : Promise.resolve(null),
        fetchBusinessHours(),
    ]);
    return { products, lastOrder, businessHours };
}

// ─── Formatea el contexto de tools para el prompt ────────────────────────────
// Pura: si el contexto viene vacío (caso genérico), produce string vacío.

export function formatToolsForPrompt(ctx: ToolsContext): string {
    const lines: string[] = [];

    if (ctx.businessHours) {
        lines.push(`[ESTADO] ${ctx.businessHours.message}`);
    }

    if (ctx.products && ctx.products.length > 0) {
        const productList = ctx.products
            .map(p => `  - ${p.name}: $${p.price}`)
            .join('\n');
        lines.push(`[CATÁLOGO DISPONIBLE]\n${productList}`);
    }

    if (ctx.lastOrder) {
        const itemList = ctx.lastOrder.items
            .map(i => `${i.qty}x ${i.name}`)
            .join(', ');
        lines.push(`[ÚLTIMO PEDIDO DEL CLIENTE] ${itemList} — Estado: ${ctx.lastOrder.status}`);
    }

    return lines.join('\n\n');
}

// ─── Resuelve items de la IA contra el catálogo real ─────────────────────────
// Pura: con catálogo vacío (caso genérico) devuelve los items sin resolver.

export function resolveItems(
    items: { name: string; qty: number }[] | undefined,
    products: Product[]
): { name: string; qty: number; resolvedName?: string; resolvedId?: string; price?: number; matchScore?: number }[] {
    if (!items || items.length === 0) return [];
    return items.map(item => {
        const match = findProductWithScore(item.name, products);
        if (match && match.score > 0.15) {
            return {
                ...item,
                resolvedName: match.product.name,
                resolvedId: match.product.id,
                price: match.product.price,
                matchScore: match.score,
            };
        }
        return item;
    });
}
