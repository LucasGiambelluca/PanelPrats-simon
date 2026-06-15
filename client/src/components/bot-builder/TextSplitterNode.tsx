import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Scissors, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border-2 border-stone-200 w-64">
      <div className="bg-stone-500 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Scissors size={16} />
            <span className="font-medium text-sm">Split Text</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
        </button>
      </div>

      <div className="p-3 bg-stone-50">
        <div className="space-y-3">
          <div>
             <label className="block text-[10px] font-bold text-stone-500 mb-1">Variable de origen (Texto):</label>
             <input
                type="text"
                className="w-full text-xs p-1.5 border rounded-md"
                value={data.source_variable || ''}
                onChange={(e) => data.onChangeValue('source_variable', e.target.value)}
                placeholder="ej: transcripcion"
             />
          </div>
          <div>
             <label className="block text-[10px] font-bold text-stone-500 mb-1">Variable de destino (Array):</label>
             <input
                type="text"
                className="w-full text-xs p-1.5 border rounded-md"
                value={data.target_variable || ''}
                onChange={(e) => data.onChangeValue('target_variable', e.target.value)}
                placeholder="ej: split_words"
             />
          </div>
        </div>
      </div>
      
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} id="default" isConnectable={isConnectable} style={{ background: '#78716c' }} />
    </div>
  );
});
