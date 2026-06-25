import { useState } from 'react';
import type { XDir } from '../types';
import { panelBtnPrimary, panelHint, panelItemTitle, panelSectionTitle } from './panelStyles';

type Props = {
  onSubmit: (xdir: XDir) => void;
  onCancel: () => void;
} & (
  | { mode?: 'upload'; fileCount: number }
  | { mode: 'edit'; videoName: string; initialXdir: XDir }
);

export default function XdirUploadDialog(props: Props) {
  const { onSubmit, onCancel } = props;
  const isEdit = props.mode === 'edit';
  const initialXdir = isEdit ? props.initialXdir : 1;
  const [xdir, setXdir] = useState<XDir>(initialXdir);

  const title = isEdit ? 'Edit video settings' : 'Trajectory direction';
  const description = isEdit
    ? `Which way does the projectile travel in "${props.videoName}"?`
    : props.fileCount === 1
      ? 'Which way does the projectile travel in this video?'
      : `Which way do the projectiles travel in these ${props.fileCount} videos?`;
  const submitLabel = isEdit ? 'Save' : `Add video${props.fileCount !== 1 ? 's' : ''}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label={isEdit ? 'Cancel' : 'Cancel upload'}
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="xdir-upload-title"
        className="relative w-full max-w-sm rounded-xl border border-gray-600 bg-gray-900 p-5 shadow-xl"
      >
        <h2 id="xdir-upload-title" className={`${panelItemTitle} mb-1`}>
          {title}
        </h2>
        <p className={`${panelHint} mb-4`}>
          {description}
        </p>

        <p className={`${panelSectionTitle} mb-2`}>Shooting direction</p>
        <div className="grid grid-cols-2 gap-2 mb-5">
          <button
            type="button"
            onClick={() => setXdir(-1)}
            className={`px-3 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
              xdir === -1
                ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                : 'border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            ← Left
          </button>
          <button
            type="button"
            onClick={() => setXdir(1)}
            className={`px-3 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
              xdir === 1
                ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                : 'border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Right →
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(xdir)}
            className={`flex-1 ${panelBtnPrimary} bg-blue-600 hover:bg-blue-500 text-white`}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
