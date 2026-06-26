import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Venus, Mars, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-72">
      <div className="bg-fuchsia-600 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex"><Mars size={14} /><Venus size={14} /></span>
          <span className="font-medium text-sm">Género por nombre (IA)</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="p-3 bg-fuchsia-50 space-y-2">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Pregunta (pide el nombre):</label>
          <input
            type="text"
            className="w-full text-xs p-1 border rounded"
            value={data.question || ''}
            onChange={(e) => data.onChangeQuestion?.(e.target.value)}
            placeholder="¿Cómo te llamás?"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Guardar nombre en variable:</label>
          <input
            type="text"
            className="w-full text-xs p-1 border rounded font-mono"
            value={data.variable || ''}
            onChange={(e) => data.onChangeVariable?.(e.target.value)}
            placeholder="nombre"
          />
        </div>
        <p className="text-[10px] text-gray-500">La IA clasifica el nombre y ramifica por género. Guarda el resultado en <span className="font-mono">genero</span>.</p>
        <div className="flex justify-between items-center text-[11px] font-bold pt-1 px-1">
          <span className="text-blue-600">♂ Hombre</span>
          <span className="text-pink-600">♀ Mujer</span>
          <span className="text-gray-500">? Desconoc.</span>
        </div>
      </div>

      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Bottom} id="hombre" style={{ left: '18%', background: '#2563eb' }} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Bottom} id="mujer" style={{ left: '50%', background: '#db2777' }} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Bottom} id="desconocido" style={{ left: '82%', background: '#9ca3af' }} isConnectable={isConnectable} />
    </div>
  );
});
