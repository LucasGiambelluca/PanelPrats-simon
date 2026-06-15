import { Handle, Position } from 'reactflow';
import { HeadphonesIcon } from 'lucide-react';

interface HandoverNodeProps {
    data: {
        message?: string;
        onChange?: (text: string) => void;
        onDelete?: () => void;
    };
    isConnectable: boolean;
}

export default function HandoverNode({ data, isConnectable }: HandoverNodeProps) {
    return (
        <div className="bg-white border-2 border-rose-400 rounded-lg shadow-sm w-64">
            <div className="bg-rose-50 px-3 py-2 border-b border-rose-100 rounded-t-md flex items-center justify-between">
                 <div className="flex items-center gap-2 text-rose-700 font-semibold text-sm">
                    <HeadphonesIcon size={16} />
                    Derivar a Humano
                 </div>
                 <button onClick={data.onDelete} className="text-gray-400 hover:text-red-500">×</button>
            </div>
            
            <div className="p-3">
                 <div className="mb-2">
                     <label className="block text-xs font-semibold text-gray-600 mb-1">Mensaje al Cliente</label>
                     <textarea 
                        className="w-full text-sm border-gray-300 rounded focus:border-rose-500 focus:ring-rose-500 nodrag"
                        rows={2}
                        placeholder="Ej: Te derivamos con un asesor..."
                        value={data.message || ''}
                        onChange={(e) => data.onChange && data.onChange(e.target.value)}
                     />
                 </div>
                 <p className="text-[10px] text-gray-500 leading-tight">
                     El bot se pausará automáticamente y se enviará una notificación a Sileo.
                 </p>
            </div>

            <Handle type="target" position={Position.Top} isConnectable={isConnectable} className="w-3 h-3 bg-rose-500" />
            <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} className="w-3 h-3 bg-rose-500" />
        </div>
    );
}
