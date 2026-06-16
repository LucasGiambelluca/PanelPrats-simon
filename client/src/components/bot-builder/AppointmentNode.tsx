import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { CalendarDays, Clock, User, Phone, FileText, Trash2, MessageSquare, AlarmClock } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  const preview = {
    startHour: data.startHourVar || '{{hora_inicio}}',
    endHour:   data.endHourVar   || '{{hora_fin}}',
    date:      data.dateVar      || '{{fecha}}',
    nombre:    data.nombreVar    || 'nombre',
    telefono:  data.telefonoVar  || 'telefono',
    resumen:   data.resumenVar   || 'resumen',
  };

  return (
    <div className="w-72 rounded-2xl shadow-lg border border-blue-100 bg-white overflow-hidden font-sans select-none">
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} className="!bg-blue-500" />

      {/* ── Header ─────────────────────────────────── */}
      <div className="bg-[#1a73e8] px-4 py-3 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <CalendarDays size={15} className="text-white" />
        </div>
        <div>
          <span className="text-white font-bold text-sm leading-none block">Agendar Cita</span>
          <span className="text-blue-100 text-[10px] font-medium">Integración con Google Calendar</span>
        </div>
      </div>

      {/* ── Preview badge ──────────────────────────── */}
      <div className="mx-3 mt-3 mb-2 bg-[#e8f0fe] border border-blue-200 rounded-xl p-2.5 flex items-center gap-2">
        <AlarmClock size={13} className="text-[#1a73e8] flex-shrink-0" />
        <span className="text-[10px] text-[#1a73e8] font-mono font-bold truncate">
          {preview.date} · {preview.startHour} → {preview.endHour}
        </span>
      </div>

      {/* ── Fields ────────────────────────────────── */}
      <div className="p-3 space-y-2.5">

        {/* Nombre */}
        <FieldRow
          icon={<User size={11} className="text-slate-400" />}
          label="Variable · Nombre"
          value={data.nombreVar || ''}
          placeholder="nombre"
          onChange={(v) => data.onChangeValue?.('nombreVar', v)}
          hint="Nombre del cliente en el flujo"
          colorClass="text-[#1a73e8]"
        />

        {/* Teléfono */}
        <FieldRow
          icon={<Phone size={11} className="text-slate-400" />}
          label="Variable · Teléfono"
          value={data.telefonoVar || ''}
          placeholder="telefono"
          onChange={(v) => data.onChangeValue?.('telefonoVar', v)}
          hint="Vacía = usa el número del remitente"
          colorClass="text-[#1a73e8]"
        />

        {/* Resumen */}
        <FieldRow
          icon={<FileText size={11} className="text-slate-400" />}
          label="Variable · Resumen / Notas"
          value={data.resumenVar || ''}
          placeholder="resumen"
          onChange={(v) => data.onChangeValue?.('resumenVar', v)}
          hint="Descripción del motivo de la consulta"
          colorClass="text-[#1a73e8]"
        />

        {/* Divider */}
        <div className="border-t border-slate-100 my-1" />

        {/* Fecha */}
        <FieldRow
          icon={<CalendarDays size={11} className="text-slate-400" />}
          label="Variable · Fecha (YYYY-MM-DD)"
          value={data.dateVar || ''}
          placeholder="fecha"
          onChange={(v) => data.onChangeValue?.('dateVar', v)}
          hint="Ej: {{fecha}} → 2026-06-18"
          colorClass="text-emerald-600"
        />

        {/* Hora Inicio */}
        <FieldRow
          icon={<Clock size={11} className="text-slate-400" />}
          label="Variable · Hora de Inicio (HH:MM)"
          value={data.startHourVar || ''}
          placeholder="hora_inicio"
          onChange={(v) => data.onChangeValue?.('startHourVar', v)}
          hint="Ej: {{hora_inicio}} → 10:00"
          colorClass="text-emerald-600"
        />

        {/* Hora Fin */}
        <FieldRow
          icon={<Clock size={11} className="text-slate-400" />}
          label="Variable · Hora de Fin (HH:MM)"
          value={data.endHourVar || ''}
          placeholder="hora_fin"
          onChange={(v) => data.onChangeValue?.('endHourVar', v)}
          hint="Ej: {{hora_fin}} → 11:00"
          colorClass="text-emerald-600"
        />

        {/* Divider */}
        <div className="border-t border-slate-100 my-1" />

        {/* Mensaje de Confirmación */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <MessageSquare size={11} className="text-slate-400" />
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Mensaje de Confirmación
            </label>
          </div>
          <textarea
            className="w-full text-[11px] border border-slate-200 bg-slate-50 p-2 rounded-lg resize-none h-14 focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400 transition font-medium text-slate-700 placeholder:text-slate-300"
            value={data.text || ''}
            placeholder="¡Listo! Tu cita quedó agendada para el {{fecha}} a las {{hora_inicio}} ✅"
            onChange={(e) => data.onChange?.(e.target.value)}
          />
          <p className="text-[9px] text-slate-400 leading-tight px-0.5">
            Podés usar variables como <code className="text-[#1a73e8] font-mono">{`{{fecha}}`}</code> o <code className="text-[#1a73e8] font-mono">{`{{nombre}}`}</code> en el mensaje.
          </p>
        </div>

        {/* Delete */}
        {data.onDelete && (
          <button
            onClick={data.onDelete}
            className="w-full flex items-center justify-center gap-1.5 text-[10px] text-red-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 rounded-lg py-1.5 transition font-semibold mt-1"
          >
            <Trash2 size={11} />
            Eliminar nodo
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} className="!bg-blue-500" />
    </div>
  );
});

// ── Sub-component: reusable field row ──────────────────────────
function FieldRow({
  icon, label, value, placeholder, onChange, hint, colorClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  hint?: string;
  colorClass?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {icon}
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</label>
      </div>
      <input
        className={`w-full text-[11px] border border-slate-200 bg-slate-50 px-2 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400 transition font-mono font-bold placeholder:font-normal placeholder:text-slate-300 ${colorClass || 'text-[#1a73e8]'}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-[9px] text-slate-400 leading-tight px-0.5">{hint}</p>}
    </div>
  );
}
