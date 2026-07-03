import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

interface Props {
  orientation?: 'horizontal' | 'vertical';
  onDrag: (delta: number) => void;
  className?: string;
}

export default function PanelResizeHandle({
  orientation = 'horizontal',
  onDrag,
  className = '',
}: Props) {
  const lastPosRef = useRef<number | null>(null);
  const onDragRef = useRef(onDrag);
  const orientationRef = useRef(orientation);

  useEffect(() => {
    onDragRef.current = onDrag;
  }, [onDrag]);

  useEffect(() => {
    orientationRef.current = orientation;
  }, [orientation]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const last = lastPosRef.current;
    if (last === null) return;
    const pos = orientationRef.current === 'horizontal' ? e.clientY : e.clientX;
    lastPosRef.current = pos;
    onDragRef.current(pos - last);
  }, []);

  const stopDrag = useCallback(() => {
    lastPosRef.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [handlePointerMove]);

  const startDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    lastPosRef.current = orientation === 'horizontal' ? e.clientY : e.clientX;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    document.body.style.cursor = orientation === 'horizontal' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, [handlePointerMove, orientation, stopDrag]);

  const isHorizontal = orientation === 'horizontal';

  useEffect(() => () => stopDrag(), [stopDrag]);

  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
      className={`group flex-shrink-0 select-none ${isHorizontal ? 'h-2 cursor-row-resize' : 'w-2 cursor-col-resize'} ${className}`}
      onPointerDown={startDrag}
    >
      <div className={`h-full w-full transition-colors ${isHorizontal ? 'py-[3px]' : 'px-[3px]'}`}>
        <div
          className={`bg-gray-700 group-hover:bg-blue-500/70 ${
            isHorizontal ? 'h-px w-full' : 'h-full w-px'
          }`}
        />
      </div>
    </div>
  );
}
