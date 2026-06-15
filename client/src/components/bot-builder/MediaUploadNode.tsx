
import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { UploadCloud, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border border-pink-200 w-64">
      <div className="bg-pink-600 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <UploadCloud size={16} />
            <span className="font-medium text-sm">Recibir Archivo</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-pink-200 transition">
            <Trash2 size={14} />
        </button>
      </div>
      <div className="p-3 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Mensaje pidiendo archivo</label>
          <textarea
            className="w-full text-xs p-2 border rounded resize-none focus:outline-none focus:border-pink-500"
            rows={2}
            value={data.text}
            onChange={(evt) => data.onChange(evt.target.value)}
            placeholder="Por favor, subí tu comprobante..."
          />
        </div>
        
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Guardar URL en variable</label>
          <div className="flex items-center gap-1 border rounded px-2 py-1 bg-gray-50">
            <span className="text-gray-400 text-xs">context.</span>
            <input 
                className="bg-transparent text-xs outline-none flex-1 font-mono text-blue-600"
                value={data.variable || 'file_url'}
                onChange={(e) => data.onChangeVariable(e.target.value)}
                placeholder="file_url"
            />
          </div>
        </div>
      </div>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
});
