import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { BarChart2, Plus, Trash2 } from 'lucide-react';

export default memo(({ data, isConnectable }: any) => {
  const options = data.options || ['Opción 1', 'Opción 2'];

  const handleAddOption = () => {
    const newOptions = [...options, `Opción ${options.length + 1}`];
    data.onChangeOptions(newOptions);
  };

  const handleRemoveOption = (index: number) => {
    const newOptions = options.filter((_: any, i: number) => i !== index);
    data.onChangeOptions(newOptions);
  };

  const handleChangeOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    data.onChangeOptions(newOptions);
  };

  return (
    <div className="bg-white rounded-lg border-2 border-purple-500 shadow-lg min-w-[280px]">
      <div className="bg-purple-100 p-2 rounded-t-lg border-b border-purple-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <BarChart2 size={16} className="text-purple-600" />
            <span className="font-bold text-gray-700 text-sm">Encuesta</span>
        </div>
        <button onClick={data.onDelete} className="text-gray-400 hover:text-red-500">
            <Trash2 size={14} />
        </button>
      </div>
      
      <div className="p-3 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Pregunta</label>
          <input 
            className="w-full text-sm border-gray-300 rounded focus:ring-purple-500 py-1" 
            value={data.question} 
            onChange={(evt) => data.onChangeQuestion(evt.target.value)}
            placeholder="¿Qué preferís?"
          />
        </div>

        <div>
           <label className="block text-xs font-semibold text-gray-500 mb-1">Opciones</label>
           <div className="space-y-2">
             {options.map((opt: string, idx: number) => (
                <div key={idx} className="flex items-center gap-1 relative">
                    <input 
                        className="w-full text-sm border-gray-300 rounded focus:ring-purple-500 py-1 pr-8"
                        value={opt}
                        onChange={(e) => handleChangeOption(idx, e.target.value)}
                        placeholder={`Opción ${idx + 1}`}
                    />
                    <button 
                        onClick={() => handleRemoveOption(idx)}
                        className="text-gray-400 hover:text-red-500 absolute right-2"
                    >
                        <Trash2 size={14} />
                    </button>
                    {/* Dynamic Handle for this Option */}
                    <Handle 
                        type="source" 
                        position={Position.Right} 
                        id={`option-${idx}`} // Crucial ID for matching
                        isConnectable={isConnectable} 
                        className="w-3 h-3 bg-purple-500 -right-4"
                        style={{ top: '50%' }}
                    />
                </div>
             ))}
           </div>
           <button 
            onClick={handleAddOption}
            className="mt-2 text-xs flex items-center gap-1 text-purple-600 hover:text-purple-700 font-medium"
           >
            <Plus size={14} /> Agregar Opción
           </button>
        </div>

        <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Guardar en Variable</label>
            <input 
                className="w-full text-sm border-gray-300 rounded focus:ring-purple-500 py-1 font-mono bg-gray-50" 
                value={data.variable} 
                onChange={(evt) => data.onChangeVariable(evt.target.value)}
                placeholder="ej: preferencia_cliente"
            />
        </div>
      </div>

      <Handle type="target" position={Position.Top} isConnectable={isConnectable} className="w-3 h-3 bg-gray-400" />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} className="w-3 h-3 bg-purple-500" />
    </div>
  );
});
