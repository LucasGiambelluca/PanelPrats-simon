import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { GitFork, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-64">
      <div className="bg-orange-500 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <GitFork size={16} />
            <span className="font-medium text-sm">Condición</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
        </button>
      </div>
      <div className="p-3 bg-orange-50">
        <div className="mb-2">
           <label className="block text-xs font-medium text-gray-500 mb-1">Si la variable:</label>
           <input
            type="text"
            className="w-full text-xs p-1 border rounded font-mono mb-2"
            value={data.variable}
            onChange={(e) => data.onChangeVariable?.(e.target.value)}
            placeholder="respuesta"
           />
             <label className="block text-xs font-medium text-gray-500 mb-1">Es igual a:</label>
           <input
            type="text"
            className="w-full text-xs p-1 border rounded font-mono"
            value={data.expectedValue}
            onChange={(e) => data.onChangeValue?.(e.target.value)}
            placeholder="si"
           />
        </div>
        
        <div className="flex justify-between items-center text-xs font-bold text-gray-600 mt-3 px-1">
             <span>NO ❌</span>
             <span>SI ✅</span>
        </div>
      </div>
      
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      
      {/* Salida False (Arriba o Abajo, o un handle especifico con ID) */}
      <Handle 
        type="source" 
        position={Position.Bottom} 
        id="false"
        style={{ left: '25%', background: '#ef4444' }}
        isConnectable={isConnectable} 
      />
       {/* Salida True */}
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
