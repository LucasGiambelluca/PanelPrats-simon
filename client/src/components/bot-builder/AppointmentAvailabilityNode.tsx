import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { CalendarDays, Clock, Trash2, HelpCircle } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  const preview = {
    startHour: data.startHourVar || '{{hora_inicio}}',
    endHour:   data.endHourVar   || '{{hora_fin}}',
    date:      data.dateVar      || '{{fecha}}',
  };

  return (
    <div className="w-72 rounded-2xl shadow-lg border border-teal-100 bg-white overflow-hidden font-sans select-none">
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} className="!bg-teal-500" />

      {/* ── Header ─────────────────────────────────── */}
      <div className="bg-[#0f9d58] px-4 py-3 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <CalendarDays size={15} className="text-white" />
          </div>
          <div>
            <span className="text-white font-bold text-sm leading-none block">Consultar Cita</span>
            <span className="text-teal-100 text-[10px] font-medium">Verifica disponibilidad horaria</span>
          </div>
        </div>
        {data.onDelete && (
          <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* ── Preview badge ──────────────────────────── */}
      <div className="mx-3 mt-3 mb-2 bg-teal-50 border border-teal-200 rounded-xl p-2.5 flex items-center gap-2">
        <HelpCircle size={13} className="text-[#0f9d58] flex-shrink-0" />
        <span className="text-[10px] text-[#0f9d58] font-mono font-bold truncate">
          Consultar: {preview.date} · {preview.startHour} → {preview.endHour}
        </span>
      </div>

      {/* ── Fields ────────────────────────────────── */}
      <div className="p-3 space-y-2.5">

        {/* Fecha */}
        <FieldRow
          icon={<CalendarDays size={11} className="text-slate-400" />}
          label="Variable · Fecha (YYYY-MM-DD)"
          value={data.dateVar || ''}
          placeholder="fecha"
          onChange={(v) => data.onChangeValue?.('dateVar', v)}
          hint="Ej: {{fecha}} o variable 'fecha'"
          colorClass="text-emerald-600"
        />

        {/* Hora Inicio */}
        <FieldRow
          icon={<Clock size={11} className="text-slate-400" />}
          label="Variable · Hora de Inicio (HH:MM)"
          value={data.startHourVar || ''}
          placeholder="hora_inicio"
          onChange={(v) => data.onChangeValue?.('startHourVar', v)}
          hint="Ej: {{hora_inicio}} o variable 'hora_inicio'"
          colorClass="text-emerald-600"
        />

        {/* Hora Fin */}
        <FieldRow
          icon={<Clock size={11} className="text-slate-400" />}
          label="Variable · Hora de Fin (HH:MM)"
          value={data.endHourVar || ''}
          placeholder="hora_fin"
          onChange={(v) => data.onChangeValue?.('endHourVar', v)}
          hint="Ej: {{hora_fin}} o variable 'hora_fin'"
          colorClass="text-emerald-600"
        />

        {/* Divider */}
        <div className="border-t border-slate-100 my-1" />

        {/* Handles description */}
        <div className="flex justify-between items-center text-[10px] font-bold text-gray-500 px-1 pt-1">
          <span className="text-red-500">OCUPADO ❌ (false)</span>
          <span className="text-emerald-500">DISPONIBLE ✅ (true)</span>
        </div>
      </div>

      {/* Handles */}
      {/* False: Busy / Overlapped */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{ left: '25%', background: '#ef4444' }}
        isConnectable={isConnectable}
      />
      {/* True: Available */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{ left: '75%', background: '#22c55e' }}
        isConnectable={isConnectable}
      />
    </div>
  );
});

// Reusable field row
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
        className={`w-full text-[11px] border border-slate-200 bg-slate-50 px-2 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-300 focus:border-teal-400 transition font-mono font-bold placeholder:font-normal placeholder:text-slate-300 ${colorClass || 'text-[#0f9d58]'}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-[9px] text-slate-400 leading-tight px-0.5">{hint}</p>}
    </div>
  );
}
