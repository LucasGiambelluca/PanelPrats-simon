
import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { HelpCircle, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-64">
      <div className="bg-purple-500 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <HelpCircle size={16} />
            <span className="font-medium text-sm">Pregunta (Input)</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
        </button>
      </div>
      <div className="p-3 bg-purple-50">
        <div className="mb-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Pregunta</label>
          <textarea
            className="w-full text-xs p-2 border rounded resize-none focus:outline-none focus:border-purple-500"
            rows={2}
            value={data.question}
            onChange={(evt) => data.onChangeQuestion(evt.target.value)}
            placeholder="¿Cuál es tu nombre?"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Guardar respuesta en variable:</label>
          <input
            type="text"
            className="w-full text-xs p-2 border rounded focus:outline-none focus:border-purple-500 font-mono text-purple-700"
            value={data.variable}
            onChange={(evt) => data.onChangeVariable(evt.target.value)}
            placeholder="nombre_cliente"
          />
        </div>
      </div>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
});
