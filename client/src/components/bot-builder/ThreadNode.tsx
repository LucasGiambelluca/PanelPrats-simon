
import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { PauseCircle, PlayCircle, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  const isResume = data.action === 'RESUME';

  return (
    <div className={`rounded-lg shadow-lg border w-64 ${isResume ? 'border-green-200 bg-white' : 'border-orange-200 bg-white'}`}>
      <div className={`text-white p-2 rounded-t-lg flex items-center justify-between ${isResume ? 'bg-green-600' : 'bg-orange-500'}`}>
        <div className="flex items-center gap-2">
            {isResume ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
            <span className="font-medium text-sm">{isResume ? 'Reanudar Bot' : 'Pausar (Handover)'}</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-white/80 transition">
            <Trash2 size={14} />
        </button>
      </div>
      
      <div className="p-3 space-y-3">
        <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Acción</label>
            <select
                className="w-full text-xs p-2 border rounded focus:outline-none focus:border-blue-500"
                value={data.action || 'HANDOVER'}
                onChange={(e) => data.onChangeAction && data.onChangeAction(e.target.value)}
            >
                <option value="HANDOVER">Pausar Bot (Derivar)</option>
                <option value="RESUME">Reanudar Bot</option>
            </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Mensaje al usuario</label>
          <textarea
            className="w-full text-xs p-2 border rounded resize-none focus:outline-none focus:border-blue-500"
            rows={2}
            value={data.message}
            onChange={(evt) => data.onChange(evt.target.value)}
            placeholder={isResume ? "🤖 Hola de nuevo!" : "⏳ Un humano te atenderá..."}
          />
        </div>
      </div>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
});
