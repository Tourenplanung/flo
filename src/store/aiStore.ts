/**
 * AI settings (persisted locally, no secrets: the Claude API key lives only in the local
 * proxy process) and the pending-confirmation state for billable calls.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderId } from '@/core/ai/provider';

export interface AiSettings {
  provider: ProviderId | 'none';
  ollama: { baseUrl: string; model: string };
  claude: { proxyUrl: string; token: string; model: string };
}

export interface CostConfirmation {
  id: number;
  provider: string;
  model: string;
  purpose: string;
  estimatedInputTokens: number;
  estimatedMaxCost: number | null;
  resolve: (ok: boolean) => void;
}

interface AiState extends AiSettings {
  /** Billable calls approved for this browser session (never persisted). */
  sessionApproved: boolean;
  confirmation: CostConfirmation | null;
  panelOpen: boolean;
  settingsOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setProvider: (p: AiSettings['provider']) => void;
  setOllama: (o: Partial<AiSettings['ollama']>) => void;
  setClaude: (c: Partial<AiSettings['claude']>) => void;
  approveSession: (v: boolean) => void;
  setConfirmation: (c: CostConfirmation | null) => void;
}

export const useAiStore = create<AiState>()(
  persist(
    (set) => ({
      provider: 'none',
      ollama: { baseUrl: 'http://localhost:11434', model: '' },
      claude: { proxyUrl: 'http://127.0.0.1:8787', token: '', model: 'claude-opus-5-5' },
      sessionApproved: false,
      confirmation: null,
      panelOpen: false,
      settingsOpen: false,
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setProvider: (provider) => set({ provider }),
      setOllama: (o) => set((s) => ({ ollama: { ...s.ollama, ...o } })),
      setClaude: (c) => set((s) => ({ claude: { ...s.claude, ...c } })),
      approveSession: (sessionApproved) => set({ sessionApproved }),
      setConfirmation: (confirmation) => set({ confirmation }),
    }),
    {
      name: 'flo-ai-settings',
      version: 1,
      partialize: (s) => ({ provider: s.provider, ollama: s.ollama, claude: s.claude }),
    },
  ),
);
