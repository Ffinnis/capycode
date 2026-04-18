import { useCallback, useRef, useState, type DragEvent } from "react";

export interface DroppedWorkspaceFile {
  relativePath: string;
  file: File;
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  fullPath?: string;
  name: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  isFile: true;
  file: (callback: (file: File) => void, errorCallback?: (error: unknown) => void) => void;
}

interface FileSystemDirectoryReaderLike {
  readEntries: (
    callback: (entries: FileSystemEntryLike[]) => void,
    errorCallback?: (error: unknown) => void,
  ) => void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  isDirectory: true;
  createReader: () => FileSystemDirectoryReaderLike;
}

type DataTransferItemWithWebkitEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

async function readFileEntry(
  entry: FileSystemFileEntryLike,
  relativePath: string,
): Promise<DroppedWorkspaceFile> {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve({ relativePath, file }),
      (error) => reject(error),
    );
  });
}

async function readDirectoryEntries(
  reader: FileSystemDirectoryReaderLike,
): Promise<FileSystemEntryLike[]> {
  const allEntries: FileSystemEntryLike[] = [];

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) {
      return allEntries;
    }
    allEntries.push(...batch);
  }
}

async function walkEntry(entry: FileSystemEntryLike, prefix = ""): Promise<DroppedWorkspaceFile[]> {
  const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

  if (entry.isFile) {
    return [await readFileEntry(entry as FileSystemFileEntryLike, relativePath)];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const reader = (entry as FileSystemDirectoryEntryLike).createReader();
  const children = await readDirectoryEntries(reader);
  const files = await Promise.all(children.map((child) => walkEntry(child, relativePath)));
  return files.flat();
}

export async function readDroppedWorkspaceFiles(dataTransfer: DataTransfer): Promise<{
  files: DroppedWorkspaceFile[];
  hasUnsupportedDirectories: boolean;
}> {
  const items = Array.from(dataTransfer.items ?? []);
  const webkitEntries = items.flatMap((item) => {
    const entry = (item as DataTransferItemWithWebkitEntry).webkitGetAsEntry?.();
    return entry ? [entry as FileSystemEntryLike] : [];
  });

  if (webkitEntries.length > 0) {
    const nestedFiles = await Promise.all(webkitEntries.map((entry) => walkEntry(entry)));
    return {
      files: nestedFiles.flat(),
      hasUnsupportedDirectories: false,
    };
  }

  return {
    files: Array.from(dataTransfer.files).map((file) => ({
      relativePath: file.webkitRelativePath || file.name,
      file,
    })),
    hasUnsupportedDirectories: false,
  };
}

export function useWorkspaceDropTarget(input: {
  onDropFiles: (files: DroppedWorkspaceFile[]) => Promise<void> | void;
}) {
  const dragDepthRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const onDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragOver(false);
      const result = await readDroppedWorkspaceFiles(event.dataTransfer);
      await input.onDropFiles(result.files);
    },
    [input],
  );

  return {
    isDragOver,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
