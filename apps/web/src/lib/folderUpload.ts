import { IGNORED_DIRECTORIES, normalizeRelativePath, skipReason, stripRootFolder } from "@orbs/protocol";
import { t } from "../i18n/index.ts";
import { rpc } from "./rpc.ts";

export interface PickedFile {
  path: string;
  file: File;
}

export interface PickedFolder {
  rootName: string;
  files: PickedFile[];
  skipped: number;
}

const ignoredDirs = new Set<string>(IGNORED_DIRECTORIES);

/** Files from `<input type="file" webkitdirectory>`: paths start with the chosen folder name. */
export function fromFileList(list: FileList): PickedFolder {
  const all = Array.from(list);
  const rootName = all[0]?.webkitRelativePath.split("/")[0] || t("code.defaultProjectName");
  return filter(
    rootName,
    all.map((file) => ({ path: stripRootFolder(file.webkitRelativePath || file.name), file })),
  );
}

/** Files from a drag-and-drop of one folder. Ignored folders are not even walked. */
export async function fromDataTransfer(items: DataTransferItemList): Promise<PickedFolder | null> {
  const entry = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .find((e): e is FileSystemDirectoryEntry => e?.isDirectory === true);
  if (!entry) return null;
  const files: PickedFile[] = [];
  await walk(entry, "", files);
  return filter(entry.name, files);
}

async function walk(dir: FileSystemDirectoryEntry, prefix: string, out: PickedFile[]) {
  const reader = dir.createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    for (const entry of batch) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (!ignoredDirs.has(entry.name)) await walk(entry as FileSystemDirectoryEntry, path, out);
      } else {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        );
        out.push({ path, file });
      }
    }
  }
}

function filter(rootName: string, files: PickedFile[]): PickedFolder {
  const kept: PickedFile[] = [];
  let skipped = 0;
  for (const f of files) {
    const path = normalizeRelativePath(f.path);
    if (!path || skipReason(path)) {
      skipped += 1;
      continue;
    }
    kept.push({ path, file: f.file });
  }
  return { rootName, files: kept, skipped };
}

const MAX_BATCH_FILES = 100;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;

export interface UploadProgress {
  done: number;
  total: number;
}

/** Uploads in batches so large folders never become one huge request. */
export async function uploadToProject(
  projectId: string,
  files: PickedFile[],
  onProgress: (progress: UploadProgress) => void,
) {
  let saved = 0;
  const skipped: Array<{ path: string; reason: string }> = [];
  let batch: PickedFile[] = [];
  let batchBytes = 0;
  let done = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const result = await rpc.projects.uploadFiles({ projectId, files: batch });
    saved += result.saved;
    skipped.push(...result.skipped);
    done += batch.length;
    onProgress({ done, total: files.length });
    batch = [];
    batchBytes = 0;
  };

  onProgress({ done: 0, total: files.length });
  for (const f of files) {
    if (batch.length >= MAX_BATCH_FILES || (batch.length > 0 && batchBytes + f.file.size > MAX_BATCH_BYTES)) {
      await flush();
    }
    batch.push(f);
    batchBytes += f.file.size;
  }
  await flush();
  return { saved, skipped };
}
