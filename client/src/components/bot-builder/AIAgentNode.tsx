import { Handle, Position } from 'reactflow';
import { Bot, Database } from 'lucide-react';

export default function AIAgentNode({ data, selected }: any) {

  return (
    <div className={`bg-white rounded-2xl shadow-xl border-2 ${selected ? 'border-fuchsia-500 ring-4 ring-fuchsia-50' : 'border-fuchsia-200'} p-4 min-w-[320px] transition-all`}>
      <Handle type="target" position={Position.Top} className="!bg-fuchsia-500 !w-3 !h-3" />
      
      <div className="flex items-center gap-3 mb-4">
        <div className="bg-fuchsia-100 p-2 rounded-xl">
          <Bot size={20} className="text-fuchsia-600" />
        </div>
        <div>
          <span className="text-sm font-black text-fuchsia-700 uppercase tracking-tighter">CEREBRO AGENTE</span>
          <p className="text-[10px] text-fuchsia-500 font-bold uppercase">Personalidad + Catálogo</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-bold text-pink-400 uppercase tracking-wider mb-2">
            Entrada (Variable del Mensaje)
          </label>
          <input
            type="text"
            className="w-full bg-slate-900/50 border border-slate-700/50 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500/50 transition-colors"
            placeholder="Ej: user_message (dejar vacío para automático)"
            value={data.inputVariable || ''}
            onChange={(e) => data.onChangeValue?.('inputVariable', e.target.value)}
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold text-pink-400 uppercase tracking-wider mb-2">
            Configuración del Agente (Prompt)
          </label>
          <textarea
            className="w-full bg-slate-900/50 border border-slate-700/50 rounded p-2 text-[11px] text-white min-h-[100px] focus:outline-none focus:border-pink-500/50 transition-colors resize-none leading-relaxed"
            placeholder="Ej: Sos un empleado de la rotisería el pollo... Tu objetivo es tomar el pedido..."
            value={data.system_prompt || ''}
            onChange={(e) => data.onChangeValue?.('system_prompt', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-pink-400 uppercase tracking-wider mb-2">
              API KEY
            </label>
            <input
              type="password"
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500/50"
              placeholder="Usar del .env..."
              value={data.apiKey || ''}
              onChange={(e) => data.onChangeValue?.('apiKey', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-pink-400 uppercase tracking-wider mb-2">
              Modelo de IA
            </label>
            <input
              type="text"
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500/50"
              placeholder="gemini-2.0-flash"
              value={data.model || ''}
              onChange={(e) => data.onChangeValue?.('model', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-pink-400 uppercase tracking-wider mb-2">
              Salida (Intención)
            </label>
            <input
              type="text"
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500/50"
              placeholder="agent_intent"
              value={data.output_variable || 'agent_intent'}
              onChange={(e) => data.onChangeValue?.('output_variable', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-pink-400 uppercase tracking-wider mb-2">
              Confianza
            </label>
            <input
              type="number"
              step="0.1"
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500/50"
              placeholder="0.7"
              value={data.threshold || 0.7}
              onChange={(e) => data.onChangeValue?.('threshold', parseFloat(e.target.value))}
            />
          </div>
        </div>

        <div className="bg-fuchsia-50/50 p-2.5 rounded-xl border border-fuchsia-100/50">
          <label className="text-[9px] font-black text-fuchsia-400 uppercase tracking-widest mb-2 block flex items-center gap-1">
            <Database size={10} /> Herramientas (Tools)
          </label>
          <div className="space-y-1.5">
            {[
              { id: 'tool_stock', label: 'Consultar Stock' },
              { id: 'tool_orders', label: 'Estado de Pedidos' },
              { id: 'tool_hours', label: 'Horarios de Atención' }
            ].map(tool => (
              <label key={tool.id} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  className="rounded border-fuchsia-200 text-fuchsia-500 focus:ring-fuchsia-500"
                  checked={data.tools?.includes(tool.id)}
                  onChange={(e) => {
                    const tools = data.tools || [];
                    const newTools = e.target.checked 
                      ? [...tools, tool.id]
                      : tools.filter((t: string) => t !== tool.id);
                    data.onChangeValue?.('tools', newTools);
                  }}
                />
                <span className="text-[10px] font-bold text-gray-500 group-hover:text-fuchsia-600 transition-colors uppercase">{tool.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-fuchsia-100 space-y-2">
        <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-2 px-1">Salidas por Intención</label>
        <div className="flex flex-wrap gap-1 mb-4">
          {['PEDIDO', 'CONSULTA', 'SALUDO', 'SOPORTE', 'CANCELAR'].map(intent => (
            <span key={intent} className="px-1.5 py-0.5 bg-gray-50 text-[8px] font-bold text-gray-400 rounded uppercase border border-gray-100">
              {intent}
            </span>
          ))}
        </div>
        
        <div className="space-y-3 relative">
          {['PEDIDO', 'CONSULTA', 'SALUDO', 'SOPORTE', 'CANCELAR'].map((intent) => (
            <div key={intent} className="flex items-center justify-end gap-2 h-6">
              <span className="text-[9px] font-bold text-gray-500 uppercase">{intent}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={intent.toLowerCase()}
                style={{ top: 'auto', position: 'relative', right: 0, transform: 'none' }}
                className="!bg-fuchsia-400 !w-2.5 !h-2.5 !border-2 !border-white"
              />
            </div>
          ))}
          {/* Default/Fallback Handle */}
          <div className="flex items-center justify-end gap-2 h-6 mt-1 pt-1 border-t border-dashed border-gray-100">
            <span className="text-[9px] font-bold text-gray-300 uppercase italic">desconocido</span>
            <Handle
              type="source"
              position={Position.Right}
              id="desconocido"
              style={{ top: 'auto', position: 'relative', right: 0, transform: 'none' }}
              className="!bg-gray-300 !w-2.5 !h-2.5 !border-2 !border-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
