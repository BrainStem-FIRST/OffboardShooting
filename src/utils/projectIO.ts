import type { VideoData } from '../types';
import { videoToConfigurationSaveFile, parseConfigurationFile, LoadedConfiguration } from './trajectorySegments';

export const PROJECT_SUBDIR = 'videosAndConfigs';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.avi', '.3gp', '.webm', '.mkv']);

export function videoStem(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function configFileNameForVideo(videoName: string): string {
  return `${videoStem(videoName)}_configuration.json`;
}

export function videoStemFromConfigFile(configName: string): string | null {
  if (!configName.endsWith('_configuration.json')) return null;
  return configName.slice(0, -'_configuration.json'.length);
}

export function isVideoFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

export function fileRelativePath(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel ? rel.replace(/\\/g, '/') : file.name;
}

export interface ImportScanDiagnostics {
  totalFiles: number;
  resolvedCount: number;
  usedVideosAndConfigsSubfolder: boolean;
  paths: string[];
  videos: string[];
  configs: string[];
  unrecognized: string[];
}

/** Import uses all files in the selected folder (flat project layout). */
export function resolveProjectFiles(files: File[]): File[] {
  return files;
}

export function scanImportFiles(files: File[]): ImportScanDiagnostics {
  const paths = files.map(fileRelativePath);
  const videos = files.filter((f) => isVideoFileName(f.name)).map((f) => f.name);
  const configs = files.filter((f) => f.name.endsWith('_configuration.json')).map((f) => f.name);
  const unrecognized = files
    .filter((f) => !isVideoFileName(f.name) && !f.name.endsWith('_configuration.json'))
    .map((f) => f.name);

  return {
    totalFiles: files.length,
    resolvedCount: files.length,
    usedVideosAndConfigsSubfolder: false,
    paths,
    videos,
    configs,
    unrecognized,
  };
}

export function formatImportFailureMessage(scan: ImportScanDiagnostics): string {
  const lines = ['No video files found to import.'];
  lines.push(`Scanned ${scan.totalFiles} file(s) in the selected folder.`);

  if (scan.configs.length > 0 && scan.videos.length === 0) {
    lines.push(
      `Found ${scan.configs.length} config file(s) (${scan.configs.slice(0, 3).join(', ')}${scan.configs.length > 3 ? '…' : ''}) but no video files.`
    );
    lines.push('Add .mp4/.mov videos to the same folder as the configs.');
  } else if (scan.videos.length === 0) {
    lines.push('Expected pairs like shot1.mp4 + shot1_configuration.json in one folder.');
  }

  if (scan.unrecognized.length > 0) {
    lines.push(
      `Skipped unrecognized: ${scan.unrecognized.slice(0, 4).join(', ')}${scan.unrecognized.length > 4 ? ` (+${scan.unrecognized.length - 4} more)` : ''}.`
    );
  }

  return lines.join(' ');
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

/** Prefer calling showDirectoryPicker synchronously from a click handler (user activation). */
export function openDirectoryPicker(options: {
  mode: 'read' | 'readwrite';
}): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker(options);
}

export async function saveConfigsToDirectory(
  parentHandle: FileSystemDirectoryHandle,
  videos: VideoData[],
  onProgress?: (current: number, total: number) => void
): Promise<SaveProjectResult> {
  const dir = await parentHandle.getDirectoryHandle(PROJECT_SUBDIR, { create: true });
  if (!(await ensureDirWritePermission(dir))) {
    return { ok: false, cancelled: false, message: 'Write permission was denied for the selected folder.' };
  }

  const usedConfigNames = new Set<string>();

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    onProgress?.(i + 1, videos.length);

    let configFileName = configFileNameForVideo(video.name);
    while (usedConfigNames.has(configFileName)) {
      const stem = configFileName.replace(/_configuration\.json$/, '');
      configFileName = `${stem} (${usedConfigNames.size})_configuration.json`;
    }
    usedConfigNames.add(configFileName);

    try {
      const payload = videoToConfigurationSaveFile(video);
      const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      await writeBlobToFile(dir, configFileName, jsonBlob);
    } catch (err) {
      return {
        ok: false,
        cancelled: false,
        message: `Failed to save config for "${video.name}": ${(err as Error).message}`,
      };
    }
  }

  return { ok: true, count: videos.length };
}

/** Download config JSON files via the browser — no folder picker (same reliability as import's file input). */
export function downloadConfigFiles(videos: VideoData[]): { count: number; fileNames: string[] } {
  const usedConfigNames = new Set<string>();
  const fileNames: string[] = [];

  for (const video of videos) {
    let configFileName = configFileNameForVideo(video.name);
    while (usedConfigNames.has(configFileName)) {
      const stem = configFileName.replace(/_configuration\.json$/, '');
      configFileName = `${stem} (${usedConfigNames.size})_configuration.json`;
    }
    usedConfigNames.add(configFileName);
    fileNames.push(configFileName);

    const payload = videoToConfigurationSaveFile(video);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = configFileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { count: fileNames.length, fileNames };
}

function pickerErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('picker already active')) {
    return 'A folder picker is already open. Close any open folder dialogs, then try again.';
  }
  return `Could not open folder: ${msg}`;
}

export type SaveProjectResult =
  | { ok: true; count: number }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string };

export type ImportProjectResult =
  | { ok: true; preview: ProjectImportPreview; dirHandle: FileSystemDirectoryHandle }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string };

export type LoadProjectResult =
  | { ok: true; entries: ImportedProjectEntry[]; warnings: string[] }
  | { ok: false; message: string };

export interface ProjectImportPreview {
  pairs: { videoName: string; configName: string | null }[];
  orphanConfigs: string[];
}

export interface ImportedProjectEntry {
  file: File;
  config: LoadedConfiguration | null;
}

async function ensureDirWritePermission(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
  if ((await dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

async function ensureDirReadPermission(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
  if ((await dirHandle.queryPermission({ mode: 'read' })) === 'granted') return true;
  return (await dirHandle.requestPermission({ mode: 'read' })) === 'granted';
}

async function writeBlobToFile(dir: FileSystemDirectoryHandle, fileName: string, blob: Blob): Promise<void> {
  const safeName = sanitizeFileName(fileName);
  const fileHandle = await dir.getFileHandle(safeName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function resolveProjectDir(
  parent: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle> {
  try {
    return await parent.getDirectoryHandle(PROJECT_SUBDIR);
  } catch {
    return parent;
  }
}

export function buildImportPreview(fileNames: string[]): ProjectImportPreview {
  const videoNames = fileNames.filter(isVideoFileName);
  const configNames = fileNames.filter((n) => n.endsWith('_configuration.json'));

  const configByStem = new Map<string, string>();
  for (const c of configNames) {
    const stem = videoStemFromConfigFile(c);
    if (stem) configByStem.set(stem, c);
  }

  const usedConfigs = new Set<string>();
  const pairs = videoNames.map((videoName) => {
    const stem = videoStem(videoName);
    const configName = configByStem.get(stem) ?? null;
    if (configName) usedConfigs.add(configName);
    return { videoName, configName };
  });

  const orphanConfigs = configNames.filter((c) => !usedConfigs.has(c));
  return { pairs, orphanConfigs };
}

export function previewProjectFiles(
  files: File[]
): { ok: true; preview: ProjectImportPreview; files: File[]; scan: ImportScanDiagnostics } | { ok: false; message: string; scan: ImportScanDiagnostics } {
  const scan = scanImportFiles(files);

  const resolved = resolveProjectFiles(files);
  const preview = buildImportPreview(resolved.map((f) => f.name));
  if (preview.pairs.length === 0) {
    return { ok: false, message: formatImportFailureMessage(scan), scan };
  }
  return { ok: true, preview, files: resolved, scan };
}

export async function loadProjectEntriesFromFiles(
  files: File[],
  preview: ProjectImportPreview
): Promise<LoadProjectResult> {
  const byName = new Map(files.map((f) => [f.name, f]));
  const warnings: string[] = [];

  if (preview.orphanConfigs.length > 0) {
    warnings.push(
      `Unmatched config file${preview.orphanConfigs.length !== 1 ? 's' : ''}: ${preview.orphanConfigs.join(', ')}`
    );
  }

  const entries: ImportedProjectEntry[] = [];

  for (const pair of preview.pairs) {
    const file = byName.get(pair.videoName);
    if (!file) continue;

    let config: LoadedConfiguration | null = null;
    if (pair.configName) {
      const configFile = byName.get(pair.configName);
      if (configFile) {
        try {
          const text = await configFile.text();
          config = parseConfigurationFile(text);
          if (!config) warnings.push(`Could not parse ${pair.configName}`);
        } catch {
          warnings.push(`Failed to read ${pair.configName}`);
        }
      }
    } else {
      warnings.push(`No config for ${pair.videoName} — using defaults`);
    }

    entries.push({ file, config });
  }

  if (entries.length === 0) {
    return { ok: false, message: 'No videos could be loaded from the selected folder.' };
  }

  return { ok: true, entries, warnings };
}

async function listFileNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') names.push(name);
  }
  return names;
}

export async function pickProjectForImport(): Promise<ImportProjectResult> {
  if (typeof window.showDirectoryPicker !== 'function') {
    return {
      ok: false,
      cancelled: false,
      message: 'Folder import requires Chrome or Edge. Your browser does not support folder selection.',
    };
  }

  let parentHandle: FileSystemDirectoryHandle;
  try {
    parentHandle = await openDirectoryPicker({ mode: 'read' });
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') {
      return { ok: false, cancelled: true };
    }
    return { ok: false, cancelled: false, message: pickerErrorMessage(err) };
  }

  const dir = await resolveProjectDir(parentHandle);
  if (!(await ensureDirReadPermission(dir))) {
    return { ok: false, cancelled: false, message: 'Read permission was denied for the selected folder.' };
  }

  const fileNames = await listFileNames(dir);
  const preview = buildImportPreview(fileNames);
  if (preview.pairs.length === 0) {
    return {
      ok: false,
      cancelled: false,
      message: 'No video files found in the selected folder.',
    };
  }

  return { ok: true, preview, dirHandle: dir };
}

export async function loadProjectFromDir(
  dir: FileSystemDirectoryHandle
): Promise<LoadProjectResult> {
  const fileNames = await listFileNames(dir);
  const preview = buildImportPreview(fileNames);
  const files: File[] = [];
  for (const name of fileNames) {
    const handle = await dir.getFileHandle(name);
    files.push(await handle.getFile());
  }
  return loadProjectEntriesFromFiles(files, preview);
}

export async function saveProjectToFolder(
  videos: VideoData[],
  onProgress?: (current: number, total: number) => void
): Promise<SaveProjectResult> {
  if (videos.length === 0) {
    return { ok: false, cancelled: false, message: 'No videos to save.' };
  }

  if (typeof window.showDirectoryPicker !== 'function') {
    return {
      ok: false,
      cancelled: false,
      message: 'Folder export requires Chrome or Edge. Your browser does not support folder selection.',
    };
  }

  let parentHandle: FileSystemDirectoryHandle;
  try {
    parentHandle = await openDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') {
      return { ok: false, cancelled: true };
    }
    return { ok: false, cancelled: false, message: pickerErrorMessage(err) };
  }

  const dir = await parentHandle.getDirectoryHandle(PROJECT_SUBDIR, { create: true });
  if (!(await ensureDirWritePermission(dir))) {
    return { ok: false, cancelled: false, message: 'Write permission was denied for the selected folder.' };
  }

  const usedVideoNames = new Set<string>();
  const usedConfigNames = new Set<string>();

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    onProgress?.(i + 1, videos.length);

    let videoFileName = sanitizeFileName(video.name);
    while (usedVideoNames.has(videoFileName)) {
      const dot = videoFileName.lastIndexOf('.');
      const stem = dot >= 0 ? videoFileName.slice(0, dot) : videoFileName;
      const ext = dot >= 0 ? videoFileName.slice(dot) : '';
      videoFileName = `${stem} (${usedVideoNames.size})${ext}`;
    }
    usedVideoNames.add(videoFileName);

    let configFileName = configFileNameForVideo(videoFileName);
    while (usedConfigNames.has(configFileName)) {
      const stem = videoStemFromConfigFile(configFileName) ?? videoStem(videoFileName);
      configFileName = `${stem} (${usedConfigNames.size})_configuration.json`;
    }
    usedConfigNames.add(configFileName);

    try {
      const response = await fetch(video.url);
      if (!response.ok) {
        return { ok: false, cancelled: false, message: `Failed to read video "${video.name}" from memory.` };
      }
      const blob = await response.blob();
      await writeBlobToFile(dir, videoFileName, blob);

      const payload = videoToConfigurationSaveFile(video);
      const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      await writeBlobToFile(dir, configFileName, jsonBlob);
    } catch (err) {
      return {
        ok: false,
        cancelled: false,
        message: `Failed to save "${video.name}": ${(err as Error).message}`,
      };
    }
  }

  return { ok: true, count: videos.length };
}
