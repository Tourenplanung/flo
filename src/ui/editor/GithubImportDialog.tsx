import { AlertTriangle, CheckCircle2, Github, Loader2, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { filesUnder, GithubClient, parseGithubUrl, type GithubRef, type RepoSnapshot } from '@/core/importers/github';
import type { ComponentInfo, ReactImporter } from '@/core/importers/reactImport';
import { fetchSources, importComponents, type ImportResult } from '@/editor/githubImport';
import { useT } from '@/i18n';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { Checkbox } from '@/ui/common/controls';

/** Dialog state; the token lives only in memory (never persisted). */
export const useGithubImport = create<{ open: boolean; token: string; setOpen: (open: boolean) => void; setToken: (token: string) => void }>()((set) => ({
  open: false,
  token: '',
  setOpen: (open) => set({ open }),
  setToken: (token) => set({ token }),
}));

const inputCls = 'h-8 w-full rounded-md border border-transparent bg-field px-2 text-[12px] text-fg outline-none hover:border-line-strong focus:border-accent';
const btnCls = 'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] disabled:opacity-50';

export function GithubImportDialog() {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const { open, token, setOpen, setToken } = useGithubImport();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState<GithubRef | null>(null);
  const [snap, setSnap] = useState<RepoSnapshot | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [importer, setImporter] = useState<ReactImporter | null>(null);
  const [comps, setComps] = useState<ComponentInfo[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);

  const files = useMemo(() => (snap && ref ? filesUnder(snap, ref) : []), [snap, ref]);
  const shown = useMemo(() => files.filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 300), [files, filter]);
  if (!open) return null;

  const client = () => new GithubClient(undefined, token.trim() || undefined);
  const key = (c: ComponentInfo) => `${c.file}::${c.name}`;

  const load = async () => {
    setError(null);
    setSnap(null);
    setImporter(null);
    setComps([]);
    setResult(null);
    const r = parseGithubUrl(url);
    if (!r) return setError(t('gh.invalidUrl'));
    setBusy(t('gh.loading'));
    try {
      const s = await client().snapshot(r);
      setRef(r);
      setSnap(s);
      const under = filesUnder(s, r);
      setPicked(new Set(r.kind === 'file' ? under.map((f) => f.path) : under.filter((f) => /\.(tsx|jsx)$/.test(f.path)).slice(0, 1).map((f) => f.path)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    if (!snap) return;
    setError(null);
    setResult(null);
    try {
      const sources = await fetchSources(client(), snap, [...picked], (path) => setBusy(t('gh.analyzing', { path })));
      // The parser is loaded on demand (keeps it out of the main bundle).
      const { ReactImporter } = await import('@/core/importers/reactImport');
      const imp = new ReactImporter(sources, { lang });
      // Only components defined in the files the user picked (dependencies are resolved silently).
      const list = imp.components().filter((c) => picked.has(c.file));
      setImporter(imp);
      setComps(list);
      setChosen(new Set(list.filter((c) => c.exported).map(key)));
      if (imp.errors.length) setError(imp.errors.join('\n'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doImport = () => {
    if (!importer || !snap) return;
    const res = importComponents(
      importer,
      comps.filter((c) => chosen.has(key(c))),
      snap,
      lang,
    );
    if ('error' in res) setError(res.error);
    else setResult(res);
  };

  const close = () => setOpen(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onPointerDown={close}>
      <div
        role="dialog"
        aria-label={t('gh.title')}
        data-testid="gh-dialog"
        className="flex max-h-[86vh] w-[560px] flex-col rounded-xl border border-line-strong bg-elevated shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold">
            <Github size={16} /> {t('gh.title')}
          </h2>
          <button aria-label="Close" className="text-fg-muted hover:text-fg" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <p className="flex gap-2 rounded-md bg-field/60 p-2 text-[11px] leading-4 text-fg-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
            {t('gh.safety')}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-muted">{t('gh.url')}</span>
            <div className="flex gap-2">
              <input
                data-testid="gh-url"
                className={inputCls}
                value={url}
                placeholder="https://github.com/shadcn-ui/ui/blob/main/apps/www/registry/default/ui/button.tsx"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void load()}
              />
              <button data-testid="gh-load" disabled={!!busy || !url.trim()} onClick={() => void load()} className={`${btnCls} shrink-0 bg-field text-fg hover:bg-field-hover`}>
                {t('gh.load')}
              </button>
            </div>
          </label>
          <details className="text-[11px] text-fg-muted">
            <summary className="cursor-pointer select-none">{t('gh.token')}</summary>
            <div className="mt-2 flex flex-col gap-1">
              <input data-testid="gh-token" type="password" autoComplete="off" className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} />
              <span className="text-fg-subtle">{t('gh.tokenHelp')}</span>
            </div>
          </details>

          {busy && (
            <p className="flex items-center gap-2 text-[11px] text-fg-muted" data-testid="gh-busy">
              <Loader2 size={13} className="animate-spin" /> {busy}
            </p>
          )}
          {error && (
            <p data-testid="gh-error" className="whitespace-pre-wrap rounded-md bg-[#3a1d22] p-2 text-[11px] text-[#ffb3bb]">
              {error}
            </p>
          )}

          {snap && !result && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-semibold">
                  {snap.owner}/{snap.repo}
                </span>
                <span className="text-fg-subtle">
                  @{snap.ref} · {snap.sha.slice(0, 7)}
                </span>
                {snap.isPrivate && <span className="rounded bg-field px-1.5 text-fg-muted">{t('gh.private')}</span>}
                {snap.license ? (
                  <span data-testid="gh-license" className="rounded bg-field px-1.5 text-fg-muted">
                    {t('gh.license', { license: snap.license })}
                  </span>
                ) : (
                  <span data-testid="gh-license" className="flex items-center gap-1 text-[#ffcc66]">
                    <AlertTriangle size={12} /> {t('gh.noLicense')}
                  </span>
                )}
              </div>
              {!comps.length && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold">{t('gh.files', { n: files.length })}</span>
                    {files.length > 8 && <input className={`${inputCls} h-7 w-48`} placeholder={t('gh.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />}
                  </div>
                  <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-line p-1.5">
                    {shown.map((f) => (
                      <Checkbox
                        key={f.path}
                        testId={`gh-file-${f.path}`}
                        label={ref?.path && ref.kind !== 'file' ? f.path.slice(ref.path.length + 1) : f.path}
                        checked={picked.has(f.path)}
                        onChange={(v) => {
                          const next = new Set(picked);
                          if (v) next.add(f.path);
                          else next.delete(f.path);
                          setPicked(next);
                        }}
                      />
                    ))}
                  </div>
                  <button data-testid="gh-analyze" disabled={!!busy || !picked.size} onClick={() => void analyze()} className={`${btnCls} self-start bg-field text-fg hover:bg-field-hover`}>
                    {t('gh.analyze')}
                  </button>
                </>
              )}
              {importer && (
                <>
                  <span className="text-[11px] font-semibold">{t('gh.components')}</span>
                  {comps.length ? (
                    <div className="flex flex-col gap-1 rounded-md border border-line p-1.5">
                      {comps.map((c) => (
                        <div key={key(c)} className="flex items-center justify-between gap-2">
                          <Checkbox
                            testId={`gh-comp-${c.name}`}
                            label={c.name}
                            checked={chosen.has(key(c))}
                            onChange={(v) => {
                              const next = new Set(chosen);
                              if (v) next.add(key(c));
                              else next.delete(key(c));
                              setChosen(next);
                            }}
                          />
                          <span className="truncate text-[10.5px] text-fg-subtle">
                            {c.variantValues?.length ? `${t('gh.variants', { n: c.variantValues.length })} · ` : ''}
                            {!c.exported && `${t('gh.notExported')} · `}
                            {c.file.split('/').pop()}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-fg-subtle">{t('gh.noComponents')}</p>
                  )}
                  <p className="text-[10.5px] leading-4 text-fg-subtle">{t('gh.licenseNote')}</p>
                  <button data-testid="gh-import" disabled={!chosen.size} onClick={doImport} className={`${btnCls} self-start bg-accent-strong text-white hover:brightness-110`}>
                    {t('gh.import', { n: chosen.size })}
                  </button>
                </>
              )}
            </>
          )}

          {result && (
            <div data-testid="gh-result" className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-[12px] text-success">
                <CheckCircle2 size={14} /> {t('gh.done', { n: result.count })}
              </p>
              {result.warnings.length > 0 && (
                <div>
                  <span className="text-[11px] font-semibold">{t('gh.warnings')}</span>
                  <ul className="mt-1 list-disc pl-4 text-[11px] leading-4 text-fg-muted">
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.unknownClasses.length > 0 && (
                <div>
                  <span className="text-[11px] font-semibold">{t('gh.unknown')}</span>
                  <p className="mt-1 break-words font-mono text-[10.5px] text-fg-subtle">{result.unknownClasses.join(' ')}</p>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  data-testid="gh-goto"
                  onClick={() => {
                    useEditorStore.getState().setPage(result.pageId);
                    close();
                  }}
                  className={`${btnCls} bg-accent-strong text-white hover:brightness-110`}
                >
                  {t('gh.goto')}
                </button>
                <button onClick={close} className={`${btnCls} bg-field text-fg hover:bg-field-hover`}>
                  OK
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
