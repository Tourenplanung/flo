import { useCallback } from 'react';
import { useSettingsStore, type Language } from '@/store/settingsStore';
import { en } from './en';
import { it, type MessageKey } from './it';

const dictionaries: Record<Language, Record<MessageKey, string>> = { it, en };

export type { MessageKey };

export function translate(lang: Language, key: MessageKey, vars?: Record<string, string | number>): string {
  let s: string = dictionaries[lang][key] ?? it[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function useT() {
  const lang = useSettingsStore((s) => s.language);
  return useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}

export function t(key: MessageKey, vars?: Record<string, string | number>) {
  return translate(useSettingsStore.getState().language, key, vars);
}
