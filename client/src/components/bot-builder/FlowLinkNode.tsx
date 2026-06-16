import { memo, useEffect, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { ArrowRightCircle, Trash2 } from 'lucide-react';
import { flowsApi } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

export default memo(({ data, isConnectable }: any) => {
  const [flows, setFlows] = useState<any[]>([]);
  const { user } = useAuth();

  useEffect(() => {
      const fetchFlows = async () => {
          if (!user?.id) return;
          try {
              const res = await flowsApi.listByUser(user.id);
              if (res) setFlows(res);
          } catch (err) {
              console.error('[FlowLinkNode] Error fetching flows:', err);
          }
      };
      fetchFlows();
  }, [user?.id]);

  return (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 w-64">
      <div className="bg-gray-800 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <ArrowRightCircle size={16} />
            <span className="font-medium text-sm">Ir a Flujo</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
        </button>
      </div>
      
      <div className="p-3">
        <label className="block text-xs font-medium text-gray-500 mb-1">Seleccionar Flujo Destino</label>
        <select 
            className="w-full text-xs border-gray-300 rounded focus:ring-gray-500 py-1"
            value={data.flowId || ''}
            onChange={(e) => data.onChangeFlow(e.target.value)}
        >
            <option value="">-- Seleccionar --</option>
            {flows.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
            ))}
        </select>
        <div className="mt-2 text-[10px] text-gray-400">
            Al llegar aquí, la conversación saltará al flujo seleccionado.
        </div>
      </div>

      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
    </div>
  );
});
