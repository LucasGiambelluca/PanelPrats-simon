import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Clock, Trash2, Sliders, CheckSquare } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  const allowedDays = Array.isArray(data.allowedDays) ? data.allowedDays : [1, 2, 3, 4, 5];
  
  const toggleDay = (day: number) => {
    let nextDays = [...allowedDays];
    if (nextDays.includes(day)) {
      nextDays = nextDays.filter(d => d !== day);
    } else {
      nextDays.push(day);
    }
    data.onChangeValue?.('allowedDays', nextDays);
  };

  const daysConfig = [
    { label: 'L', value: 1 },
    { label: 'M', value: 2 },
    { label: 'M', value: 3 },
    { label: 'J', value: 4 },
    { label: 'V', value: 5 },
    { label: 'S', value: 6 },
    { label: 'D', value: 0 },
  ];

  return (
    <div className="w-72 rounded-2xl shadow-lg border border-emerald-100 bg-white overflow-hidden font-sans select-none">
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} className="!bg-emerald-500" />

      {/* ── Header ─────────────────────────────────── */}
      <div className="bg-[#0f9d58] px-4 py-3 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <Sliders size={14} className="text-white" />
          </div>
          <div>
            <span className="text-white font-bold text-sm leading-none block">Sugerir Horarios</span>
            <span className="text-emerald-100 text-[10px] font-medium">Ofrece turnos libres cercanos</span>
          </div>
        </div>
        {data.onDelete && (
          <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* ── Content ────────────────────────────────── */}
      <div className="p-3 space-y-3">
        
        {/* Days selector */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Días Permitidos</label>
          <div className="flex gap-1.5 justify-between">
            {daysConfig.map((d) => {
              const active = allowedDays.includes(d.value);
              return (
                <button
                  key={d.value}
                  onClick={() => toggleDay(d.value)}
                  className={`w-7 h-7 rounded-lg text-xs font-bold transition-all border flex items-center justify-center ${
                    active
                      ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                      : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Start / End Hours */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Clock size={11} className="text-slate-400" />
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Hora Inicio</label>
            </div>
            <input
              type="text"
              className="w-full text-[11px] border border-slate-200 bg-slate-50 px-2 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-300 focus:border-emerald-400 transition text-emerald-700 font-bold placeholder:font-normal placeholder:text-slate-300"
              value={data.startHour || ''}
              placeholder="09:00"
              onChange={(e) => data.onChangeValue?.('startHour', e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Clock size={11} className="text-slate-400" />
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Hora Fin</label>
            </div>
            <input
              type="text"
              className="w-full text-[11px] border border-slate-200 bg-slate-50 px-2 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-300 focus:border-emerald-400 transition text-emerald-700 font-bold placeholder:font-normal placeholder:text-slate-300"
              value={data.endHour || ''}
              placeholder="18:00"
              onChange={(e) => data.onChangeValue?.('endHour', e.target.value)}
            />
          </div>
        </div>

        {/* Duration / Max proposals */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Turno (minutos)</label>
            <input
              type="number"
              className="w-full text-[11px] border border-slate-200 bg-slate-50 px-2 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-300 focus:border-emerald-400 transition text-emerald-700 font-bold"
              value={data.slotDuration || ''}
              placeholder="60"
              onChange={(e) => data.onChangeValue?.('slotDuration', e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Propuestas (cant)</label>
            <input
              type="number"
              className="w-full text-[11px] border border-slate-200 bg-slate-50 px-2 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-300 focus:border-emerald-400 transition text-emerald-700 font-bold"
              value={data.maxProposals || ''}
              placeholder="3"
              onChange={(e) => data.onChangeValue?.('maxProposals', e.target.value)}
            />
          </div>
        </div>

        {/* Output variable */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <CheckSquare size={11} className="text-slate-400" />
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Variable de Salida</label>
          </div>
          <input
            className="w-full text-[11px] border border-slate-200 bg-slate-50 px-2 py-1.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-300 focus:border-emerald-400 transition font-mono font-bold text-emerald-600"
            value={data.outputVariable || ''}
            placeholder="horarios_disponibles"
            onChange={(e) => data.onChangeValue?.('outputVariable', e.target.value)}
          />
          <p className="text-[9px] text-slate-400 leading-tight px-0.5">
            Guarda la lista formateada lista para enviar por WhatsApp.
          </p>
        </div>

      </div>

      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} className="!bg-emerald-500" />
    </div>
  );
});
