
import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Clock, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-64">
      <div className="bg-blue-600 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Clock size={16} />
            <span className="font-medium text-sm">Timer / Delay</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
        </button>
      </div>
      <div className="p-3 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Duración (ms)</label>
          <input
            type="number"
            className="w-full text-xs p-2 border rounded focus:outline-none focus:border-blue-500"
            value={data.duration || 1000}
            onChange={(evt) => data.onChangeDuration?.(evt.target.value)}
            placeholder="Ej: 2000"
          />
          <p className="text-[10px] text-gray-400 mt-1">1000ms = 1 segundo</p>
        </div>
        
        <div className="flex items-center gap-2">
            <input 
                type="checkbox" 
                id="showTyping"
                className="rounded text-blue-600 focus:ring-blue-500"
                checked={data.showTyping !== false}
                onChange={(evt) => data.onChangeShowTyping?.(evt.target.checked)}
            />
            <label htmlFor="showTyping" className="text-xs text-gray-600 cursor-pointer select-none">
                Mostrar "Escribiendo..."
            </label>
        </div>
      </div>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
});
