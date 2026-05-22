import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AgentLog {
  id: string;
  agent: 'System' | 'Researcher' | 'Strategist' | 'Drafter' | 'QA Reviewer' | 'Local Verifier';
  message: string;
  timestamp: number;
  status?: 'info' | 'success' | 'warning' | 'error' | 'thinking';
}

interface SwarmState {
  swarmEnabled: boolean;
  agentLogs: AgentLog[];
  learningMemory: string[]; // Persisted continuous learning rules

  // Actions
  setSwarmEnabled: (enabled: boolean) => void;
  addLog: (agent: AgentLog['agent'], message: string, status?: AgentLog['status']) => void;
  clearLogs: () => void;
  addLearningRule: (rule: string) => void;
  clearLearningMemory: () => void;
}

export const useSwarmStore = create<SwarmState>()(
  persist(
    (set) => ({
      swarmEnabled: false,
      agentLogs: [],
      learningMemory: [], // E.g., "Always use Oxford commas"

      setSwarmEnabled: (enabled) => set({ swarmEnabled: enabled }),
      
      addLog: (agent, message, status = 'info') => set((state) => ({
        agentLogs: [
          ...state.agentLogs,
          {
            id: Math.random().toString(36).substring(7),
            agent,
            message,
            timestamp: Date.now(),
            status
          }
        ]
      })),

      clearLogs: () => set({ agentLogs: [] }),

      addLearningRule: (rule) => set((state) => ({
        // Ensure no exact duplicates
        learningMemory: state.learningMemory.includes(rule) 
          ? state.learningMemory 
          : [...state.learningMemory, rule]
      })),

      clearLearningMemory: () => set({ learningMemory: [] }),
    }),
    {
      name: 'docforge-swarm-memory', // LocalStorage key
      partialize: (state) => ({ learningMemory: state.learningMemory }), // Only persist learningMemory
    }
  )
);
