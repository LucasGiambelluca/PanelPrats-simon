import { X } from 'lucide-react';
import { nodeItems } from './Sidebar';

interface MobileNodeSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (type: string) => void;
}

export default function MobileNodeSelector({ isOpen, onClose, onSelect }: MobileNodeSelectorProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-brand-ivory animate-in slide-in-from-bottom duration-300">
      <div className="flex items-center justify-between p-4 border-b border-brand-hairline bg-brand-surface">
        <h2 className="font-serif font-bold text-brand-ink">Agregar Nodo</h2>
        <button onClick={onClose} className="p-2 text-brand-inkmuted hover:bg-brand-panel rounded-full transition">
          <X size={24} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3 pb-8">
          {nodeItems.map(item => (
            <button
              key={item.type}
              onClick={() => {
                onSelect(item.type);
                onClose();
              }}
              className="flex flex-col items-center gap-2 p-4 bg-brand-surface border border-brand-hairline rounded-2xl shadow-card active:scale-95 transition-all text-center"
            >
              <div className={`${item.bg} p-3 rounded-xl ${item.text}`}>
                <item.icon size={24} />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-brand-ink">{item.label}</span>
                <span className="text-[10px] text-brand-inkmuted line-clamp-1">{item.desc}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
