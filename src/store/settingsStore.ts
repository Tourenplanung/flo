import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Language = 'it' | 'en';

interface SettingsState {
  language: Language;
  setLanguage: (l: Language) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist((set) => ({ language: 'it', setLanguage: (language) => set({ language }) }), {
    name: 'flo-settings',
    version: 1,
  }),
);
