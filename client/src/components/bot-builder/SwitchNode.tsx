import { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { GitBranch, Plus, Trash2, Key } from 'lucide-react';

/**
 * SwitchNode: Evalúa una variable y ramifica según su valor exacto.
 */
export default memo(({ data, isConnectable }: any) => {
  const [cases, setCases] = useState(data.cases || []);

  const addCase = () => {
    const newCases = [...cases, { value: '', handle: `case_${Date.now()}` }];
    setCases(newCases);
    data.onChangeCases?.(newCases);
  };

  const updateCase = (index: number, value: string) => {
    const newCases = [...cases];
    newCases[index].value = value;
    setCases(newCases);
    data.onChangeCases?.(newCases);
  };

  const removeCase = (index: number) => {
    const newCases = cases.filter((_: any, i: number) => i !== index);
    setCases(newCases);
    data.onChangeCases?.(newCases);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg border-2 border-amber-200 w-72">
      <div className="bg-amber-500 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <GitBranch size={16} />
            <span className="font-medium text-sm">Switch Universal</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-red-200 transition">
            <Trash2 size={14} />
        </button>
      </div>

      <div className="p-3 bg-amber-50">
        <div className="mb-3">
          <label className="block text-[10px] font-bold text-amber-700 mb-1 uppercase tracking-tighter">Variable a evaluar:</label>
          <div className="relative">
            <Key size={10} className="absolute left-2 top-2 text-amber-400" />
            <input
              type="text"
              className="w-full text-xs pl-6 p-1.5 border rounded-md font-mono bg-white focus:ring-1 focus:ring-amber-500 outline-none"
              value={data.variable}
              onChange={(e) => data.onChangeVariable?.(e.target.value)}
              placeholder="ej: mi_variable"
            />
          </div>
        </div>

        <p className="text-[10px] text-amber-700 mb-2 font-medium uppercase tracking-wider">
           Caminos (Valores exactos)
        </p>
        
        <div className="space-y-2 mb-3 max-h-48 overflow-y-auto pr-1">
          {cases.map((c: any, index: number) => (
            <div key={index} className="flex items-center gap-2 group">
              <input
                type="text"
                className="flex-1 text-xs p-1.5 border rounded-md bg-white focus:ring-1 focus:ring-amber-500 outline-none"
                value={c.value}
                onChange={(e) => updateCase(index, e.target.value)}
                placeholder="Si vale esto..."
              />
              <button 
                onClick={() => removeCase(index)}
                className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
              >
                <Trash2 size={12} />
              </button>
              
              <Handle 
                type="source" 
                position={Position.Right} 
                id={c.handle}
                style={{ top: 145 + (index * 36), background: '#f59e0b' }}
                isConnectable={isConnectable} 
              />
            </div>
          ))}
        </div>

        <button 
          onClick={addCase}
          className="w-full flex items-center justify-center gap-1 py-1 px-2 bg-amber-100 text-amber-700 rounded-md hover:bg-amber-200 transition text-[10px] font-bold"
        >
          <Plus size={12} /> AGREGAR CASO
        </button>

        <div className="mt-4 pt-2 border-t border-amber-100 flex justify-between items-center pr-2">
            <span className="text-[10px] text-gray-400 font-bold">OTRO VALOR (SINO)</span>
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
