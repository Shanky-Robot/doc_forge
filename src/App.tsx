import { useState, useEffect, useRef } from 'react';
import { Moon, Sun, Settings2, FileText, UploadCloud, CheckCircle2, FileUp, X, StopCircle, Download } from 'lucide-react';
import { checkConnection } from './lib/llm';
import { runPreProcessing, runFinalGeneration, generateDocx, generatePdf, generatePptx, type GeneratedData, type GenerationResult } from './lib/processor';
import { useAppStore } from './store/useAppStore';
import './index.css';

const AI_PROVIDERS = [
  { name: 'Local Server', url: 'http://localhost:1234/v1' },
  { name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { name: 'Anthropic Claude', url: 'https://api.anthropic.com/v1' },
  { name: 'Perplexity', url: 'https://api.perplexity.ai' },
];

function App() {
  const {
    theme, setTheme,
    selectedProvider, setSelectedProvider,
    primaryUrl, setPrimaryUrl,
    fallbackUrl, setFallbackUrl,
    apiKey, setApiKey,
    connectionStatus, setConnectionStatus,
    connectionMessage, setConnectionMessage,
    projectName, setProjectName,
    files, setFiles,
    outputType, setOutputType,
    baseTemplate, setBaseTemplate,
    templateFile, setTemplateFile,
    processingMode, setProcessingMode,
    creatorName, setCreatorName
  } = useAppStore();

  const [showConnection, setShowConnection] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [needsReanalysis, setNeedsReanalysis] = useState(false);

  // HITL State
  const [autoApprove, setAutoApprove] = useState(true);
  const [compiledContext, setCompiledContext] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Process State
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(isProcessing);

  // Timer State
  const [activeTime, setActiveTime] = useState(0);
  const [preProcessTime, setPreProcessTime] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const formatTime = (seconds: number) => new Date(seconds * 1000).toISOString().substring(14, 19);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    if (isProcessing && !isPaused) {
      timerRef.current = setInterval(() => {
        setActiveTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isProcessing, isPaused]);

  useEffect(() => {
    if (isProcessingRef.current && abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsProcessing(false);
      setProgress(0);
      showToast('⚠️ Inputs modified during generation. Processing aborted. Please re-analyze and process.');
    } else if (generatedData) {
      setNeedsReanalysis(true);
    }
  }, [outputType, files, templateFile, processingMode, projectName, creatorName]);

  // Process State
  // Process variables
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Idle');
  const [errorText, setErrorText] = useState<string | null>(null);

  // Output State
  const [outputFormat, setOutputFormat] = useState<'docx' | 'pdf' | 'pptx'>('docx');
  const [applyPolish, setApplyPolish] = useState(false);
  const [generatedData, setGeneratedData] = useState<GeneratedData | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Theme toggle
  useEffect(() => {
    document.documentElement.className = theme;
  }, [theme]);

  // Output format handling
  useEffect(() => {
    if (!isProcessingRef.current) {
      if (outputType === 'PRESENTATION' && outputFormat !== 'pptx' && outputFormat !== 'pdf') {
        setOutputFormat('pptx');
      } else if (outputType !== 'PRESENTATION' && outputFormat === 'pptx') {
        setOutputFormat('docx');
      }
    }
  }, [outputType]);

  // Compatibility: migrate legacy llama.cpp provider selection to Local Server.
  useEffect(() => {
    if (selectedProvider === 'llama.cpp Server') {
      setSelectedProvider('Local Server');
    }
  }, [selectedProvider, setSelectedProvider]);

  const handleThemeToggle = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const getProviderName = () => {
    return selectedProvider;
  };

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pName = e.target.value;
    setSelectedProvider(pName);
    setConnectionStatus('disconnected');
    setConnectionMessage('Offline');
    const provider = AI_PROVIDERS.find(p => p.name === pName);
    if (provider) {
      setPrimaryUrl(provider.url);
    }
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleTestConnection = async () => {
    if (selectedProvider !== 'Local Server' && !apiKey.trim()) {
      setConnectionStatus('error');
      setConnectionMessage('API Key required');
      showToast('API Key is required for external providers');
      return;
    }
    setConnectionStatus('disconnected');
    setConnectionMessage('Testing...');
    try {
      const isLocal = selectedProvider === 'Local Server';

      if (!isLocal && fallbackUrl) {
        const extValid = await checkConnection({ externalUrl: primaryUrl, apiKey }).catch(() => false);
        const locValid = await checkConnection({ localUrl: fallbackUrl }).catch(() => false);

        if (extValid && locValid) {
          setConnectionStatus('connected');
          setConnectionMessage('Connected (External + Fallback Ready)');
        } else if (!extValid && locValid) {
          setConnectionStatus('connected');
          setConnectionMessage('Connected (Local Only)');
        } else {
          setConnectionStatus('error');
          setConnectionMessage('Error (Both failed)');
        }
      } else {
        const isValid = await checkConnection({
          localUrl: isLocal ? primaryUrl : fallbackUrl,
          externalUrl: !isLocal ? primaryUrl : '',
          apiKey
        });
        if (isValid) {
          setConnectionStatus('connected');
          setConnectionMessage(`Connected to ${getProviderName()}`);
        } else {
          setConnectionStatus('error');
          setConnectionMessage('Connection Error');
        }
      }
    } catch (e) {
      setConnectionStatus('error');
      setConnectionMessage('Connection Error');
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const newFiles = Array.from(e.dataTransfer.files);
      setFiles([...files, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const triggerDownload = async (data: GeneratedData, format: 'docx' | 'pdf' | 'pptx') => {
    setIsDownloading(true);
    try {
      let blob: Blob;
      if (format === 'docx') {
        blob = await generateDocx(data);
      } else if (format === 'pdf') {
        blob = await generatePdf(data);
      } else {
        blob = await generatePptx(data);
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data.projectName.replace(/\s+/g, '_')}_${data.outputType}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      console.error("Download failed", e);
    }
    setIsDownloading(false);
  };

  const handleProcess = async () => {
    setNeedsReanalysis(false);
    setIsProcessing(true);
    setIsPaused(false);
    setProgress(0);
    setActiveTime(0);
    setPreProcessTime(null);
    setStatusText('Starting Pre-Processing...');
    setErrorText(null);
    setGeneratedData(null);

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const isLocal = selectedProvider === 'Local Server';
    const localUrl = isLocal ? primaryUrl : fallbackUrl;
    const externalUrl = !isLocal ? primaryUrl : '';

    const llmConfig = {
      localUrl,
      externalUrl,
      apiKey,
      onFallback: () => {
        setStatusText('External API limit reached. Falling back to Local LLM...');
        showToast('⚠️ External AI failed. Automatically falling back to Local Server...');
      }
    };

    const onProgress = (p: number, status: string) => {
      setProgress(p);
      setStatusText(status);
    };

    try {
      const context = await runPreProcessing({
        files,
        outputType,
        llmConfig,
        onProgress,
        signal
      });

      setCompiledContext(context);

      if (!autoApprove) {
        setPreProcessTime(activeTime);
        setActiveTime(0);
        setIsPaused(true);
        setIsProcessing(false);
        setStatusText('Paused for review.');
        return;
      }

      await resumeFinalGeneration(context, signal, llmConfig, onProgress);

    } catch (err: any) {
      if (err.name === 'AbortError') {
        setStatusText('Processing Halted by User');
      } else {
        setErrorText(err.message || 'An unknown error occurred.');
      }
      setIsProcessing(false);
    }
  };

  const resumeFinalGeneration = async (
    contextOverride?: string,
    signalOverride?: AbortSignal,
    existingLlmConfig?: any,
    existingOnProgress?: any
  ) => {
    const context = contextOverride || compiledContext;
    if (!context) return;

    setIsPaused(false);
    setIsProcessing(true);

    let signal = signalOverride;
    if (!signal) {
      abortControllerRef.current = new AbortController();
      signal = abortControllerRef.current.signal;
    }

    const isLocal = selectedProvider === 'Local Server';
    const localUrl = isLocal ? primaryUrl : fallbackUrl;
    const externalUrl = !isLocal ? primaryUrl : '';

    const llmConfig = existingLlmConfig || {
      localUrl,
      externalUrl,
      apiKey,
      onFallback: () => {
        setStatusText('External API limit reached. Falling back to Local LLM...');
        showToast('⚠️ External AI failed. Automatically falling back to Local Server...');
      }
    };

    const onProgress = existingOnProgress || ((p: number, status: string) => {
      setProgress(p);
      setStatusText(status);
    });

    try {
      const result: GenerationResult = await runFinalGeneration({
        projectName,
        creatorName,
        compiledContext: context,
        outputType,
        baseTemplate,
        templateFile,
        processingMode,
        llmConfig,
        applyPolish,
        onProgress,
        signal
      });

      if (result.success) {
        setGeneratedData(result.data);
        setStatusText('Done');
      } else if (result.reason === 'aborted') {
        setStatusText('Processing Halted by User');
      } else {
        setErrorText(result.message || 'An unknown error occurred.');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setStatusText('Processing Halted by User');
      } else {
        setErrorText(err.message || 'An unknown error occurred.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsProcessing(false);
      showToast('🛑 Processing Halted by User');
    }
  };

  const handleUploadModifiedContext = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          setCompiledContext(evt.target.result as string);
          showToast('Modified Context Uploaded successfully.');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDownloadContext = () => {
    if (!compiledContext) return;
    const blob = new Blob([compiledContext], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `preprocessed_context_${projectName.replace(/\s+/g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getCurrentStep = () => {
    if (generatedData) return 4;
    if (isProcessing) return 3;
    if (files.length > 0) return 2;
    return 1;
  };
  const currentStep = getCurrentStep();

  const steps = [
    { num: 1, label: 'Upload' },
    { num: 2, label: 'Configure' },
    { num: 3, label: 'Process' },
    { num: 4, label: 'Download' }
  ];

  return (
    <>
      <div className="app-container">
        {/* Header */}
        <header className="app-header">
          <div className="logo-container">
            <div className="logo-icon bg-teal-800 p-2 rounded-md">
              <FileText color="var(--color-primary)" size={32} />
            </div>
            <h1 className="logo-text">DocForge</h1>
            <span className="logo-tagline" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginLeft: '10px' }}>Forge Your Requirements. Ship With Clarity.</span>
          </div>

          <div className="header-actions">
            <div className={`badge ${connectionStatus === 'connected' ? 'badge-success' : connectionStatus === 'error' ? 'badge-error' : 'badge-neutral'} mr-4`}>
              {connectionMessage}
            </div>
            <button className="btn btn-outline" onClick={() => setShowConnection(!showConnection)}>
              <Settings2 size={18} />
              <span>Connection</span>
            </button>
            <button className="btn btn-outline p-2" onClick={handleThemeToggle} aria-label="Toggle Theme">
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </header>

        {/* Toast Notification */}
        {toastMessage && (
          <div className="toast-notification">
            {toastMessage}
          </div>
        )}

        {/* Connection Panel */}
        {showConnection && (
          <div className="card connection-panel">
            <h2 className="card-title">
              <Settings2 size={20} className="icon" />
              LLM Configuration & Fallback
            </h2>
            <div className="connection-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'center' }}>
              <div className="input-group" style={{ minWidth: '200px' }}>
                <label className="input-label">Provider Selection</label>
                <select className="input-field" value={selectedProvider} onChange={handleProviderChange}>
                  {AI_PROVIDERS.map(p => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="input-group" style={{ minWidth: '250px', flex: 1 }}>
                <label className="input-label">Base API URL</label>
                <input
                  type="text"
                  className="input-field"
                  value={primaryUrl}
                  onChange={e => setPrimaryUrl(e.target.value)}
                />
              </div>
              {selectedProvider !== 'Local Server' && (
                <div className="input-group" style={{ minWidth: '250px' }}>
                  <label>External Provider API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                  <small style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                    Your API key is only stored in your browser's active memory and is never saved to our servers.
                  </small>
                </div>
              )}
              {selectedProvider !== 'Local Server' && (
                <div className="input-group" style={{ minWidth: '250px' }}>
                  <label className="input-label">Fallback Local Server URL (Optional)</label>
                  <input
                    type="text"
                    className="input-field"
                    value={fallbackUrl}
                    onChange={e => setFallbackUrl(e.target.value)}
                    placeholder="http://localhost:1234/v1"
                  />
                </div>
              )}
              <button
                className={`btn mb-4 ${connectionStatus === 'connected' ? 'bg-green-600 text-white hover:bg-green-700 border-green-600' : 'btn-outline'}`}
                style={connectionStatus === 'connected' ? { backgroundColor: 'var(--color-success, #10b981)', color: '#fff', borderColor: 'var(--color-success, #10b981)' } : {}}
                onClick={handleTestConnection}
              >
                {connectionStatus === 'connected' ? 'Connected' : 'Connect'}
              </button>
            </div>
            <p className="text-sm text-muted">If both an External AI and Local Fallback are configured, DocForge will prioritize the external provider and automatically fallback to local if limits are reached or an outage occurs.</p>
          </div>
        )}

        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="connection-row" style={{ flexWrap: 'wrap', marginBottom: 0 }}>
            <div className="input-group" style={{ flex: 1, minWidth: '200px' }}>
              <label className="input-label">Project Name</label>
              <input
                type="text"
                className="input-field"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="e.g. Payment Gateway"
              />
            </div>
            <div className="input-group" style={{ flex: 1, minWidth: '200px' }}>
              <label className="input-label">Creator Name</label>
              <input
                type="text"
                className="input-field"
                value={creatorName}
                onChange={e => setCreatorName(e.target.value)}
                placeholder="e.g. John Doe"
              />
            </div>
          </div>
        </div>

        {/* Visual Stepper */}
        <div className="stepper-container">
          {steps.map(step => (
            <div key={step.num} className={`stepper-step ${currentStep > step.num ? 'completed' : currentStep === step.num ? 'active' : ''}`}>
              <div className="stepper-circle">{currentStep > step.num ? '✓' : step.num}</div>
              <div className="stepper-label">{step.label}</div>
            </div>
          ))}
        </div>

        {/* Main Grid: Steps 1, 2, 3 */}
        <div className="main-grid">

          {/* Step 1: Source Files */}
          <div className="card">
            <h2 className="card-title">
              <span className="badge badge-neutral">1</span> Source Files
            </h2>
            <div className="input-group">
              <label>Upload Source Files</label>

              <div
                className="upload-zone"
                onDrop={handleFileDrop}
                onDragOver={(e) => e.preventDefault()}
                style={{ position: 'relative' }}
              >
                <UploadCloud size={32} color="var(--color-primary)" />
                <p>Drag & drop files here, or click to browse</p>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,.docx,.csv,.srt"
                  onChange={(e) => {
                    if (e.target.files) {
                      setFiles([...files, ...Array.from(e.target.files)]);
                    }
                  }}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                />
              </div>

              <div style={{ marginTop: '0.75rem', padding: '0.5rem', backgroundColor: 'var(--color-surface-hover)', borderRadius: '4px', border: '1px dashed var(--color-border)' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 size={14} color="var(--color-success)" />
                  <strong>100% Local-First Privacy:</strong> All file parsing happens locally in your browser. Files are never uploaded to a central server.
                </p>
              </div>
            </div>

            {files.length > 0 && (
              <div className="file-list">
                {files.map((f, i) => (
                  <div key={i} className="file-item">
                    <span>{f.name} <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', marginLeft: '8px' }}>{(f.size / 1024).toFixed(1)} KB</span></span>
                    <button onClick={() => removeFile(i)} className="btn-remove">
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Step 2: Output Type */}
          <div className="card">
            <h2 className="card-title">
              <span className="badge badge-neutral">2</span> Output Type
            </h2>

            <div className="output-options">
              {[
                { id: 'BRD', title: 'Business Requirements (BRD)', desc: 'High-level business needs, executive audience.' },
                { id: 'FRD', title: 'Functional Requirements (FRD)', desc: 'Detailed functional behavior, system requirements.' },
                { id: 'PRD', title: 'Product Requirements (PRD)', desc: 'Product vision, features, and user flow.' },
                { id: 'CRD', title: 'Change Request (CRD)', desc: 'Specific changes, rollback plans, impact analysis.' },
                { id: 'PRESENTATION', title: 'Project Presentation (Pitch Deck)', desc: 'Solutions-provider partnership pitch with layout blueprints, chart mappings, and AI graphic slots.' }
              ].map(type => (
                <label
                  key={type.id}
                  className={`radio-card ${outputType === type.id ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="outputType"
                    value={type.id}
                    checked={outputType === type.id}
                    onChange={() => setOutputType(type.id)}
                  />
                  <div className="radio-card-content">
                    <span className="radio-card-title">{type.title}</span>
                    <span className="radio-card-desc">{type.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Step 3: Template */}
          <div className="card">
            <h2 className="card-title">
              <span className="badge badge-neutral">3</span> Template
            </h2>

            <div className="input-group mb-4">
              <label className="input-label">Select Base Template</label>
              <select className="input-field" value={baseTemplate} onChange={e => setBaseTemplate(e.target.value)}>
                {outputType === 'PRESENTATION' ? (
                  <>
                    <option value="default">Default Presentation Template</option>
                    <option value="enterprise">Enterprise Slide Deck</option>
                  </>
                ) : (
                  <>
                    <option value="default">Default {outputType} Template</option>
                    <option value="enterprise">Enterprise Standard v2</option>
                  </>
                )}
                <option value="custom">Custom Upload...</option>
              </select>
            </div>

            {baseTemplate === 'custom' && (
              templateFile ? (
                <div className="file-item" style={{ marginTop: '1rem' }}>
                  <span>{templateFile.name}</span>
                  <button onClick={() => setTemplateFile(null)} className="btn-remove">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div
                  className="drop-zone"
                  style={{ padding: '1rem', minHeight: '120px' }}
                >
                  <FileUp size={24} className="icon" />
                  <p style={{ fontSize: '0.875rem' }}>Upload Custom {outputType === 'PRESENTATION' ? 'Template (.pptx, .key)' : '.docx Template'}</p>
                  <label className="btn btn-add mt-2" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', cursor: 'pointer' }}>
                    Browse
                    <input
                      type="file"
                      accept={outputType === 'PRESENTATION' ? ".pptx,.key" : ".docx"}
                      hidden
                      onChange={e => {
                        if (e.target.files && e.target.files.length > 0) {
                          setTemplateFile(e.target.files[0]);
                        }
                      }}
                    />
                  </label>
                </div>
              )
            )}
          </div>
        </div>

        {/* Step 4: Process */}
        <div className="card">
          <h2 className="card-title mb-4">
            <span className="badge badge-neutral">4</span> Analyse & Process
          </h2>

          <div className="mb-6">
            <label className="input-label" style={{ display: 'block', marginBottom: '0.75rem' }}>Processing Strategy</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label className={`radio-card ${processingMode === 'semantic' ? 'selected' : ''}`} style={{ marginBottom: 0 }}>
                <input
                  type="radio"
                  name="processingMode"
                  value="semantic"
                  checked={processingMode === 'semantic'}
                  onChange={() => setProcessingMode('semantic')}
                />
                <div className="radio-card-content">
                  <span className="radio-card-title">Section-by-Section (Semantic Injection)</span>
                  <span className="radio-card-desc">Extracts and injects only relevant data per section. Prevents AI hallucination and token limit errors. Best for large projects.</span>
                </div>
              </label>
              <label className={`radio-card ${processingMode === 'bulk' ? 'selected' : ''}`} style={{ marginBottom: 0 }}>
                <input
                  type="radio"
                  name="processingMode"
                  value="bulk"
                  checked={processingMode === 'bulk'}
                  onChange={() => setProcessingMode('bulk')}
                />
                <div className="radio-card-content">
                  <span className="radio-card-title">Comprehensive (Single File)</span>
                  <span className="radio-card-desc">Sends the entire compiled source document at once. Best for short files (&lt; 10 pages). Large files will be blocked to prevent AI memory crashes.</span>
                </div>
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
            <div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Output Format:</span>
                {outputType === 'PRESENTATION' ? (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
                      <input
                        type="radio"
                        name="format"
                        checked={outputFormat === 'pptx'}
                        onChange={() => setOutputFormat('pptx')}
                      /> .pptx
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
                      <input
                        type="radio"
                        name="format"
                        checked={outputFormat === 'pdf'}
                        onChange={() => setOutputFormat('pdf')}
                      /> .pdf
                    </label>
                  </>
                ) : (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
                      <input
                        type="radio"
                        name="format"
                        checked={outputFormat === 'docx'}
                        onChange={() => setOutputFormat('docx')}
                      /> .docx
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
                      <input
                        type="radio"
                        name="format"
                        checked={outputFormat === 'pdf'}
                        onChange={() => setOutputFormat('pdf')}
                      /> .pdf
                    </label>
                  </>
                )}
              </div>

              <div style={{ marginTop: '0.5rem' }} title={isProcessing ? "Once processing starts, this option cannot be changed." : ""}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem', fontWeight: 600, opacity: isProcessing ? 0.5 : 1, cursor: isProcessing ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoApprove}
                    onChange={(e) => setAutoApprove(e.target.checked)}
                    disabled={isProcessing}
                  /> Auto-Approve Pre-Processed Context (Continuous Processing)
                </label>
              </div>

              <div style={{ marginTop: '0.5rem' }} title={isProcessing ? "Once processing starts, this option cannot be changed." : ""}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem', fontWeight: 600, opacity: isProcessing ? 0.5 : 1, cursor: isProcessing ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={applyPolish}
                    onChange={(e) => setApplyPolish(e.target.checked)}
                    disabled={isProcessing}
                  /> Apply Final Editorial Polish (Removes AI filler, tightens requirements, ensures consistency)
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                className={`btn ${needsReanalysis ? 'btn-warning' : 'btn-primary'}`}
                style={needsReanalysis ? { padding: '1rem 2rem', fontSize: '1.1rem', backgroundColor: '#f59e0b', color: '#fff', borderColor: '#f59e0b', flex: 1 } : { padding: '1rem 2rem', fontSize: '1.1rem', flex: 1 }}
                onClick={handleProcess}
                disabled={isProcessing || files.length === 0}
              >
                {isProcessing ? 'Processing...' : needsReanalysis ? 'Re-Analyse & Process ▶' : 'Analyse & Process ▶'}
              </button>
              {isProcessing && (
                <button
                  className="btn btn-outline"
                  style={{ padding: '1rem', borderColor: 'var(--color-error)', color: 'var(--color-error)' }}
                  onClick={handleStop}
                >
                  <StopCircle size={24} /> Stop Processing
                </button>
              )}
            </div>
          </div>

          {isPaused && (
            <div className="card mt-4" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b' }}>
              <h3 style={{ margin: '0 0 1rem 0', color: '#b45309', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Review Pre-Processed Context</span>
                <span style={{ fontSize: '0.9rem', fontWeight: 'normal' }}>
                  ⏱️ Pre-Processing Time: {formatTime(preProcessTime || 0)}
                </span>
              </h3>
              <p style={{ fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--color-text-muted)' }}>
                Auto-approve is OFF. The AI has generated the deep context notes. You can download and review them, modify if necessary, and re-upload before final generation.
              </p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-outline"
                  style={{ backgroundColor: 'var(--color-surface-card)' }}
                  onClick={handleDownloadContext}
                >
                  <Download size={18} /> Download Pre-Processed Context (.md)
                </button>

                <div style={{ position: 'relative' }}>
                  <input
                    type="file"
                    accept=".md,.txt"
                    onChange={handleUploadModifiedContext}
                    style={{ position: 'absolute', opacity: 0, top: 0, left: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                  />
                  <button className="btn btn-outline" style={{ backgroundColor: 'var(--color-surface-card)', pointerEvents: 'none' }}>
                    <FileUp size={18} /> Upload Modified Context (Optional)
                  </button>
                </div>
              </div>

              <div style={{ marginTop: '1.5rem' }}>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => resumeFinalGeneration()}
                >
                  Continue to Final Generation ▶
                </button>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="progress-container">
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
              </div>
              <div className="progress-text">
                <span>{statusText}</span>
                <span>⏱️ {formatTime(activeTime)} &nbsp;&nbsp; {progress}%</span>
              </div>
            </div>
          )}

          {errorText && !isProcessing && (
            <div className="mt-4" style={{ padding: '1rem', backgroundColor: 'rgba(211, 47, 47, 0.1)', borderRadius: 'var(--radius-md)', color: 'var(--color-error)' }}>
              <span style={{ fontWeight: 600 }}>Processing Failed: </span>
              {errorText}
            </div>
          )}

          {needsReanalysis && generatedData && !isProcessing && (
            <div className="mt-4" style={{ padding: '1rem', backgroundColor: 'rgba(37, 99, 235, 0.1)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', color: 'var(--color-primary)' }}>
              <span style={{ fontWeight: 600 }}>Info: </span>
              Changes detected. Re-analyze and process to generate the updated document.
            </div>
          )}

          {generatedData && !isProcessing && !needsReanalysis && (
            <div className="mt-4" style={{ padding: '1rem', backgroundColor: 'rgba(46, 125, 50, 0.1)', borderRadius: 'var(--radius-md)', color: 'var(--color-success)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle2 size={20} />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span>Document successfully generated and downloaded!</span>
                  <span style={{ fontSize: '0.85rem', opacity: 0.9 }}>
                    {preProcessTime !== null
                      ? `Total Time: Phase 1 (${formatTime(preProcessTime)}) + Phase 2 (${formatTime(activeTime)})`
                      : `Total Time: ${formatTime(activeTime)}`}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {outputType === 'PRESENTATION' ? (
                  <button
                    className="btn btn-outline"
                    style={{ backgroundColor: 'var(--color-surface-card)', borderColor: 'var(--color-success)', color: 'var(--color-success)', padding: '0.5rem 1rem' }}
                    onClick={() => triggerDownload(generatedData, 'pptx')}
                    disabled={isDownloading}
                  >
                    {isDownloading ? 'Building...' : `Download PPTX`}
                  </button>
                ) : (
                  <button
                    className="btn btn-outline"
                    style={{ backgroundColor: 'var(--color-surface-card)', borderColor: 'var(--color-success)', color: 'var(--color-success)', padding: '0.5rem 1rem' }}
                    onClick={() => triggerDownload(generatedData, 'docx')}
                    disabled={isDownloading}
                  >
                    {isDownloading ? 'Building...' : `Download DOCX`}
                  </button>
                )}
                <button
                  className="btn btn-outline"
                  style={{ backgroundColor: 'var(--color-surface-card)', borderColor: 'var(--color-success)', color: 'var(--color-success)', padding: '0.5rem 1rem' }}
                  onClick={() => triggerDownload(generatedData, 'pdf')}
                  disabled={isDownloading}
                >
                  {isDownloading ? 'Building...' : `Download PDF`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="app-footer">
        <div style={{ maxWidth: '800px', margin: '0 auto 10px auto', lineHeight: '1.4', textAlign: 'center' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Disclaimer: Documents generated by DocForge are initial drafts designed to accelerate your workflow. They may contain inaccuracies or unresolved placeholders. Please review carefully, resolve any [CLARIFICATION NEEDED] tags, and apply your professional expertise to finalize the document. DocForge is an analyst co-pilot, not a replacement for human judgment and finesse.
          </p>
        </div>
        <div>© 2026 | Designed & Built by Shanky B.</div>
      </footer>
    </>
  );
}

export default App;
