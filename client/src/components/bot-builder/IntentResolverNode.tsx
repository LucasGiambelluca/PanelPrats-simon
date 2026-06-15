import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { BrainCircuit, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-80">
      <div className="bg-fuchsia-600 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <BrainCircuit size={16} />
            <span className="font-medium text-sm">Resolución de Intención IA</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
        </button>
      </div>
      
      <div className="p-3 bg-fuchsia-50 space-y-3">
        <div>
          <label className="block text-[10px] font-bold text-fuchsia-700 uppercase mb-1">Pregunta al Usuario (Opcional)</label>
          <textarea
            className="w-full text-xs p-2 border border-fuchsia-200 rounded resize-none focus:outline-none focus:border-fuchsia-500 bg-white"
            rows={2}
            value={data.question || ''}
            onChange={(evt) => data.onChangeQuestion ? data.onChangeQuestion(evt.target.value) : null}
            placeholder="Ej: ¿Delivery o Retiro en local?"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-fuchsia-700 uppercase mb-1">Intenciones Posibles (Separadas por comas)</label>
          <input
            type="text"
            className="w-full text-[11px] p-2 border border-fuchsia-200 rounded focus:outline-none focus:border-fuchsia-500 font-mono text-fuchsia-800 bg-white"
            value={data.possible_intents || ''}
            onChange={(evt) => data.onChangePossibleIntents ? data.onChangePossibleIntents(evt.target.value) : null}
            placeholder="delivery, retiro, cancelar, reclamo"
          />
        </div>

        <div className="flex gap-2">
            <div className="flex-1">
                <label className="block text-[10px] font-bold text-fuchsia-700 uppercase mb-1">Variable Destino</label>
                <input
                    type="text"
                    className="w-full text-xs p-2 border border-fuchsia-200 rounded focus:outline-none focus:border-fuchsia-500 font-mono text-fuchsia-800 bg-white"
                    value={data.variable || ''}
                    onChange={(evt) => data.onChangeVariable ? data.onChangeVariable(evt.target.value) : null}
                    placeholder="intent_clasificado"
                />
            </div>
            <div className="w-20">
                <label className="block text-[10px] font-bold text-fuchsia-700 uppercase mb-1">Reintentos</label>
                <input
                    type="number"
                    min="0"
                    max="5"
                    className="w-full text-xs p-2 border border-fuchsia-200 rounded focus:outline-none focus:border-fuchsia-500 bg-white"
                    value={data.max_retries ?? 2}
                    onChange={(evt) => data.onChangeMaxRetries ? data.onChangeMaxRetries(parseInt(evt.target.value)) : null}
                />
            </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-fuchsia-700 uppercase mb-1">Variables de Contexto (Opcional, comas)</label>
          <input
            type="text"
            className="w-full text-[11px] p-2 border border-fuchsia-200 rounded focus:outline-none focus:border-fuchsia-500 font-mono text-fuchsia-800 bg-white"
            value={Array.isArray(data.context_variables) ? data.context_variables.join(', ') : (data.context_variables || '')}
            onChange={(evt) => {
                const arr = evt.target.value.split(',').map(s => s.trim()).filter(Boolean);
                if (data.onChangeContextVariables) data.onChangeContextVariables(arr);
            }}
            placeholder="metodo_envio, raw_pedido"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-fuchsia-700 uppercase mb-1">Mensaje de Fallback</label>
          <textarea
            className="w-full text-xs p-2 border border-fuchsia-200 rounded resize-none focus:outline-none focus:border-fuchsia-500 bg-white"
            rows={2}
            value={data.fallback_message || ''}
            onChange={(evt) => data.onChangeFallbackMessage ? data.onChangeFallbackMessage(evt.target.value) : null}
            placeholder="No te entendí bien, ¿podés repetirlo?"
          />
        </div>
      </div>

      <Handle type="target" position={Position.Left} isConnectable={isConnectable} className="w-3 h-3 bg-fuchsia-500" />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} className="w-3 h-3 bg-fuchsia-500" />
    </div>
  );
});
