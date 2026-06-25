import { useRef, useState, useEffect, type ReactNode } from 'react';
import { panelItemTitle } from './panelStyles';

interface Props {
  title: string;
  titleId?: string;
  children: ReactNode;
  widthClass?: string;
  initialPosition?: { x: number; y: number };
}

function clampPosition(
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number
): { x: number; y: number } {
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - panelWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - panelHeight - margin);
  return {
    x: Math.min(maxX, Math.max(margin, x)),
    y: Math.min(maxY, Math.max(margin, y)),
  };
}

export default function DraggablePanel({
  title,
  titleId = 'draggable-panel-title',
  children,
  widthClass = 'w-72',
  initialPosition,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [pos, setPos] = useState({ x: 16, y: 16 });
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const start = initialPosition ?? { x: window.innerWidth - rect.width - 16, y: 16 };
    setPos(clampPosition(start.x, start.y, rect.width, rect.height));
    setReady(true);
  }, [initialPosition]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current || !panelRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const rect = panelRef.current.getBoundingClientRect();
      setPos(
        clampPosition(
          dragRef.current.originX + dx,
          dragRef.current.originY + dy,
          rect.width,
          rect.height
        )
      );
    }
    function onUp() {
      dragRef.current = null;
      setDragging(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function onDragStart(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button, input, a, label')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    setDragging(true);
  }

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`absolute pointer-events-auto ${widthClass} rounded-xl border border-gray-600 bg-gray-900/95 p-3 shadow-xl backdrop-blur-sm ${
          ready ? '' : 'invisible'
        }`}
        style={{ left: pos.x, top: pos.y }}
      >
        <div
          className={`select-none touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseDown={onDragStart}
        >
          <h2 id={titleId} className={`${panelItemTitle} text-sm`}>
            {title}
          </h2>
          <p className="text-[10px] text-gray-500 mt-0.5 mb-2">Drag header to move</p>
        </div>
        {children}
      </div>
    </div>
  );
}
