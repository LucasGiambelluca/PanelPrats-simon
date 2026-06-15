import { Handle, Position } from 'reactflow';
import { Mic, MessageSquare } from 'lucide-react';

interface MediaTypeDetectorNodeProps {
  data: {
    label?: string;
    output_variable?: string;
    audio_handle?: string;
    text_handle?: string;
  };
  selected: boolean;
}

export default function MediaTypeDetectorNode({ data, selected }: MediaTypeDetectorNodeProps) {
  const audioHandle = data.audio_handle || 'audio';
  const textHandle = data.text_handle || 'text';

  return (
    <div className={`bg-white rounded-xl shadow-md border-2 ${selected ? 'border-violet-500' : 'border-violet-200'} p-3 min-w-[200px] max-w-[260px]`}>
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !w-3 !h-3" />
      
      <div className="flex items-center gap-2 mb-2">
        <div className="bg-violet-100 p-1.5 rounded">
          <Mic size={16} className="text-violet-600" />
        </div>
        <span className="text-sm font-semibold text-violet-700">Detector de Media</span>
      </div>

      <div className="space-y-2 text-xs">
        <div>
          <label className="text-gray-500 block mb-0.5">Variable de salida</label>
          <code className="bg-violet-50 px-1.5 py-0.5 rounded text-violet-700">{data.output_variable || 'media_type'}</code>
        </div>

        <div className="bg-violet-50 rounded p-1.5 text-violet-600 text-[10px]">
          🎙️ Detecta si el mensaje es audio o texto y ramifica el flujo.
        </div>
      </div>

      {/* Output handles */}
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-end relative">
          <span className="text-[10px] font-medium text-orange-500 mr-1 flex items-center gap-0.5">
            <Mic size={10} /> {audioHandle}
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id={audioHandle}
            className="!bg-orange-500 !w-2.5 !h-2.5"
            style={{ top: 'auto', position: 'relative' }}
          />
        </div>
        <div className="flex items-center justify-end relative">
          <span className="text-[10px] font-medium text-blue-500 mr-1 flex items-center gap-0.5">
            <MessageSquare size={10} /> {textHandle}
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id={textHandle}
            className="!bg-blue-500 !w-2.5 !h-2.5"
            style={{ top: 'auto', position: 'relative' }}
          />
        </div>
      </div>

      {/* Default fallback */}
      <Handle type="source" position={Position.Bottom} id="default" className="!bg-gray-400 !w-3 !h-3" />
    </div>
  );
}
