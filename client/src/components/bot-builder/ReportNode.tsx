
import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { AlertTriangle } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg border-2 border-red-500 w-64 shadow-sm">
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
      
      <div className="bg-red-500 text-white p-2 rounded-t-md flex items-center gap-2">
        <AlertTriangle size={16} />
        <span className="font-bold text-sm">Generar Reporte</span>
      </div>
      
      <div className="p-3 space-y-3">
         <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-semibold">Tipo de Reporte</label>
            <select 
                className="text-xs border p-1 rounded"
                value={data.reportType || 'general'}
                onChange={(e) => data.onChangeReportType && data.onChangeReportType(e.target.value)}
            >
                <option value="reclamo">Reclamo</option>
                <option value="queja">Queja</option>
                <option value="sugerencia">Sugerencia</option>
                <option value="ventas">Ventas</option>
            </select>
        </div>

        <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-semibold">Prioridad</label>
            <select 
                className="text-xs border p-1 rounded"
                value={data.priority || 'medium'}
                onChange={(e) => data.onChangePriority && data.onChangePriority(e.target.value)}
            >
                <option value="low">Baja</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
            </select>
        </div>

        <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-semibold">Variable con Descripción</label>
            <input 
                className="text-xs border p-1 rounded font-mono text-blue-600" 
                value={data.variable || 'claim_description'}
                placeholder="claim_description"
                onChange={(e) => data.onChangeVariable && data.onChangeVariable(e.target.value)}
            />
            <span className="text-[10px] text-gray-400">Variable donde se guardó el mensaje del usuario</span>
        </div>

        <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-semibold">Mensaje de Confirmación</label>
            <textarea 
                className="text-xs border p-1 rounded resize-none h-16" 
                value={data.text || ''}
                placeholder="Tu reporte ha sido registrado..."
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
