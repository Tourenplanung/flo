/**
 * Read-only GitHub access for the React importer.
 *
 * - Public repositories work without authentication (GitHub's anonymous rate limit applies).
 * - A personal access token can be supplied for private repositories; it is only kept in memory
 *   by the caller and sent exclusively to api.github.com.
 * - Every response is size-checked and treated as untrusted text: files are parsed, never run.
 */

export interface GithubRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit; undefined = default branch. */
  ref?: string;
  /** Path inside the repository ('' = root). */
  path: string;
  kind: 'repo' | 'file' | 'dir';
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
export const SOURCE_EXT = /\.(tsx|jsx|ts|js)$/;
export const MAX_SOURCE_BYTES = 300_000;
const MAX_TREE_FILES = 3000;

/** Parses github.com / raw.githubusercontent.com URLs and `owner/repo[/path]` shorthands. */
export function parseGithubUrl(input: string): GithubRef | null {
  const s = input.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!s) return null;
  let parts: string[];
  let raw = false;
  const m = /^(?:https?:\/\/)?(github\.com|www\.github\.com|raw\.githubusercontent\.com)\/(.+)$/i.exec(s);
  if (m) {
    raw = m[1]!.toLowerCase() === 'raw.githubusercontent.com';
    parts = m[2]!.split('/');
  } else if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/.*)?$/.test(s) && !s.includes(':')) parts = s.split('/');
  else return null;
  const [owner, repoRaw, ...rest] = parts.map((p) => decodeURIComponent(p));
  const repo = repoRaw?.replace(/\.git$/, '');
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) return null;
  if (rest.some((p) => p === '..' || p === '.')) return null;
  if (raw) {
    const [ref, ...path] = rest;
    if (!ref || !path.length) return null;
    return { owner, repo, ref, path: path.join('/'), kind: 'file' };
  }
  if (!rest.length) return { owner, repo, path: '', kind: 'repo' };
  if ((rest[0] === 'blob' || rest[0] === 'tree') && rest[1]) {
    const path = rest.slice(2).join('/');
    return { owner, repo, ref: rest[1], path, kind: rest[0] === 'blob' ? 'file' : path ? 'dir' : 'repo' };
  }
  // Shorthand owner/repo/path/to/file.tsx
  const path = rest.join('/');
  return { owner, repo, path, kind: SOURCE_EXT.test(path) ? 'file' : 'dir' };
}

export class GithubError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface RepoFile {
  path: string;
  size: number;
}

export interface RepoSnapshot {
  owner: string;
  repo: string;
  /** Resolved commit sha (imports are pinned to it). */
  sha: string;
  ref: string;
  license: string | null;
  isPrivate: boolean;
  files: RepoFile[];
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class GithubClient {
  constructor(
    private fetchImpl: FetchLike = (u, i) => fetch(u, i),
    private token?: string,
  ) {}

  private async api(path: string, accept = 'application/vnd.github+json'): Promise<Response> {
    const headers: Record<string, string> = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.github.com${path}`, { headers, credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch (e) {
      throw new GithubError(`GitHub non raggiungibile: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      if (res.status === 404) throw new GithubError(this.token ? 'Repository o file non trovato.' : 'Repository o file non trovato (se è privato, inserisci un token).', 404);
      if (res.status === 401) throw new GithubError('Token GitHub non valido.', 401);
      if (res.status === 403 || res.status === 429) throw new GithubError('Limite di richieste GitHub raggiunto: riprova più tardi o usa un token.', res.status);
      throw new GithubError(`Errore GitHub ${res.status}`, res.status);
    }
    return res;
  }

  private async json<T>(path: string): Promise<T> {
    const res = await this.api(path);
    const text = await res.text();
    if (text.length > 20_000_000) throw new GithubError('Risposta GitHub troppo grande.');
    return JSON.parse(text) as T;
  }

  /** Resolves the ref to a commit, lists source files under `ref.path` and reads the license. */
  async snapshot(ref: GithubRef): Promise<RepoSnapshot> {
    const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
    const info = await this.json<{ default_branch?: string; private?: boolean }>(base);
    const branch = ref.ref ?? info.default_branch ?? 'main';
    const commit = await this.json<{ sha?: string }>(`${base}/commits/${encodeURIComponent(branch)}`);
    const sha = commit.sha;
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new GithubError('Commit non risolto.');
    const tree = await this.json<{ tree?: { path?: string; type?: string; size?: number }[]; truncated?: boolean }>(`${base}/git/trees/${sha}?recursive=1`);
    const files: RepoFile[] = [];
    for (const e of tree.tree ?? []) {
      if (e.type !== 'blob' || typeof e.path !== 'string' || !SOURCE_EXT.test(e.path) || e.path.endsWith('.d.ts')) continue;
      if (/(^|\/)(node_modules|dist|build|\.next|coverage)\//.test(e.path)) continue;
      files.push({ path: e.path, size: typeof e.size === 'number' ? e.size : 0 });
      if (files.length >= MAX_TREE_FILES) break;
    }
    let license: string | null = null;
    try {
      const l = await this.json<{ license?: { spdx_id?: string; name?: string } }>(`${base}/license`);
      license = l.license?.spdx_id && l.license.spdx_id !== 'NOASSERTION' ? l.license.spdx_id : (l.license?.name ?? null);
    } catch (e) {
      if (!(e instanceof GithubError && e.status === 404)) throw e;
    }
    // `files` keeps the whole tree (needed to resolve imports); `filesUnder` narrows it for the UI.
    return { owner: ref.owner, repo: ref.repo, sha, ref: branch, license, isPrivate: !!info.private, files };
  }

  /** Downloads one file as text at the pinned commit. */
  async readFile(snap: Pick<RepoSnapshot, 'owner' | 'repo' | 'sha'>, path: string): Promise<string> {
    if (path.split('/').some((p) => p === '..')) throw new GithubError('Percorso non valido.');
    const enc = path.split('/').map(encodeURIComponent).join('/');
    const res = await this.api(`/repos/${encodeURIComponent(snap.owner)}/${encodeURIComponent(snap.repo)}/contents/${enc}?ref=${snap.sha}`, 'application/vnd.github.raw+json');
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_SOURCE_BYTES) throw new GithubError(`${path}: file troppo grande.`);
    const text = await res.text();
    if (text.length > MAX_SOURCE_BYTES) throw new GithubError(`${path}: file troppo grande.`);
    return text;
  }
}

/** Files under the requested path (what the user picks from). */
export function filesUnder(snap: RepoSnapshot, ref: GithubRef): RepoFile[] {
  if (ref.kind === 'file') return snap.files.filter((f) => f.path === ref.path);
  const prefix = ref.path ? `${ref.path}/` : '';
  return snap.files.filter((f) => f.path.startsWith(prefix) && !/(\.test|\.spec|\.stories)\.[tj]sx?$/.test(f.path) && !/(^|\/)(__tests__|tests?|e2e|scripts?)\//.test(f.path));
}

/** Local import specifiers of a source file (`./x`, `../x`, `@/x`, `~/x`). */
export function localImports(code: string): string[] {
  const out = new Set<string>();
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const s = m[1]!;
    if (s.startsWith('.') || s.startsWith('@/') || s.startsWith('~/')) out.add(s);
  }
  return [...out];
}

/** Resolves an import specifier against the repository file list. */
export function resolveImport(fromPath: string, spec: string, files: RepoFile[]): string | null {
  const paths = new Set(files.map((f) => f.path));
  const candidates = (base: string) => [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}/index.tsx`, `${base}/index.ts`, `${base}/index.jsx`, `${base}/index.js`];
  if (spec.startsWith('.')) {
    const dir = fromPath.split('/').slice(0, -1);
    for (const seg of spec.split('/')) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') dir.pop();
      else dir.push(seg);
    }
    return candidates(dir.join('/')).find((c) => paths.has(c)) ?? null;
  }
  // Path aliases (`@/components/ui/button`): match by suffix, preferring src/.
  const rest = spec.replace(/^[@~]\//, '');
  for (const root of ['src/', '', 'app/', 'apps/web/src/', 'packages/ui/src/']) {
    const hit = candidates(`${root}${rest}`).find((c) => paths.has(c));
    if (hit) return hit;
  }
  const suffixes = candidates(rest).map((c) => `/${c}`);
  return files.find((f) => suffixes.some((s) => f.path.endsWith(s)))?.path ?? null;
}
