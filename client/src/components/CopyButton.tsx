import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Botón "copiar al portapapeles" para campos de configuración (webhook URL,
 * verify token, etc.). Pensado para usuarios no técnicos: un click copia y
 * confirma visualmente. Fallback a execCommand si el navegador no expone
 * navigator.clipboard (http sin TLS, contextos no seguros).
 */
export function CopyButton({ value, label = 'Valor', className = '' }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success(`${label} copiado`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('No se pudo copiar');
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copiar ${label}`}
      aria-label={`Copiar ${label}`}
      className={`flex items-center justify-center p-2 rounded-lg border border-brand-hairline bg-black/[0.03] hover:bg-black/[0.07] text-brand-inkmuted hover:text-brand-ink transition-all ${className}`}
    >
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </button>
  );
}

/**
 * URL pública del webhook de Meta que se pega en Meta for Developers.
 * Prefiere `apiBase` (VITE_API_URL horneada en build). Si apiBase apunta a
 * localhost pero la página NO se sirve desde localhost (prod sin build arg),
 * cae a `window.location.origin` para no mostrar una URL inservible.
 */
export function metaWebhookUrl(apiBase: string): string {
  let base = apiBase;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if ((!base || base.includes('localhost')) && origin && !origin.includes('localhost')) {
    base = origin;
  }
  return `${base}/api/webhooks/meta`;
}

/** Genera un verify token aleatorio legible para pegar en Meta. */
export function generateVerifyToken(): string {
  const rand = (globalThis.crypto?.randomUUID?.() ?? `${Math.random()}${Math.random()}`).replace(/[^a-z0-9]/gi, '');
  return `pys_${rand.slice(0, 16)}`;
}
