import { useRef, useState } from 'react';
import { FileUp, Settings } from 'lucide-react';
import ModalDialog from './ModalDialog';
import { configFileNameForVideo } from '../utils/projectIO';
import { parseConfigurationFile, type LoadedConfiguration } from '../utils/trajectorySegments';
import type { VideoData } from '../types';
import { panelBtnPrimary, panelHint, panelMeta, panelMono } from './panelStyles';

interface Props {
  video: VideoData;
  onAttachConfig: (config: LoadedConfiguration) => void;
  onEditSettings: () => void;
  onDismiss: () => void;
}

export default function VideoOptionsDialog({ video, onAttachConfig, onEditSettings, onDismiss }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleConfigFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setStatus(null);
    try {
      const text = await file.text();
      const config = parseConfigurationFile(text);
      if (!config) {
        setStatus({ ok: false, text: `Could not parse "${file.name}". Expected a configuration JSON file.` });
        return;
      }
      onAttachConfig(config);
      onDismiss();
    } catch {
      setStatus({ ok: false, text: `Failed to read "${file.name}".` });
    }
  }

  const expectedConfigName = configFileNameForVideo(video.name);

  return (
    <ModalDialog title={video.name} onDismiss={onDismiss} maxWidthClass="max-w-md">
      <p className={`${panelHint} mb-3`}>
        Select this video for labeling, or attach a saved configuration to load trajectory points and meterstick data.
      </p>
      <p className={`${panelMeta} mb-4`}>
        Expected config name: <span className={panelMono}>{expectedConfigName}</span>
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleConfigFile}
      />

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`w-full ${panelBtnPrimary} bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white`}
        >
          <FileUp size={16} />
          Attach config file
        </button>
        <button
          type="button"
          onClick={onEditSettings}
          className={`w-full ${panelBtnPrimary} bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white`}
        >
          <Settings size={16} />
          Edit video settings
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className={`w-full ${panelBtnPrimary} bg-blue-600 hover:bg-blue-500 text-white`}
        >
          Continue without config
        </button>
      </div>

      {status && (
        <p className={`mt-3 text-xs leading-snug ${status.ok ? 'text-green-400' : 'text-red-400'}`}>
          {status.text}
        </p>
      )}
    </ModalDialog>
  );
}
