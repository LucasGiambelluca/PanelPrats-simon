
import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { MessageSquare, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-64">
      <div className="bg-blue-500 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <MessageSquare size={16} />
            <span className="font-medium text-sm">Enviar Mensaje</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
        </button>
      </div>
      <div className="p-3">
        <div className="mb-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Texto del mensaje</label>
          <textarea
            className="w-full text-xs p-2 border rounded resize-none focus:outline-none focus:border-blue-500"
            rows={3}
            value={data.text}
            onChange={(evt) => data.onChange(evt.target.value)}
            placeholder="Hola! ¿En qué puedo ayudarte?"
          />
        </div>
        {data.mediaUrl && (
             <div className="text-xs text-gray-400 truncate">Media: {data.mediaUrl}</div>
        )}
      </div>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
});
