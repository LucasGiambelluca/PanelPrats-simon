import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Brain, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-72">
      <div className="bg-indigo-600 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Brain size={16} />
            <span className="font-medium text-sm">Cerebro IA (Groq)</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
        </button>
      </div>
      
      <div className="p-3 bg-indigo-50 space-y-3">
        <div>
          <label className="block text-[10px] font-bold text-indigo-700 uppercase mb-1">Instrucción del Sistema</label>
          <textarea
            className="w-full text-xs p-2 border border-indigo-200 rounded resize-none focus:outline-none focus:border-indigo-500 bg-white"
            rows={2}
            value={data.systemPrompt || ''}
            onChange={(evt) => data.onChangeSystemPrompt ? data.onChangeSystemPrompt(evt.target.value) : null}
            placeholder="Ej: Sos un asistente de ventas..."
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-indigo-700 uppercase mb-1">Tu Instrucción / Prompt</label>
          <textarea
            className="w-full text-xs p-2 border border-indigo-200 rounded resize-none focus:outline-none focus:border-indigo-500 bg-white"
            rows={3}
            value={data.prompt || ''}
            onChange={(evt) => data.onChangePrompt ? data.onChangePrompt(evt.target.value) : null}
            placeholder="Ej: Resumí este mensaje: {{respuesta}}"
          />
          <p className="text-[9px] text-indigo-400 mt-1 italic">Usá {"{{variable}}"} para insertar datos.</p>
        </div>

        <div className="flex gap-2">
            <div className="flex-1">
                <label className="block text-[10px] font-bold text-indigo-700 uppercase mb-1">Variable Destino</label>
                <input
                    type="text"
                    className="w-full text-xs p-2 border border-indigo-200 rounded focus:outline-none focus:border-indigo-500 font-mono text-indigo-800 bg-white"
                    value={data.variable || ''}
                    onChange={(evt) => data.onChangeVariable ? data.onChangeVariable(evt.target.value) : null}
                    placeholder="ai_result"
                />
            </div>
            <div className="w-20">
                <label className="block text-[10px] font-bold text-indigo-700 uppercase mb-1">Temp</label>
                <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    className="w-full text-xs p-2 border border-indigo-200 rounded focus:outline-none focus:border-indigo-500 bg-white"
                    value={data.temperature ?? 0.7}
                    onChange={(evt) => data.onChangeTemperature ? data.onChangeTemperature(parseFloat(evt.target.value)) : null}
                />
            </div>
        </div>

        <div className="flex items-center gap-2 pt-1 border-t border-indigo-100">
            <input 
                type="checkbox" 
                id="silent_mode"
                className="rounded text-indigo-600 focus:ring-indigo-500"
                checked={data.silent || false}
                onChange={(e) => data.onChangeSilent ? data.onChangeSilent(e.target.checked) : null}
            />
            <label htmlFor="silent_mode" className="text-[10px] text-indigo-600 cursor-pointer">Modo Silencioso (no envía respuesta)</label>
        </div>
      </div>

      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
});
