import React, { useState } from 'react';
import { MessageSquare, HelpCircle, GitFork, BarChart2, Store, ArrowRightCircle, UploadCloud, FileText, PauseCircle, Clock, ChevronLeft, ChevronRight, AlertTriangle, Image, Search, Brain, Mic, Bot, Zap, Database, Scissors, Spline, MousePointerClick, CalendarPlus, Sliders, UserSearch, Download } from 'lucide-react';

export const nodeItems = [
  { type: 'webhookNode', icon: Zap, label: 'Hook / Inicio', desc: 'Gatillo de entrada.', bg: 'bg-amber-100', text: 'text-amber-600' },
  { type: 'mediaTypeDetectorNode', icon: Mic, label: 'Detector Media', desc: '¿Audio o Texto?', bg: 'bg-violet-100', text: 'text-violet-600' },
  { type: 'keywordNode', icon: Search, label: 'Keyword Switch', desc: 'Busca palabras clave y ramifica.', bg: 'bg-indigo-100', text: 'text-indigo-600' },
  { type: 'switchNode', icon: GitFork, label: 'Switch Universal', desc: 'Ramifica según valor de variable.', bg: 'bg-amber-100', text: 'text-amber-600' },
  { type: 'bufferMemoryNode', icon: Database, label: 'Pila Memoria', desc: 'Historial de chat para IA.', bg: 'bg-indigo-100', text: 'text-indigo-600' },
  { type: 'aiAgentNode', icon: Bot, label: 'Agente IA', desc: 'IA con memoria conversacional.', bg: 'bg-fuchsia-100', text: 'text-fuchsia-600' },
  { type: 'messageNode', icon: MessageSquare, label: 'Mensaje', desc: 'Envía un texto simple.', bg: 'bg-blue-100', text: 'text-blue-600' },
  { type: 'questionNode', icon: HelpCircle, label: 'Pregunta', desc: 'Espera una respuesta.', bg: 'bg-yellow-100', text: 'text-yellow-600' },
  { type: 'pollNode', icon: BarChart2, label: 'Encuesta', desc: 'Opciones múltiples.', bg: 'bg-purple-100', text: 'text-purple-600' },
  { type: 'conditionNode', icon: GitFork, label: 'Condición', desc: 'Ramifica según variable.', bg: 'bg-orange-100', text: 'text-orange-600' },
  { type: 'genderNode', icon: UserSearch, label: 'Género (IA)', desc: 'Pide el nombre y ramifica hombre/mujer.', bg: 'bg-fuchsia-100', text: 'text-fuchsia-600' },
  { type: 'flowLinkNode', icon: ArrowRightCircle, label: 'Ir a Flujo', desc: 'Salta a otro flujo (pasa variables).', bg: 'bg-gray-100', text: 'text-gray-600' },
  { type: 'captureVarNode', icon: Download, label: 'Capturar Variable', desc: 'Recibe variables de otro flujo.', bg: 'bg-teal-100', text: 'text-teal-600' },
  { type: 'mediaUploadNode', icon: UploadCloud, label: 'Recibir Archivo', desc: 'Pide un archivo.', bg: 'bg-pink-100', text: 'text-pink-600' },
  { type: 'documentNode', icon: FileText, label: 'Enviar PDF', desc: 'Genera comprobante.', bg: 'bg-red-100', text: 'text-red-600' },
  { type: 'threadNode', icon: PauseCircle, label: 'Control Bot', desc: 'Pausa/Reanuda.', bg: 'bg-orange-100', text: 'text-orange-600' },
  { type: 'timerNode', icon: Clock, label: 'Timer / Espera', desc: 'Pausa el flujo.', bg: 'bg-blue-100', text: 'text-blue-600' },
  { type: 'reportNode', icon: AlertTriangle, label: 'Reporte', desc: 'Crea un registro.', bg: 'bg-red-100', text: 'text-red-600' },
  { type: 'appointmentNode', icon: CalendarPlus, label: 'Agendar Cita', desc: 'Guarda nombre, teléfono y resumen.', bg: 'bg-teal-100', text: 'text-teal-600' },
  { type: 'appointmentAvailabilityNode', icon: CalendarPlus, label: 'Consultar Cita', desc: 'Verifica disponibilidad horaria.', bg: 'bg-emerald-100', text: 'text-emerald-600' },
  { type: 'appointmentProposalsNode', icon: Sliders, label: 'Sugerir Horarios', desc: 'Ofrece turnos libres cercanos.', bg: 'bg-emerald-100', text: 'text-emerald-600' },
  { type: 'handoverNode', icon: HelpCircle, label: 'Asesor Humano', desc: 'Pausa el bot y avisa.', bg: 'bg-rose-100', text: 'text-rose-600' },
  { type: 'businessHoursNode', icon: Store, label: 'Horario Atención', desc: 'Detecta si está en horario.', bg: 'bg-orange-100', text: 'text-orange-600' },
  { type: 'sendMediaNode', icon: Image, label: 'Enviar Multimedia', desc: 'Envía imagen o PDF.', bg: 'bg-indigo-100', text: 'text-indigo-600' },
  { type: 'groqNode', icon: Brain, label: 'Cerebro IA', desc: 'Usa IA (Groq) para responder.', bg: 'bg-indigo-100', text: 'text-indigo-600' },
  { type: 'intentResolverNode', icon: GitFork, label: 'Clasificar Intención', desc: 'Detecta intención y ramifica.', bg: 'bg-fuchsia-100', text: 'text-fuchsia-600' },
  { type: 'audioTranscriberNode', icon: Mic, label: 'Audio → Texto', desc: 'Transcribe notas de voz.', bg: 'bg-violet-100', text: 'text-violet-600' },
  { type: 'textSplitterNode', icon: Scissors, label: 'Split de Texto', desc: 'Texto → array de palabras.', bg: 'bg-stone-100', text: 'text-stone-600' },
  { type: 'arraySwitchNode', icon: Spline, label: 'Switch Array', desc: 'Busca palabra exacta en el split.', bg: 'bg-indigo-100', text: 'text-indigo-600' },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className={`${collapsed ? 'w-12' : 'w-52'} hidden lg:flex bg-brand-surface border-l border-brand-hairline flex-col h-full transition-all duration-200 relative`}>
      {/* Toggle button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -left-3 top-4 bg-brand-surface border border-brand-hairline text-brand-inkmuted rounded-full w-6 h-6 flex items-center justify-center shadow-card hover:bg-brand-panel hover:text-brand-primary z-10"
      >
        {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      {collapsed ? (
        /* Collapsed: icon-only strip */
        <div className="flex flex-col items-center gap-1 pt-10 px-1 overflow-y-auto">
          {nodeItems.map(item => (
            <div
              key={item.type}
              className="p-2 rounded-lg cursor-grab hover:bg-brand-panel transition"
              onDragStart={(e) => onDragStart(e, item.type)}
              draggable
              title={item.label}
            >
              <item.icon size={16} className={item.text} />
            </div>
          ))}
        </div>
      ) : (
        /* Expanded */
        <div className="p-3 flex flex-col gap-2 h-full overflow-y-auto">
          <h2 className="font-serif font-bold text-brand-ink text-sm">Nodos</h2>
          <div className="space-y-1.5">
            {nodeItems.map(item => (
              <div
                key={item.type}
                className="bg-brand-surface p-2 rounded-lg shadow-card hover:shadow transition cursor-grab active:cursor-grabbing border border-brand-hairline flex items-center gap-2"
                onDragStart={(e) => onDragStart(e, item.type)}
                draggable
              >
                <div className={`${item.bg} p-1.5 rounded ${item.text}`}>
                  <item.icon size={14} />
                </div>
                <span className="text-xs font-medium text-brand-ink">{item.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto p-2 bg-brand-panel rounded-lg text-[10px] text-brand-inkmuted border border-brand-hairline flex gap-1">
            <MousePointerClick size={12} />
            <p>Uní los puntos para conectar.</p>
          </div>
        </div>
      )}
    </aside>
  );
}
