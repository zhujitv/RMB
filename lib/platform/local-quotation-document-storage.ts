import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

type LocalStorageError = Error & { status?: number; code?: string; expose?: boolean };

type LocalReadOptions = {
  maxBytes: number;
  root?: string;
};

type LocalWriteOptions = LocalReadOptions & {
  body: Buffer | Uint8Array;
};

function localStorageError(message: string, status: number, code: string): LocalStorageError {
  const error: LocalStorageError = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}

function errorCode(error: unknown) {
  return String((error as NodeJS.ErrnoException | null)?.code || "");
}

export function defaultQuotationLocalStorageRoot() {
  return join(/* turbopackIgnore: true */ process.cwd(), ".local-storage", "quotation-documents");
}

function sameOrInside(base: string, target: string) {
  const pathFromBase = relative(/* turbopackIgnore: true */ base, target);
  return !pathFromBase
    || (!pathFromBase.startsWith(`..${sep}`) && pathFromBase !== ".." && !isAbsolute(pathFromBase));
}

function sensitiveRoots(workspace: string) {
  return [
    join(/* turbopackIgnore: true */ workspace, "public"),
    join(/* turbopackIgnore: true */ workspace, ".git"),
    join(/* turbopackIgnore: true */ workspace, ".next"),
  ];
}

function safeRoot(value: string) {
  const root = resolve(/* turbopackIgnore: true */ value);
  const workspace = resolve(/* turbopackIgnore: true */ process.cwd());
  const localBase = join(/* turbopackIgnore: true */ workspace, ".local-storage");
  if (root === parse(root).root || root === workspace
    || (sameOrInside(workspace, root) && !sameOrInside(localBase, root))
    || sensitiveRoots(workspace).some((blocked) => sameOrInside(blocked, root))) {
    throw localStorageError("本地文件存储目录不安全", 500, "LOCAL_STORAGE_ROOT_INVALID");
  }
  return root;
}

function safeKey(key: string) {
  if (!key || key.length > 1024 || isAbsolute(key) || /[\\\0-\x1f\x7f]/.test(key)) {
    throw localStorageError("本地文件存储路径无效", 400, "LOCAL_STORAGE_PATH_INVALID");
  }
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || Buffer.byteLength(segment) > 255)) {
    throw localStorageError("本地文件存储路径无效", 400, "LOCAL_STORAGE_PATH_INVALID");
  }
  return segments;
}

function assertInside(root: string, target: string) {
  const pathFromRoot = relative(/* turbopackIgnore: true */ root, target);
  if (!pathFromRoot || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw localStorageError("本地文件存储路径越界", 400, "LOCAL_STORAGE_PATH_INVALID");
  }
}

async function ensureRoot(value?: string) {
  const workspace = await realpath(/* turbopackIgnore: true */ process.cwd());
  const testRoot = process.env.NODE_ENV === "test"
    ? String(process.env.QUOTATION_LOCAL_STORAGE_ROOT || "").trim()
    : "";
  const requestedValue = value || testRoot;
  if (requestedValue) {
    const requested = safeRoot(requestedValue);
    let requestedInfo;
    try {
      requestedInfo = await lstat(/* turbopackIgnore: true */ requested);
    } catch {
      throw localStorageError("自定义本地存储目录必须预先创建", 500, "LOCAL_STORAGE_ROOT_INVALID");
    }
    if (requestedInfo.isSymbolicLink() || !requestedInfo.isDirectory()) {
      throw localStorageError("本地文件存储目录不安全", 500, "LOCAL_STORAGE_ROOT_INVALID");
    }
    const physical = await realpath(/* turbopackIgnore: true */ requested);
    const localBase = join(/* turbopackIgnore: true */ workspace, ".local-storage");
    if ((sameOrInside(workspace, requested) && !sameOrInside(localBase, physical))
      || sensitiveRoots(workspace).some((blocked) => sameOrInside(blocked, physical))) {
      throw localStorageError("本地文件存储目录不安全", 500, "LOCAL_STORAGE_ROOT_INVALID");
    }
    await chmod(/* turbopackIgnore: true */ physical, 0o700);
    return physical;
  }

  let root = workspace;
  for (const segment of [".local-storage", "quotation-documents"]) {
    root = join(/* turbopackIgnore: true */ root, segment);
    try {
      await mkdir(/* turbopackIgnore: true */ root, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const segmentInfo = await lstat(/* turbopackIgnore: true */ root);
    if (segmentInfo.isSymbolicLink() || !segmentInfo.isDirectory()) {
      throw localStorageError("本地文件存储目录不安全", 500, "LOCAL_STORAGE_ROOT_INVALID");
    }
  }
  const physical = await realpath(/* turbopackIgnore: true */ root);
  if (!sameOrInside(workspace, physical)
    || sensitiveRoots(workspace).some((blocked) => sameOrInside(blocked, physical))) {
    throw localStorageError("本地文件存储目录不安全", 500, "LOCAL_STORAGE_ROOT_INVALID");
  }
  await chmod(/* turbopackIgnore: true */ physical, 0o700);
  return physical;
}

async function existingDirectoryChain(root: string, segments: string[]) {
  let cursor = root;
  for (const segment of segments) {
    cursor = join(/* turbopackIgnore: true */ cursor, segment);
    const info = await lstat(/* turbopackIgnore: true */ cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw localStorageError("本地文件存储目录包含无效链接", 409, "LOCAL_STORAGE_SYMLINK_REJECTED");
    }
  }
  return cursor;
}

async function writableDirectoryChain(root: string, segments: string[]) {
  let cursor = root;
  for (const segment of segments) {
    cursor = join(/* turbopackIgnore: true */ cursor, segment);
    assertInside(root, cursor);
    try {
      await mkdir(/* turbopackIgnore: true */ cursor, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const info = await lstat(/* turbopackIgnore: true */ cursor);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw localStorageError("本地文件存储目录包含无效链接", 409, "LOCAL_STORAGE_SYMLINK_REJECTED");
    }
  }
  return cursor;
}

async function writableTarget(key: string, rootValue?: string) {
  const root = await ensureRoot(rootValue);
  const segments = safeKey(key);
  const targetDirectory = await writableDirectoryChain(root, segments.slice(0, -1));
  const target = join(/* turbopackIgnore: true */ targetDirectory, segments.at(-1) || "");
  assertInside(root, target);
  try {
    const existing = await lstat(/* turbopackIgnore: true */ target);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw localStorageError("本地文件目标不安全", 409, "LOCAL_STORAGE_SYMLINK_REJECTED");
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  return { root, target };
}

async function readableTarget(key: string, rootValue?: string) {
  const root = await ensureRoot(rootValue);
  const segments = safeKey(key);
  try {
    await existingDirectoryChain(root, segments.slice(0, -1));
    const candidate = resolve(/* turbopackIgnore: true */ root, ...segments);
    assertInside(root, candidate);
    const candidateInfo = await lstat(/* turbopackIgnore: true */ candidate);
    if (candidateInfo.isSymbolicLink() || !candidateInfo.isFile()) {
      throw localStorageError("本地文件目标不安全", 409, "LOCAL_STORAGE_SYMLINK_REJECTED");
    }
    const target = await realpath(/* turbopackIgnore: true */ candidate);
    assertInside(root, target);
    return target;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw localStorageError("形式发票文件不存在，请重新生成", 404, "R2_OBJECT_NOT_FOUND");
    }
    throw error;
  }
}

export async function readLocalQuotationDocument(key: string, options: LocalReadOptions) {
  const target = await readableTarget(key, options.root);
  const handle = await open(/* turbopackIgnore: true */ target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const fileInfo = await handle.stat();
    if (!fileInfo.isFile()) throw localStorageError("本地文件格式无效", 409, "LOCAL_STORAGE_FILE_INVALID");
    if (fileInfo.size > options.maxBytes) {
      throw localStorageError("文件超过安全读取上限", 413, "R2_OBJECT_TOO_LARGE");
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let position = 0;
    while (true) {
      const remaining = options.maxBytes - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position);
      if (!bytesRead) break;
      totalBytes += bytesRead;
      if (totalBytes > options.maxBytes) {
        throw localStorageError("文件超过安全读取上限", 413, "R2_OBJECT_TOO_LARGE");
      }
      chunks.push(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    await handle.close();
  }
}

export async function writeLocalQuotationDocument(key: string, options: LocalWriteOptions) {
  const body = Buffer.from(options.body);
  if (body.byteLength > options.maxBytes) {
    throw localStorageError("文件超过安全写入上限", 413, "R2_OBJECT_TOO_LARGE");
  }
  const { target } = await writableTarget(key, options.root);
  const temporary = join(
    /* turbopackIgnore: true */ dirname(/* turbopackIgnore: true */ target),
    `.${basename(/* turbopackIgnore: true */ target)}.${randomUUID()}.tmp`,
  );
  const handle = await open(
    /* turbopackIgnore: true */ temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(body);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(/* turbopackIgnore: true */ temporary, target);
    await chmod(/* turbopackIgnore: true */ target, 0o600);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    const existing = await readLocalQuotationDocument(key, options);
    if (!existing.equals(body)) {
      throw localStorageError("相同文件标识已存在不同内容", 409, "STORAGE_KEY_CONFLICT");
    }
  } finally {
    await unlink(/* turbopackIgnore: true */ temporary).catch(() => undefined);
  }
}

export async function deleteLocalQuotationDocument(key: string, root?: string) {
  const target = await readableTarget(key, root);
  await unlink(/* turbopackIgnore: true */ target);
}
