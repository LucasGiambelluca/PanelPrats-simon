import { useState } from 'react';

// Instrucciones + textos exactos de los 4 templates de WhatsApp que hay que dar de
// alta en Meta Business para que el agente pueda mandar mensajes proactivos (fuera
// de la ventana de 24h). Página estática de ayuda para recepción/admin.

interface Plantilla {
  key: string;
  nombre: string;
  categoria: string;
  idioma: string;
  cuerpo: string;
  variables: { n: string; ejemplo: string; sentido: string }[];
}

const PLANTILLAS: Plantilla[] = [
  {
    key: 'reminder_24h',
    nombre: 'recordatorio_cita_24h',
    categoria: 'Utilidad (Utility)',
    idioma: 'Español (Argentina) — es_AR',
    cuerpo: 'Hola {{1}}, te recordamos tu cita en el estudio para el {{2}} a las {{3}} hs ({{4}}). Si necesitás reprogramar, respondé este mensaje.',
    variables: [
      { n: '{{1}}', ejemplo: 'María', sentido: 'nombre del cliente' },
      { n: '{{2}}', ejemplo: 'martes 8/7', sentido: 'fecha de la cita' },
      { n: '{{3}}', ejemplo: '15:30', sentido: 'hora' },
      { n: '{{4}}', ejemplo: 'Sede Centro', sentido: 'sede / modalidad' },
    ],
  },
  {
    key: 'seguimiento',
    nombre: 'seguimiento_post_cita',
    categoria: 'Utilidad (Utility)',
    idioma: 'Español (Argentina) — es_AR',
    cuerpo: 'Hola {{1}}, gracias por tu visita. Quedamos a disposición por cualquier consulta sobre tu trámite. Si querés avanzar, respondé este mensaje.',
    variables: [
      { n: '{{1}}', ejemplo: 'María', sentido: 'nombre del cliente' },
    ],
  },
  {
    key: 'reagendar',
    nombre: 'reagendar_no_asistio',
    categoria: 'Utilidad (Utility)',
    idioma: 'Español (Argentina) — es_AR',
    cuerpo: 'Hola {{1}}, no pudimos verte en tu cita del {{2}}. ¿Reprogramamos? Respondé este mensaje y coordinamos un nuevo turno.',
    variables: [
      { n: '{{1}}', ejemplo: 'María', sentido: 'nombre del cliente' },
      { n: '{{2}}', ejemplo: 'martes 8/7', sentido: 'fecha de la cita perdida' },
    ],
  },
  {
    key: 'docs_pendientes',
    nombre: 'documentacion_pendiente',
    categoria: 'Utilidad (Utility)',
    idioma: 'Español (Argentina) — es_AR',
    cuerpo: 'Hola {{1}}, para avanzar con tu trámite necesitamos: {{2}}. Podés acercarla al estudio o enviarla por este chat.',
    variables: [
      { n: '{{1}}', ejemplo: 'María', sentido: 'nombre del cliente' },
      { n: '{{2}}', ejemplo: 'DNI, recibos de sueldo, clave ANSES', sentido: 'lista de documentos' },
    ],
  },
];

function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    } catch { /* clipboard bloqueado: no romper */ }
  };
  return (
    <button
      onClick={copiar}
      className="text-xs px-2 py-1 rounded bg-brand-gold text-brand-ink font-semibold hover:opacity-90 whitespace-nowrap"
    >{ok ? '✓ Copiado' : 'Copiar'}</button>
  );
}

export default function TemplatesWhatsApp() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <h1 className="text-xl font-bold text-brand-ink">Plantillas de WhatsApp (Meta)</h1>
      <p className="text-sm text-brand-inkmuted mt-1">
        El agente manda recordatorios y seguimientos <b>proactivos</b> (24 hs antes del turno,
        después de la reunión, y para pedir documentación). WhatsApp solo permite estos mensajes
        fuera de la conversación si usan <b>plantillas aprobadas por Meta</b>. Cargá estas 4 en
        Meta Business una sola vez.
      </p>

      {/* Pasos */}
      <div className="mt-5 rounded-lg border border-brand-gold/40 bg-brand-panel p-4">
        <h2 className="font-semibold text-brand-ink text-sm mb-2">Cómo cargarlas en Meta</h2>
        <ol className="list-decimal list-inside space-y-1 text-sm text-brand-inkmuted">
          <li>Entrá a <b>business.facebook.com</b> → <b>WhatsApp Manager</b> → <b>Plantillas de mensajes</b>.</li>
          <li>Tocá <b>Crear plantilla</b>.</li>
          <li>Elegí <b>Categoría: Utilidad</b> e <b>Idioma: Español (Argentina)</b>.</li>
          <li>Pegá el <b>Nombre</b> y el <b>Cuerpo</b> exactos de cada tarjeta de abajo.</li>
          <li>Donde Meta pide <b>valores de ejemplo</b> para las variables, usá los ejemplos que figuran.</li>
          <li>Enviá a revisión. Meta aprueba en general en <b>~1 día</b>.</li>
          <li>Cuando estén <b>aprobadas</b>, avisá al equipo técnico el <b>nombre exacto</b> y el <b>idioma</b> con que quedaron (deben coincidir carácter por carácter con lo cargado en el sistema).</li>
        </ol>
        <p className="text-xs text-brand-inkmuted mt-2">
          ⚠️ Respetá el orden de las variables <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>… y no las pegues juntas ni al principio del texto: Meta rechaza esos casos.
        </p>
      </div>

      {/* Plantillas */}
      <div className="mt-5 space-y-4">
        {PLANTILLAS.map((p) => (
          <div key={p.key} className="rounded-lg border border-brand-panel overflow-hidden">
            <div className="bg-brand-panel px-4 py-2 flex items-center justify-between gap-2">
              <div>
                <div className="font-mono text-sm font-semibold text-brand-ink">{p.nombre}</div>
                <div className="text-xs text-brand-inkmuted">{p.categoria} · {p.idioma}</div>
              </div>
              <Copiar texto={p.nombre} />
            </div>
            <div className="p-4 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-brand-inkmuted uppercase tracking-wide">Cuerpo</span>
                  <Copiar texto={p.cuerpo} />
                </div>
                <p className="text-sm text-brand-ink bg-brand-panel/50 rounded p-2">{p.cuerpo}</p>
              </div>
              <div>
                <span className="text-xs font-semibold text-brand-inkmuted uppercase tracking-wide">Variables / ejemplos</span>
                <table className="w-full text-sm mt-1">
                  <tbody>
                    {p.variables.map((v) => (
                      <tr key={v.n} className="border-t border-brand-panel">
                        <td className="py-1 pr-2 font-mono whitespace-nowrap">{v.n}</td>
                        <td className="py-1 pr-2 text-brand-inkmuted">{v.sentido}</td>
                        <td className="py-1 font-medium text-brand-ink">{v.ejemplo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
