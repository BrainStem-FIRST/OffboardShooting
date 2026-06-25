import type { ReactNode } from 'react';
import { panelItemTitle } from './panelStyles';

interface Props {
  title: string;
  titleId?: string;
  onDismiss?: () => void;
  dismissAriaLabel?: string;
  children: ReactNode;
  maxWidthClass?: string;
}

export default function ModalDialog({
  title,
  titleId = 'modal-dialog-title',
  onDismiss,
  dismissAriaLabel = 'Close dialog',
  children,
  maxWidthClass = 'max-w-sm',
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {onDismiss && (
        <button
          type="button"
          className="absolute inset-0 bg-black/60"
          aria-label={dismissAriaLabel}
          onClick={onDismiss}
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${maxWidthClass} rounded-xl border border-gray-600 bg-gray-900 p-5 shadow-xl`}
      >
        <h2 id={titleId} className={`${panelItemTitle} mb-1`}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
