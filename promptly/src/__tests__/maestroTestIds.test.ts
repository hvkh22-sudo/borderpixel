/**
 * Keeps the Maestro flows (.maestro/*.yaml) in sync with the app: every `id:` a flow uses must be
 * a testID declared somewhere in src/**\/*.tsx, and every `runFlow` file must exist.
 * Plain file scan, no YAML parser: flows use one `key: value` per line.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const MAESTRO = path.join(ROOT, '.maestro');
const SRC = path.join(ROOT, 'src');

/** Ids that are not app testIDs: an intentional never-present element used as a pause. */
const NON_APP_IDS = new Set(['maestro-wait-never-present']);

function walk(dir: string, ext: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p, ext);
    return e.name.endsWith(ext) ? [p] : [];
  });
}

function unquote(v: string): string {
  return v.trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
}

/** `id: "(a|b)"` is a regex alternation in Maestro; expand it to its plain ids. */
function expandIds(value: string): string[] {
  const m = /^\(([^()]+)\)$/.exec(value);
  return m ? m[1]!.split('|') : [value];
}

const flowFiles = walk(MAESTRO, '.yaml');

function referencedIds(): { file: string; id: string }[] {
  const out: { file: string; id: string }[] = [];
  for (const file of flowFiles) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*(?:-\s+)?id:\s*(.+)$/.exec(line);
      if (!m) continue;
      for (const id of expandIds(unquote(m[1]!))) {
        // Android system ids (com.android.permissioncontroller:id/...) are not ours.
        if (id.includes(':') || NON_APP_IDS.has(id)) continue;
        out.push({ file: path.relative(ROOT, file), id });
      }
    }
  }
  return out;
}

function declaredTestIds(): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const file of walk(SRC, '.tsx')) {
    const text = fs.readFileSync(file, 'utf8');
    // testID="x" · testID={'x'} · testID: 'x'
    for (const m of text.matchAll(/testID(?:=\{?|:\s*)["']([^"']+)["']/g)) exact.add(m[1]!);
    // testID={`countdown-${n}`} · testID: `countdown-${n}` → prefix "countdown-"
    for (const m of text.matchAll(/testID(?:=\{|:\s*)`([^`$]*)\$\{/g)) prefixes.push(m[1]!);
  }
  return { exact, prefixes };
}

describe('Maestro flows', () => {
  it('finds the flows', () => {
    expect(flowFiles.length).toBeGreaterThanOrEqual(7);
  });

  it('only reference testIDs that exist in src/**/*.tsx', () => {
    const { exact, prefixes } = declaredTestIds();
    const refs = referencedIds();
    expect(refs.length).toBeGreaterThan(20);
    const missing = refs.filter(({ id }) => !exact.has(id) && !prefixes.some((p) => p && id.startsWith(p) && id.length > p.length));
    expect(missing).toEqual([]);
  });

  it('only runFlow files that exist', () => {
    const missing: string[] = [];
    for (const file of flowFiles) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = /^\s*(?:-\s+)?(?:runFlow|file):\s*(\S+\.yaml)\s*$/.exec(line);
        if (m && !fs.existsSync(path.resolve(path.dirname(file), unquote(m[1]!)))) missing.push(`${path.relative(ROOT, file)} → ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
