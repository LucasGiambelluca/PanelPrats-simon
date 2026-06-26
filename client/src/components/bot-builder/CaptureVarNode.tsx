import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Download, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-64">
      <div className="bg-teal-600 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Download size={15} />
          <span className="font-medium text-sm">Capturar Variable</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="p-3 bg-teal-50 space-y-2">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Variable que viene de otro flujo:</label>
          <input
            type="text"
            className="w-full text-xs p-1 border rounded font-mono"
            value={data.variable || ''}
            onChange={(e) => data.onChangeVariable?.(e.target.value)}
            placeholder="nombre"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Guardar como (opcional):</label>
          <input
            type="text"
            className="w-full text-xs p-1 border rounded font-mono"
            value={data.outputVariable || ''}
            onChange={(e) => data.onChangeValue?.('outputVariable', e.target.value)}
            placeholder="(igual nombre)"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Default si no vino:</label>
          <input
            type="text"
            className="w-full text-xs p-1 border rounded"
            value={data.defaultValue || ''}
            onChange={(e) => data.onChangeValue?.('defaultValue', e.target.value)}
            placeholder="(vacío)"
          />
        </div>
        <p className="text-[10px] text-gray-500">Deja la variable lista para usar con <span className="font-mono">{'{{nombre}}'}</span> en este flujo.</p>
      </div>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  );
});
