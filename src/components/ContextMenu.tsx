import { useEffect } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('[data-context-menu]')) return;
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (items.length === 0) return null;

  return (
    <div
      data-context-menu
      className="fixed z-50 min-w-[10rem] bg-gray-900 border border-gray-600 rounded-md shadow-xl py-1 text-sm text-gray-200"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`block w-full text-left px-3 py-1.5 hover:bg-gray-800 ${
            item.variant === 'danger' ? 'text-red-300' : ''
          }`}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
