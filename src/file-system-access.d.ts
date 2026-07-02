/** File System Access API (Chrome/Edge) — not fully covered by default DOM typings. */
export {};

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemWritableFileStream extends WritableStream {
    write(data: BufferSource | Blob | string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }

  interface FileSystemFileHandle extends FileSystemHandle {
    getFile(): Promise<File>;
    createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  interface FileSystemDirectoryHandle extends FileSystemHandle {
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker(options?: {
      multiple?: boolean;
      mode?: 'read' | 'readwrite';
      types?: { description?: string; accept: Record<string, string[]> }[];
    }): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker(options?: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }): Promise<FileSystemFileHandle>;
  }
}
