import { useRef } from 'react';
import { Upload, Film, Trash2 } from 'lucide-react';
import { VideoData } from '../types';

interface Props {
  videos: VideoData[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpload: (files: FileList) => void;
  onDelete: (id: string) => void;
  width: number;
}

export default function VideoSidebar({ videos, selectedId, onSelect, onUpload, onDelete, width }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
      e.target.value = '';
    }
  }

  return (
    <aside className="flex flex-col bg-gray-900 border-r border-gray-700 h-full" style={{ width }}>
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Videos</h2>
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Upload size={16} />
          Upload Video
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mov,.mp4,.m4v,.avi,.3gp"
          multiple
          className="hidden"
          onChange={handleFiles}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {videos.length === 0 && (
          <p className="text-gray-500 text-xs text-center mt-8 px-2 leading-relaxed">
            No videos yet. Upload an iPhone video to get started.
          </p>
        )}
        {videos.map((v) => (
          <div
            key={v.id}
            onClick={() => onSelect(v.id)}
            className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
              v.id === selectedId
                ? 'bg-blue-600 text-white'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <Film size={15} className="flex-shrink-0" />
            <span className="text-xs font-medium truncate flex-1">{v.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(v.id); }}
              className={`flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 ${
                v.id === selectedId ? 'hover:bg-blue-400' : 'hover:bg-gray-700'
              }`}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
