import { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Search, Plus, Trash2, Tag } from 'lucide-react';

/**
 * KeywordNode: Un componente visual que permite definir palabras clave y ramificar el flujo.
 */
export default memo(({ data, isConnectable }: any) => {
  const [keywords, setKeywords] = useState(data.keywords || []);

  const addKeyword = () => {
    const newKeywords = [...keywords, { word: '', handle: `branch_${Date.now()}` }];
    setKeywords(newKeywords);
    data.onChangeKeywords?.(newKeywords);
  };

  const updateKeyword = (index: number, word: string) => {
    const newKeywords = [...keywords];
    newKeywords[index].word = word;
    setKeywords(newKeywords);
    data.onChangeKeywords?.(newKeywords);
  };

  const removeKeyword = (index: number) => {
    const newKeywords = keywords.filter((_: any, i: number) => i !== index);
    setKeywords(newKeywords);
    data.onChangeKeywords?.(newKeywords);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg border-2 border-indigo-200 w-72">
      <div className="bg-indigo-600 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Search size={16} />
            <span className="font-medium text-sm">Detector de Palabras</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
        </button>
      </div>

      <div className="p-3 bg-indigo-50">
        <p className="text-[10px] text-indigo-700 mb-2 font-medium uppercase tracking-wider">
           Busca palabras en el mensaje / audio
        </p>
        
        <div className="space-y-2 mb-3 max-h-48 overflow-y-auto pr-1">
          {keywords.map((kw: any, index: number) => (
            <div key={index} className="flex items-center gap-2 group">
              <div className="relative flex-1">
                <Tag size={10} className="absolute left-2 top-2 text-indigo-400" />
                <input
                  type="text"
                  className="w-full text-xs pl-6 p-1.5 border rounded-md focus:ring-1 focus:ring-indigo-500 outline-none"
                  value={kw.word}
                  onChange={(e) => updateKeyword(index, e.target.value)}
                  placeholder="Ej: pedido"
                />
              </div>
              <button 
                onClick={() => removeKeyword(index)}
                className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
              >
                <Trash2 size={12} />
              </button>
              
              {/* Handle dinámico para cada rama */}
              <Handle 
                type="source" 
                position={Position.Right} 
                id={kw.handle}
                style={{ top: 110 + (index * 36), background: '#6366f1' }}
                isConnectable={isConnectable} 
              />
              <div 
                className="absolute -right-12 text-[9px] font-bold text-indigo-600 pointer-events-none"
                style={{ top: 104 + (index * 36) }}
              >
                MATCH
              </div>
            </div>
          ))}
        </div>

        <button 
          onClick={addKeyword}
          className="w-full flex items-center justify-center gap-1 py-1 px-2 bg-indigo-100 text-indigo-700 rounded-md hover:bg-indigo-200 transition text-[10px] font-bold"
        >
          <Plus size={12} /> AGREGAR PALABRA
        </button>

        <div className="mt-4 pt-2 border-t border-indigo-100 flex justify-between items-center pr-2">
            <span className="text-[10px] text-gray-400 font-bold">DEFAULT (SINO)</span>
            <Handle 
              type="source" 
              position={Position.Right} 
              id="default"
              style={{ background: '#94a3b8', bottom: 15, top: 'auto' }}
              isConnectable={isConnectable} 
            />
        </div>
      </div>
      
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
    </div>
  );
});
