import { create } from 'zustand';

interface AppState {
  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;

  // Connection State
  selectedProvider: string;
  primaryUrl: string;
  fallbackUrl: string;
  apiKey: string;
  connectionStatus: 'disconnected' | 'connected' | 'error';
  connectionMessage: string;
  setSelectedProvider: (provider: string) => void;
  setPrimaryUrl: (url: string) => void;
  setFallbackUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  setConnectionStatus: (status: 'disconnected' | 'connected' | 'error') => void;
  setConnectionMessage: (msg: string) => void;

  // Form State
  projectName: string;
  files: File[];
  outputType: string;
  baseTemplate: string;
  templateFile: File | null;
  processingMode: 'bulk' | 'semantic';
  creatorName: string;
  setProjectName: (name: string) => void;
  setFiles: (files: File[]) => void;
  setOutputType: (type: string) => void;
  setBaseTemplate: (template: string) => void;
  setTemplateFile: (file: File | null) => void;
  setProcessingMode: (mode: 'bulk' | 'semantic') => void;
  setCreatorName: (name: string) => void;

  // Web Research State
  enableWebResearch: boolean;
  searchProvider: string;
  searchApiKey: string;
  searchServerUrl: string;
  fetchImages: boolean;
  fetchInfographics: boolean;
  
  setEnableWebResearch: (val: boolean) => void;
  setSearchProvider: (provider: string) => void;
  setSearchApiKey: (key: string) => void;
  setSearchServerUrl: (url: string) => void;
  setFetchImages: (val: boolean) => void;
  setFetchInfographics: (val: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),

  selectedProvider: 'Local Server',
  primaryUrl: 'http://localhost:1234/v1',
  fallbackUrl: '',
  apiKey: '',
  connectionStatus: 'disconnected',
  connectionMessage: 'Offline',
  setSelectedProvider: (provider) => set({ selectedProvider: provider }),
  setPrimaryUrl: (url) => set({ primaryUrl: url }),
  setFallbackUrl: (url) => set({ fallbackUrl: url }),
  setApiKey: (key) => set({ apiKey: key }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setConnectionMessage: (msg) => set({ connectionMessage: msg }),

  projectName: '',
  files: [],
  outputType: 'BRD',
  baseTemplate: 'default',
  templateFile: null,
  processingMode: 'semantic',
  creatorName: 'John Doe',
  setProjectName: (name) => set({ projectName: name }),
  setFiles: (files) => set({ files }),
  setOutputType: (type) => set({ outputType: type }),
  setBaseTemplate: (template) => set({ baseTemplate: template }),
  setTemplateFile: (file) => set({ templateFile: file }),
  setProcessingMode: (mode) => set({ processingMode: mode }),
  setCreatorName: (name) => set({ creatorName: name }),

  enableWebResearch: false,
  searchProvider: 'Local MCP Server',
  searchApiKey: '',
  searchServerUrl: 'http://localhost:3000',
  fetchImages: true,
  fetchInfographics: true,
  
  setEnableWebResearch: (val) => set({ enableWebResearch: val }),
  setSearchProvider: (provider) => set({ searchProvider: provider }),
  setSearchApiKey: (key) => set({ searchApiKey: key }),
  setSearchServerUrl: (url) => set({ searchServerUrl: url }),
  setFetchImages: (val) => set({ fetchImages: val }),
  setFetchInfographics: (val) => set({ fetchInfographics: val }),
}));
