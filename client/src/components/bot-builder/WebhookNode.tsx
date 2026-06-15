import { Handle, Position } from 'reactflow';
import { Zap } from 'lucide-react';

export default function WebhookNode({ selected }: any) {
  return (
    <div className={`bg-white rounded-xl shadow-lg border-2 ${selected ? 'border-amber-500' : 'border-amber-200'} p-4 min-w-[180px]`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="bg-amber-100 p-2 rounded-lg">
          <Zap size={20} className="text-amber-600 animate-pulse" />
        </div>
        <div>
          <span className="text-sm font-black text-amber-800 uppercase tracking-tighter">MENSAJE ENTRANTE</span>
          <p className="text-[9px] text-amber-600 font-bold uppercase py-0.5">Webhook / Hook</p>
        </div>
      </div>

      <div className="bg-amber-50 rounded-lg p-2 text-amber-700 text-[10px] border border-amber-100">
        ⚡ Este es el punto de inicio. Se activa automáticamente cuando recibís un mensaje de WhatsApp.
      </div>

      {/* Solo salida, porque es un Trigger */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="default"
        className="!bg-amber-500 !w-4 !h-4 border-2 border-white shadow-sm"
      />
    </div>
  );
}
