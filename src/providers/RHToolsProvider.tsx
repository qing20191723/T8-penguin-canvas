import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import type {
  AddRHToolPayload,
  RHTool,
  RHToolsBackup,
  RHToolCategory,
} from '../services/api';

interface RHToolsContextType {
  categories: RHToolCategory[];
  tools: RHTool[];
  loading: boolean;
  reload: () => Promise<void>;
  addCategory: (name: string) => Promise<RHToolCategory | null>;
  renameCategory: (id: string, name: string) => Promise<boolean>;
  deleteCategory: (id: string) => Promise<boolean>;
  reorderCategories: (ids: string[]) => Promise<boolean>;
  addTool: (payload: AddRHToolPayload) => Promise<RHTool | null>;
  updateTool: (id: string, payload: Partial<AddRHToolPayload>) => Promise<RHTool | null>;
  deleteTool: (id: string) => Promise<boolean>;
  reorderTools: (ids: string[]) => Promise<boolean>;
  importBackup: (payload: RHToolsBackup, mode?: 'replace' | 'merge') => Promise<boolean>;
}

const RHToolsContext = createContext<RHToolsContextType | null>(null);

/**
 * Legacy RH nodes remain renderable for imported canvases, but this Atlas-only
 * fork must never load or mutate RunningHub application data in the background.
 */
export const RHToolsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const value = useMemo<RHToolsContextType>(() => ({
    categories: [],
    tools: [],
    loading: false,
    reload: async () => undefined,
    addCategory: async () => null,
    renameCategory: async () => false,
    deleteCategory: async () => false,
    reorderCategories: async () => false,
    addTool: async () => null,
    updateTool: async () => null,
    deleteTool: async () => false,
    reorderTools: async () => false,
    importBackup: async () => false,
  }), []);

  return <RHToolsContext.Provider value={value}>{children}</RHToolsContext.Provider>;
};

export const useRHTools = (): RHToolsContextType => {
  const context = useContext(RHToolsContext);
  if (!context) throw new Error('useRHTools must be used within RHToolsProvider');
  return context;
};

export const useRHToolsSafe = (): RHToolsContextType | null => useContext(RHToolsContext);
