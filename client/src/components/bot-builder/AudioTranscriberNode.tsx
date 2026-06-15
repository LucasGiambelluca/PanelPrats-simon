import { Handle, Position } from 'reactflow';
import { Mic } from 'lucide-react';

interface AudioTranscriberNodeProps {
  data: {
    label?: string;
    language?: string;
    output_variable?: string;
    fallback_message?: string;
  };
  selected: boolean;
}

export default function AudioTranscriberNode({ data, selected }: AudioTranscriberNodeProps) {
  return (
    <div className={`bg-white rounded-xl shadow-md border-2 ${selected ? 'border-violet-500' : 'border-violet-200'} p-3 min-w-[220px] max-w-[280px]`}>
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !w-3 !h-3" />
      
      <div className="flex items-center gap-2 mb-2">
        <div className="bg-violet-100 p-1.5 rounded">
          <Mic size={16} className="text-violet-600" />
        </div>
        <span className="text-sm font-semibold text-violet-700">Audio → Texto</span>
      </div>

      <div className="space-y-2 text-xs">
        <div>
          <label className="text-gray-500 block mb-0.5">Idioma</label>
          <span className="text-gray-700">{data.language || 'es (Español)'}</span>
        </div>
        <div>
          <label className="text-gray-500 block mb-0.5">Variable de salida</label>
          <code className="bg-violet-50 px-1.5 py-0.5 rounded text-violet-700">{data.output_variable || 'transcripcion'}</code>
        </div>
        <div className="bg-violet-50 rounded p-1.5 text-violet-600 text-[10px]">
          🎤 Transcribe audios con Groq Whisper. El texto resultante se guarda en la variable indicada.
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-violet-500 !w-3 !h-3" />
    </div>
  );
}
