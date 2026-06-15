import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Store, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border border-orange-300 w-64">
      <div className="bg-orange-500 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Store size={16} />
          <span className="font-medium text-sm">Control de Horario</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="p-3 bg-orange-50 text-xs text-gray-600 space-y-1">
        <p>
          Verifica si el local está <strong>abierto</strong> usando la configuración global de horarios del panel de ajustes.
        </p>
        <div className="flex justify-between items-center text-xs font-bold text-gray-600 mt-3 px-1">
          <span>CERRADO ❌</span>
          <span>ABIERTO ✅</span>
        </div>
      </div>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      {/* False: closed */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{ left: '25%', background: '#ef4444' }}
        isConnectable={isConnectable}
      />
      {/* True: open */}
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
