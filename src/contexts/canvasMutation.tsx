import { createContext, useContext } from 'react';
import type { MutationProvenance } from '../utils/runInputMutation';

export interface CanvasMutationDispatcher {
  updateNodeData: (nodeId: string, patch: Record<string, unknown>, provenance: MutationProvenance) => boolean;
}

export const CanvasMutationContext = createContext<CanvasMutationDispatcher | null>(null);

export function useCanvasMutationDispatcher() {
  return useContext(CanvasMutationContext);
}
