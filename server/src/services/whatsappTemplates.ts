// Registro de templates de WhatsApp (HSM). Las claves lógicas las usa el scheduler;
// `metaName`/`lang` DEBEN coincidir con lo aprobado en Meta Business. Sin DB ni UI.
export interface TemplateComponent {
  type: 'body';
  parameters: Array<{ type: 'text'; text: string }>;
}
export interface BuiltTemplate {
  name: string;        // nombre aprobado en Meta
  lang: string;        // código de idioma (ej 'es_AR')
  components: TemplateComponent[];
  preview: string;     // texto renderizado, para guardar en el historial del inbox
}
interface TemplateDef {
  metaName: string;
  lang: string;
  paramCount: number;
  render: (p: string[]) => string; // preview legible
}

const LANG = 'es_AR'; // ⚠️ ajustar si Meta aprobó con otro código (ej 'es')

export const TEMPLATES = {
  reminder_24h: {
    metaName: 'recordatorio_cita_24h', lang: LANG, paramCount: 4,
    render: (p) => `Hola ${p[0]}, te recordamos tu cita en el estudio para el ${p[1]} a las ${p[2]} hs (${p[3]}). Si necesitás reprogramar, respondé este mensaje.`,
  },
  seguimiento: {
    metaName: 'seguimiento_post_cita', lang: LANG, paramCount: 1,
    render: (p) => `Hola ${p[0]}, gracias por tu visita. Quedamos a disposición por cualquier consulta sobre tu trámite. Si querés avanzar, respondé este mensaje.`,
  },
  reagendar: {
    metaName: 'reagendar_no_asistio', lang: LANG, paramCount: 2,
    render: (p) => `Hola ${p[0]}, no pudimos verte en tu cita del ${p[1]}. ¿Reprogramamos? Respondé este mensaje y coordinamos un nuevo turno.`,
  },
  docs_pendientes: {
    metaName: 'documentacion_pendiente', lang: LANG, paramCount: 2,
    render: (p) => `Hola ${p[0]}, para avanzar con tu trámite necesitamos: ${p[1]}. Podés acercarla al estudio o enviarla por este chat.`,
  },
} satisfies Record<string, TemplateDef>;

export type TemplateKey = keyof typeof TEMPLATES;

export function buildTemplate(key: TemplateKey, params: string[]): BuiltTemplate {
  const def = TEMPLATES[key];
  if (params.length !== def.paramCount) {
    throw new Error(`template ${key} espera ${def.paramCount} params, recibió ${params.length}`);
  }
  return {
    name: def.metaName,
    lang: def.lang,
    components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
    preview: def.render(params),
  };
}
