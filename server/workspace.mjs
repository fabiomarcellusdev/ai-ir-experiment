// The workspace: the path checks, the file read with its limits, and the atomic write (decision 0006, "The
// workspace", and its amendment of 2026-11-11). It is the only module of the server that touches files; a test in
// boundaries.test.mjs checks that.
import {
  realpathSync, statSync, lstatSync, openSync, fstatSync, readSync, closeSync, readFileSync, writeFileSync,
  renameSync, rmSync, chmodSync, accessSync, readdirSync, constants,
} from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fail, ToolError } from './errors.mjs';

/** The largest file the server reads or writes: 2 MB (decision 0006, amendment of 2026-11-11). */
export const MAX_BYTES = 2 * 1024 * 1024;

const DEVICES = new Set(['CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$']);
for (const p of ['COM', 'LPT']) for (const d of '0123456789¹²³') DEVICES.add(p + d);

/** The first 16 hex characters of the SHA-256 of the bytes: the file hash of every tool. */
export const hashOf = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** A named error for a file-system error. It names the error code, never a path (security review F6). */
export function fsFail(e, what) {
  if (e instanceof ToolError) throw e;
  fail(`${what} (${e?.code ?? 'error'})`);
}

/** @param {string} root @param {string} p */
function inside(root, p) {
  const rel = path.relative(root, p);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

const isHtmlName = (name) => /\.html?$/i.test(name);

/** Checks the text of a path before it touches the file system. */
function checkText(p) {
  if (typeof p !== 'string' || p === '') fail('the path is empty');
  if (p.includes('\u0000')) fail('the path holds a NUL character');
  if (/^[\\/]{2}/.test(p)) fail('the path is a UNC or device path');
  if (/^[a-zA-Z]:(?![\\/])/.test(p)) fail('the path is drive-relative');
  const rest = /^[a-zA-Z]:[\\/]/.test(p) ? p.slice(2) : p;
  if (rest.includes(':')) fail('the path names an alternate data stream');
  const segments = rest.split(/[\\/]/);
  if (segments.includes('..')) fail('the path holds a ".." segment');
  for (const s of segments) {
    if (DEVICES.has(s.split('.')[0].replace(/ +$/, '').toUpperCase())) fail('the path holds a Windows device name');
  }
  if (!isHtmlName(segments[segments.length - 1])) fail('the path is not an .html or .htm file');
}

/**
 * Opens a workspace at a root folder.
 * @param {string} root
 */
export function openWorkspace(root) {
  let rootReal;
  try {
    rootReal = realpathSync.native(path.resolve(root));
  } catch {
    throw new Error(`the root folder does not exist: ${root}`);
  }
  if (!statSync(rootReal).isDirectory()) throw new Error(`the root is not a folder: ${root}`);
  const rootGiven = path.resolve(root);
  const inRoot = (p) => p === rootReal || inside(rootReal, p);

  /** Resolves a tool's path to the real path of a file inside the root, or throws a named error. */
  function resolve(p) {
    checkText(p);
    const full = path.isAbsolute(p) ? path.resolve(p) : path.resolve(rootReal, p);
    if (!inside(rootReal, full) && !inside(rootGiven, full)) fail('the path is outside the workspace');
    let real;
    try {
      real = realpathSync.native(full);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') fail('the file is not found');
      fsFail(e, 'the file cannot be opened');
    }
    if (!inside(rootReal, real)) fail('the path is outside the workspace');
    if (!isHtmlName(path.basename(real))) fail('the path is not an .html or .htm file');
    return real;
  }

  return {
    root: rootReal,
    /**
     * The name of the one `.html` or `.htm` file in the root folder, for a v2 tool called with no `file` (decision
     * 0008). Only plain files count: a link or a folder does not. With 0 or more than 1, a named error.
     */
    onlyFile() {
      let names;
      try {
        names = readdirSync(rootReal, { withFileTypes: true }).filter((d) => d.isFile() && isHtmlName(d.name)).map((d) => d.name);
      } catch (e) {
        fsFail(e, 'the workspace cannot be listed');
      }
      if (names.length !== 1) fail(`give "file": the workspace holds ${names.length} .html files`);
      return names[0];
    },
    /**
     * Reads a file through one file handle (security review F2): its real path, bytes, text (BOM kept), hash, and
     * identity (device and inode).
     * @param {string} p
     */
    read(p) {
      const real = resolve(p);
      let fd;
      try {
        // O_NONBLOCK: opening a FIFO does not wait for a writer. Windows has no such flag.
        fd = openSync(real, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
      } catch (e) {
        fsFail(e, 'the file cannot be opened');
      }
      try {
        const st = fstatSync(fd, { bigint: true });
        if (!st.isFile()) fail('the path is not a file');
        // realpath does not resolve a hard link, so a second name could lead to any file (security review F1).
        if (st.nlink > 1n) fail('the file has more than one hard link');
        if (st.size > BigInt(MAX_BYTES)) fail('the file is larger than 2 MB');
        const buf = Buffer.alloc(MAX_BYTES + 1);
        let n = 0;
        for (let k; (k = readSync(fd, buf, n, buf.length - n, null)) > 0;) {
          n += k;
          if (n > MAX_BYTES) fail('the file is larger than 2 MB');
        }
        const bytes = Buffer.from(buf.subarray(0, n));
        let text;
        try {
          text = utf8.decode(bytes);
        } catch {
          fail('the file is not valid UTF-8');
        }
        return { real, bytes, text, hash: hashOf(bytes), id: { dev: st.dev, ino: st.ino } };
      } catch (e) {
        fsFail(e, 'the file cannot be read');
      } finally {
        closeSync(fd);
      }
    },
    /**
     * Writes new bytes over a file read before, only when the file is still the same file with the same hash.
     * Returns the new hash.
     * @param {string} real @param {Buffer} bytes @param {string} oldHash @param {{dev: bigint, ino: bigint}} id
     */
    write(real, bytes, oldHash, id) {
      if (!inside(rootReal, real)) fail('the path is outside the workspace');
      if (bytes.length > MAX_BYTES) fail('the result is larger than 2 MB');
      const dir = path.dirname(real);
      let st;
      try {
        // The folder must still be itself, inside the root: no link swapped in since the read (security review F2).
        if (realpathSync.native(dir) !== dir || !inRoot(dir)) fail('the path is outside the workspace');
        st = lstatSync(real, { bigint: true });
      } catch (e) {
        if (e.code === 'ENOENT') fail('the file changed since the hash');
        fsFail(e, 'the file cannot be written');
      }
      if (!st.isFile() || st.dev !== id?.dev || st.ino !== id?.ino) fail('the file changed since the hash');
      try {
        accessSync(real, constants.W_OK);
      } catch {
        fail('the file is read-only');
      }
      const tmp = path.join(dir, `.${path.basename(real)}.${randomBytes(6).toString('hex')}.tmp`);
      try {
        writeFileSync(tmp, bytes, { flag: 'wx' });
        chmodSync(tmp, Number(st.mode & 0o777n)); // Keep the file's permissions (security review F6).
        if (hashOf(readFileSync(real)) !== oldHash) fail('the file changed since the hash');
        renameSync(tmp, real);
      } catch (e) {
        rmSync(tmp, { force: true });
        fsFail(e, 'the file cannot be written');
      }
      return hashOf(bytes);
    },
  };
}
