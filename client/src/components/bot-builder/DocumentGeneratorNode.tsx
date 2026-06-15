
import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { FileText, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border border-red-200 w-64">
      <div className="bg-red-600 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <FileText size={16} />
            <span className="font-medium text-sm">Generar PDF</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
        </button>
      </div>
      <div className="p-3 text-xs text-gray-500">
        <p>Este nodo genera un comprobante PDF con los datos del pedido o items en contexto y lo envía al usuario.</p>
        <div className="mt-2 bg-gray-50 p-2 rounded border border-gray-100 italic">
            "Orden #12345..."
        </div>
      </div>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
});
