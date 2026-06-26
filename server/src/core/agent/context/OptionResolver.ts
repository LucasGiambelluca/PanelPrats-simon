// ─── OptionResolver (Capacidad 4) ─────────────────────────────────────────────
// Resuelve referencias del usuario a opciones que el agente YA ofreció, sin gastar
// IA. Pensado para habla natural de adultos mayores: ordinales ("el tercero"),
// posicionales ("la opción 2"), semánticas ("el de videollamada", "a la tarde") y
// aceptaciones vagas ("cualquiera", "dale").
//
// Clave: el caller persiste las opciones ofrecidas (lastOfferedOptions). El resolver
// NO inventa: si no hay señal clara, devuelve matchedValue=null y deja decidir al caller.

import { norm } from './normalize';

export interface OfferedOption {
  index: number;   // 1-based, en el orden en que se presentó
  label: string;   // texto mostrado al usuario (ej "mié 02/07 09:00 hs")
  value: string;   // valor canónico a devolver (ej ISO del slot, nombre de oficina)
}

export interface OptionMatch {
  matchedValue: string | null;
  confianza: number; // 0..1
}

const NONE: OptionMatch = { matchedValue: null, confianza: 0 };

// Palabra → posición (1-based). Por raíz, así soporta diminutivos ("primerito").
const NUM_WORDS: Record<string, number> = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };

function ordinalFromWord(w: string): number | null {
  if (/^primer/.test(w)) return 1;   // primero, primera, primerito…
  if (/^segund/.test(w)) return 2;
  if (/^tercer/.test(w)) return 3;
  if (/^cuart/.test(w)) return 4;
  if (/^quint/.test(w)) return 5;
  if (w in NUM_WORDS) return NUM_WORDS[w];
  if (/^\d+$/.test(w)) return Number(w);
  const m = w.match(/^(\d+)(ro|do|ra|da|to|ta|mo|ma)$/); // 1ro, 2do, 3ra…
  if (m) return Number(m[1]);
  return null;
}

const ACCEPT_ANY = ['cualquiera', 'cualquier', 'el que sea', 'la que sea', 'lo que sea', 'me da igual', 'cualquier hora', 'cuando puedas', 'cuando sea'];
const SOONEST = ['mas cerca', 'mas cercano', 'lo antes', 'cuanto antes', 'mas temprano', 'lo mas pronto', 'mas pronto', 'mas rapido', 'primero que tengas', 'primero que haya'];
const BARE_OK = ['si', 'dale', 'ok', 'oka', 'okey', 'listo', 'bueno', 'perfecto', 'ese', 'esa', 'ese mismo', 'de acuerdo', 'va', 'esta bien'];

// Extrae la hora de la etiqueta CRUDA (la norm() borra el ':' y confunde la fecha
// con la hora). Busca "HH:MM" y, si no, "N hs".
function hourOf(rawLabel: string): number | null {
  const s = rawLabel || '';
  let m = s.match(/\b([01]?\d|2[0-3]):[0-5]\d/);
  if (m) return Number(m[1]);
  m = s.match(/\b([01]?\d|2[0-3])\s*(?:hs|h)\b/i);
  if (m) return Number(m[1]);
  return null;
}

// Hora HH:MM de la etiqueta CRUDA (la label de un slot trae "… 10:30 hs").
function labelTime(rawLabel: string): { h: number; m: number } | null {
  const m = (rawLabel || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)/);
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

// Hora pedida por el cliente en lenguaje natural: "a las 10", "a las 10:30",
// "el de las 12:30", "16 hs", "mediodía". Se corre sobre el texto CRUDO (la norm
// borra el ':'). Devuelve la hora pedida o 'mediodia'.
function requestedTime(rawText: string): { h: number; m?: number } | 'mediodia' | null {
  const t = (rawText || '').toLowerCase();
  if (/\bmediod[ií]a\b/.test(t)) return 'mediodia';
  let m = t.match(/\b(?:a\s+las|las|de\s+las)\s+([01]?\d|2[0-3])(?:[:.]([0-5]\d))?/);
  if (m) return { h: Number(m[1]), m: m[2] !== undefined ? Number(m[2]) : undefined };
  m = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);          // "10:30"
  if (m) return { h: Number(m[1]), m: Number(m[2]) };
  m = t.match(/\b([01]?\d|2[0-3])\s*(?:hs|h|horas)\b/);   // "16 hs"
  if (m) return { h: Number(m[1]) };
  return null;
}

// Última posición referida (soporta correcciones: "el segundo no, el primero").
function lastPosition(text: string, n: number): number | null {
  const words = text.split(' ');
  let pos: number | null = null;
  let outOfRange = false;
  for (const w of words) {
    const p = ordinalFromWord(w);
    if (p === null) continue;
    if (p >= 1 && p <= n) pos = p;       // dentro de rango
    else if (p > n) outOfRange = true;   // ej "el 9" con 3 opciones
  }
  if (pos === null && outOfRange) return null;
  return pos;
}

export function resolveOption(input: { userText: string; offered: OfferedOption[] }): OptionMatch {
  const offered = input.offered ?? [];
  if (offered.length === 0) return NONE;
  const text = norm(input.userText);
  if (!text) return NONE;
  const n = offered.length;
  const byIndex = (i: number) => offered.find((o) => o.index === i) ?? offered[i - 1];

  // 1) "del medio" / "el de al medio".
  if (/\b(del medio|al medio|el medio|la del medio)\b/.test(text)) {
    const mid = Math.round((n + 1) / 2);
    return { matchedValue: byIndex(mid).value, confianza: 0.85 };
  }

  // 2) "último" / "penúltimo".
  if (/\b(penultim\w*)\b/.test(text) && n >= 2) return { matchedValue: byIndex(n - 1).value, confianza: 0.9 };
  if (/\b(ultim\w*)\b/.test(text)) return { matchedValue: byIndex(n).value, confianza: 0.9 };

  // 2b) HORA en lenguaje natural: "a las 10", "el del mediodía", "16:00".
  // Va ANTES del ordinal para que "a las 10" no se interprete como "la opción 10".
  const tReq = requestedTime(input.userText);
  if (tReq) {
    const cand = offered.map((o) => ({ o, t: labelTime(o.label) })).filter((x) => x.t) as Array<{ o: OfferedOption; t: { h: number; m: number } }>;
    if (cand.length) {
      if (tReq === 'mediodia') {
        const mid = cand.filter((x) => x.t.h === 12 || x.t.h === 13).sort((a, b) => Math.abs(a.t.h * 60 + a.t.m - 750) - Math.abs(b.t.h * 60 + b.t.m - 750));
        if (mid.length) return { matchedValue: mid[0].o.value, confianza: 0.85 };
      } else {
        const exact = cand.filter((x) => x.t.h === tReq.h && (tReq.m === undefined || x.t.m === tReq.m));
        if (exact.length) return { matchedValue: exact[0].o.value, confianza: 0.9 };
        const sameHour = tReq.m === undefined ? cand.filter((x) => x.t.h === tReq.h) : [];
        if (sameHour.length) return { matchedValue: sameHour[0].o.value, confianza: 0.85 };
        // Sin match exacto: el más cercano si está razonablemente cerca (≤90 min).
        const target = tReq.h * 60 + (tReq.m ?? 0);
        const closest = cand.slice().sort((a, b) => Math.abs(a.t.h * 60 + a.t.m - target) - Math.abs(b.t.h * 60 + b.t.m - target))[0];
        if (Math.abs(closest.t.h * 60 + closest.t.m - target) <= 90) return { matchedValue: closest.o.value, confianza: 0.6 };
      }
    }
  }

  // 3) ordinal / posicional (toma el ÚLTIMO mencionado → soporta correcciones).
  const pos = lastPosition(text, n);
  if (pos && pos >= 1 && pos <= n) return { matchedValue: byIndex(pos).value, confianza: 0.95 };
  // número fuera de rango explícito → no adivinar.
  if (/\b\d+\b/.test(text) && pos === null && !ACCEPT_ANY.some((p) => text.includes(p))) {
    const num = Number(text.match(/\b(\d+)\b/)![1]);
    if (num > n) return NONE;
  }

  // 4) "lo antes posible" / "más temprano" → el primero (los slots vienen ordenados).
  if (SOONEST.some((p) => text.includes(p))) return { matchedValue: byIndex(1).value, confianza: 0.6 };

  // 5) semántico por turno: mañana (<13) / tarde (>=13).
  const wantsMorning = /\b(manana|temprano|tempranito)\b/.test(text);
  const wantsAfternoon = /\b(tarde|tardecita|despues de almorzar|despuesito)\b/.test(text);
  if (wantsMorning || wantsAfternoon) {
    const cand = offered.filter((o) => {
      const h = hourOf(o.label);
      if (h === null) return false;
      return wantsMorning ? h < 13 : h >= 13;
    });
    if (cand.length === 1) return { matchedValue: cand[0].value, confianza: 0.85 };
    if (cand.length > 1) return { matchedValue: cand[0].value, confianza: 0.6 };
  }

  // 6) modalidad video (palabra clave explícita).
  const wantsVideo = /\b(video|videollamada|llamada|por video|virtual|zoom|meet|por telefono|telefonica|pantalla|computadora)\b/.test(text);
  const wantsPresencial = /\b(presencial|en persona|ir|me acerco|paso por|oficina|personalmente|acercarme)\b/.test(text);
  if (wantsVideo) {
    const cand = offered.filter((o) => /video|llamada|virtual/.test(norm(o.label + ' ' + o.value)));
    if (cand.length >= 1) return { matchedValue: cand[0].value, confianza: 0.85 };
  }

  // 7) contenido específico de la etiqueta (ej "me acerco a Quilmes"). Va ANTES del
  //    presencial genérico: nombrar una opción puntual gana sobre "voy en persona".
  const userTokens = text.split(' ').filter((w) => w.length >= 4);
  if (userTokens.length) {
    const scored = offered
      .map((o) => {
        const hay = norm(o.label + ' ' + o.value).split(' ');
        const score = userTokens.filter((t) => hay.includes(t)).length;
        return { o, score };
      })
      .filter((s) => s.score >= 1)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 1 || (scored.length > 1 && scored[0].score > scored[1].score)) {
      return { matchedValue: scored[0].o.value, confianza: 0.8 };
    }
  }

  // 8) presencial genérico → primera opción presencial.
  if (wantsPresencial) {
    const cand = offered.filter((o) => /presencial/.test(norm(o.label)) || !/video|llamada|virtual/.test(norm(o.label + ' ' + o.value)));
    if (cand.length === 1) return { matchedValue: cand[0].value, confianza: 0.85 };
    if (cand.length > 1) return { matchedValue: cand[0].value, confianza: 0.6 };
  }

  // 8) aceptación vaga → elegir el primero, confianza media (el agente confirma).
  if (ACCEPT_ANY.some((p) => text.includes(p))) return { matchedValue: byIndex(1).value, confianza: 0.55 };

  // 9) "dale"/"ese"/"sí" pelado: solo si hay UNA opción (sino es ambiguo).
  if (BARE_OK.includes(text)) {
    if (n === 1) return { matchedValue: byIndex(1).value, confianza: 0.7 };
    return NONE; // varias opciones + "sí" → ambiguo, no adivinar
  }

  return NONE;
}
