import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { BrainCircuit, Database } from 'lucide-react';

const MemoryNode = ({ data }: any) => {
  return (
    <div className="px-4 py-3 shadow-xl rounded-xl bg-slate-900 border-2 border-indigo-500 min-w-[200px] text-white">
      <div className="flex items-center gap-3 border-b border-white/10 pb-2 mb-3">
        <div className="p-2 bg-indigo-500/20 rounded-lg">
          <BrainCircuit size={20} className="text-indigo-400" />
        </div>
        <div>
          <h3 className="text-sm font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
            BUFFER MEMORY
          </h3>
          <p className="text-[10px] text-slate-400">Pila de contexto IA</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
            Capacidad (Mensajes)
          </label>
          <input
            type="number"
            value={data.capacity || 10}
            onChange={(e) => data.onChange?.({ ...data, capacity: parseInt(e.target.value) })}
            className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1 text-xs mt-1"
          />
        </div>

        <div className="flex items-center gap-2 px-2 py-1 bg-indigo-500/10 rounded border border-indigo-500/20">
          <Database size={12} className="text-indigo-400" />
          <span className="text-[11px] text-indigo-300">Persistencia Redis</span>
        </div>
      </div>

      {/* Target handle para recibir conexión del Agente o Webhook */}
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-indigo-500" />
      
      {/* Source handle para inyectar la memoria en el Agente */}
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-indigo-500" />
    </div>
  );
};

export default memo(MemoryNode);
