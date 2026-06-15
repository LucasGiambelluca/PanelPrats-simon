import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { CalendarPlus } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg border-2 border-teal-500 w-64 shadow-sm">
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />

      <div className="bg-teal-500 text-white p-2 rounded-t-md flex items-center gap-2">
        <CalendarPlus size={16} />
        <span className="font-bold text-sm">Agendar Cita</span>
      </div>

      <div className="p-3 space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-semibold">Variable con el Nombre</label>
          <input
            className="text-xs border p-1 rounded font-mono text-blue-600"
            value={data.nombreVar || 'nombre'}
            placeholder="nombre"
            onChange={(e) => data.onChangeValue && data.onChangeValue('nombreVar', e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-semibold">Variable con el Teléfono</label>
          <input
            className="text-xs border p-1 rounded font-mono text-blue-600"
            value={data.telefonoVar || 'telefono'}
            placeholder="telefono"
            onChange={(e) => data.onChangeValue && data.onChangeValue('telefonoVar', e.target.value)}
          />
          <span className="text-[10px] text-gray-400">Si está vacía, usa el número del remitente.</span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-semibold">Variable con el Resumen</label>
          <input
            className="text-xs border p-1 rounded font-mono text-blue-600"
            value={data.resumenVar || 'resumen'}
            placeholder="resumen"
            onChange={(e) => data.onChangeValue && data.onChangeValue('resumenVar', e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-semibold">Mensaje de Confirmación</label>
          <textarea
            className="text-xs border p-1 rounded resize-none h-16"
            value={data.text || ''}
            placeholder="¡Listo! Tu cita quedó agendada..."
            onChange={(e) => data.onChange && data.onChange(e.target.value)}
          />
        </div>

        {data.onDelete && (
          <button
            onClick={data.onDelete}
            className="text-xs text-red-500 hover:text-red-700 underline mt-2 w-full text-center"
          >
            Eliminar nodo
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  );
});
