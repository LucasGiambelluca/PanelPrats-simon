import type { Change, Oficina } from './types';

const OFICINAS: Oficina[] = ['CABA', 'Quilmes', 'Haedo'];

const SCHEMAS = [
  { type: 'function', function: { name: 'set_tono', description: 'Reemplaza el tono/personalidad del agente.', parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } } },
  { type: 'function', function: { name: 'set_datos', description: 'Setea o agrega datos del estudio (horarios, precios, direcciones). modo: reemplazar | agregar (default agregar).', parameters: { type: 'object', properties: { texto: { type: 'string' }, modo: { type: 'string', enum: ['reemplazar', 'agregar'] } }, required: ['texto'] } } },
  { type: 'function', function: { name: 'set_procedimientos', description: 'Setea o agrega instrucciones de cómo proceder (los "flujos" en lenguaje natural). modo: reemplazar | agregar (default agregar).', parameters: { type: 'object', properties: { texto: { type: 'string' }, modo: { type: 'string', enum: ['reemplazar', 'agregar'] } }, required: ['texto'] } } },
  { type: 'function', function: { name: 'add_faq', description: 'Agrega una pregunta frecuente con su respuesta.', parameters: { type: 'object', properties: { pregunta: { type: 'string' }, respuesta: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['pregunta', 'respuesta'] } } },
  { type: 'function', function: { name: 'edit_faq', description: 'Edita una FAQ existente (identificada por su pregunta actual).', parameters: { type: 'object', properties: { pregunta: { type: 'string' }, nueva_respuesta: { type: 'string' }, nueva_pregunta: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['pregunta'] } } },
  { type: 'function', function: { name: 'remove_faq', description: 'Borra una FAQ por su pregunta.', parameters: { type: 'object', properties: { pregunta: { type: 'string' } }, required: ['pregunta'] } } },
  { type: 'function', function: { name: 'add_zona', description: 'Asocia una localidad a una oficina (CABA, Quilmes o Haedo) para el geo-routing.', parameters: { type: 'object', properties: { localidad: { type: 'string' }, oficina: { type: 'string', enum: OFICINAS } }, required: ['localidad', 'oficina'] } } },
  { type: 'function', function: { name: 'remove_zona', description: 'Quita una localidad del geo-routing.', parameters: { type: 'object', properties: { localidad: { type: 'string' } }, required: ['localidad'] } } },
];

const str = (v: any): string => (typeof v === 'string' ? v.trim() : '');

export class ConfigToolRegistry {
  schemas() { return SCHEMAS; }

  /** Convierte una tool-call del modelo en un Change validado. null si es inválida. */
  toChange(name: string, args: any): Change | null {
    switch (name) {
      case 'set_tono':
        return str(args?.texto) ? { type: 'set_tono', texto: str(args.texto) } : null;
      case 'set_datos':
        return str(args?.texto) ? { type: 'set_datos', texto: str(args.texto), modo: args?.modo === 'reemplazar' ? 'reemplazar' : 'agregar' } : null;
      case 'set_procedimientos':
        return str(args?.texto) ? { type: 'set_procedimientos', texto: str(args.texto), modo: args?.modo === 'reemplazar' ? 'reemplazar' : 'agregar' } : null;
      case 'add_faq':
        return str(args?.pregunta) && str(args?.respuesta) ? { type: 'add_faq', pregunta: str(args.pregunta), respuesta: str(args.respuesta), tags: Array.isArray(args?.tags) ? args.tags : [] } : null;
      case 'edit_faq':
        return str(args?.pregunta) ? { type: 'edit_faq', pregunta: str(args.pregunta), nueva_respuesta: str(args?.nueva_respuesta) || undefined, nueva_pregunta: str(args?.nueva_pregunta) || undefined, tags: Array.isArray(args?.tags) ? args.tags : undefined } : null;
      case 'remove_faq':
        return str(args?.pregunta) ? { type: 'remove_faq', pregunta: str(args.pregunta) } : null;
      case 'add_zona':
        return str(args?.localidad) && OFICINAS.includes(args?.oficina) ? { type: 'add_zona', localidad: str(args.localidad), oficina: args.oficina } : null;
      case 'remove_zona':
        return str(args?.localidad) ? { type: 'remove_zona', localidad: str(args.localidad) } : null;
      default:
        return null;
    }
  }
}
