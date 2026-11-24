import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const KEEP_PER_SOURCE = 500;

export async function loadState(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { sources: {} };
    throw err;
  }
}

export async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + '\n');
}

export function sourceState(state, name) {
  state.sources ??= {};
  return (state.sources[name] ??= { initialized: false, seen: [] });
}

export function markSeen(src, id) {
  if (src.seen.includes(id)) return;
  src.seen.push(id);
  if (src.seen.length > KEEP_PER_SOURCE) src.seen.splice(0, src.seen.length - KEEP_PER_SOURCE);
}
