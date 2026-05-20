// LLM Service for local API calls
export interface LLMConfig {
  localUrl?: string;
  externalUrl?: string;
  apiKey?: string;
  onFallback?: () => void;
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

function normalizeBrowserLocalHost(url: string): string {
  try {
    const parsed = new URL(url);
    // Browsers cannot use 0.0.0.0 as a destination host; map to loopback.
    if (parsed.hostname === '0.0.0.0') {
      parsed.hostname = '127.0.0.1';
      return parsed.toString();
    }
  } catch (_e) {
    // ignore invalid URLs and let downstream validation handle them
  }
  return url;
}

function normalizeBaseUrl(url: string, providedKey?: string): { base: string, extractedKey?: string, isNativeGemini: boolean } {
  let base = url.trim();

  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    base = 'http://' + base;
  }

  base = normalizeBrowserLocalHost(base);

  let extractedKey;
  let isNativeGemini = false;

  try {
    const parsed = new URL(base);
    if (parsed.searchParams.has('key')) {
      extractedKey = parsed.searchParams.get('key')!;
      if (extractedKey === 'YOUR_API_KEY' && providedKey) {
        extractedKey = providedKey;
      }
      parsed.searchParams.delete('key');
      base = parsed.toString().split('?')[0]; // Strip query
    }
  } catch (e) {
    // ignore
  }

  // If the user pasted a raw Gemini REST API endpoint, use it natively
  if (base.includes('generativelanguage.googleapis.com') && base.includes(':generateContent')) {
    isNativeGemini = true;
    return { base, extractedKey, isNativeGemini };
  }

  // Intercept Google Gemini URLs that don't specify an endpoint and convert to OpenAI compatibility layer
  if (base.includes('generativelanguage.googleapis.com')) {
    return { base: 'https://generativelanguage.googleapis.com/v1beta/openai', extractedKey, isNativeGemini: false };
  }

  if (base.endsWith('/')) {
    base = base.slice(0, -1);
  }

  if (base.endsWith('/chat/completions')) {
    base = base.replace('/chat/completions', '');
  }
  if (base.endsWith('/models')) {
    base = base.replace('/models', '');
  }

  if (!base.endsWith('/v1') && !base.includes('/v1/')) {
    base += '/v1';
  }
  return { base, extractedKey, isNativeGemini: false };
}

function getProviderNameFromUrl(url: string): string {
  if (!url) return 'Unknown Provider';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('google') || lowerUrl.includes('generativelanguage')) return 'Google Gemini';
  if (lowerUrl.includes('openai')) return 'OpenAI';
  if (lowerUrl.includes('anthropic') || lowerUrl.includes('claude')) return 'Anthropic Claude';
  if (lowerUrl.includes('groq')) return 'Groq';
  if (lowerUrl.includes('perplexity')) return 'Perplexity';
  if (lowerUrl.includes('8080')) return 'llama.cpp Server';
  if (lowerUrl.includes('localhost') || lowerUrl.includes('127.0.0.1') || lowerUrl.includes('0.0.0.0')) return 'Local Server';
  return 'External API';
}

export function formatDetailedError(error: any, providerName: string): Error {
  const status = error.status;
  let message = `${providerName} API Error: `;
  let fix = 'Please check your settings and try again.';

  if (status === 401 || status === 403) {
    message += 'Invalid or Missing API Key.';
    fix = 'Please ensure you have entered a valid API Key for this provider.';
  } else if (status === 429) {
    message += 'Rate Limit Exceeded.';
    fix = 'You have hit your API quota or rate limit. Please wait or upgrade your plan.';
  } else if (status >= 500) {
    message += 'Provider Server Error.';
    fix = 'The AI provider is currently experiencing issues. Try again later.';
  } else if (error.message && (error.message.includes('fetch') || error.message.includes('Failed to fetch') || error.message.includes('network'))) {
    message += 'Network Connection Failed.';
    fix = `Make sure your internet connection is active, or if using a local server, ensure it is running at the configured URL.`;
  } else {
    message += error.message || 'Unknown error occurred.';
  }

  const detailedError = new Error(`${message} Recommended Fix: ${fix}`);
  (detailedError as any).details = { message, fix, providerName, status };
  return detailedError;
}

export async function checkConnection(config: LLMConfig): Promise<boolean> {
  try {
    const targetUrl = config.externalUrl || config.localUrl;
    if (!targetUrl) return false;

    const { base, extractedKey, isNativeGemini } = normalizeBaseUrl(targetUrl, config.apiKey);

    let url = `${base}/models`;
    const finalKey = config.apiKey || extractedKey;

    if (isNativeGemini) {
      // For native Gemini, test the models endpoint
      url = `https://generativelanguage.googleapis.com/v1beta/models?key=${finalKey}`;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (finalKey && !isNativeGemini) {
      headers['Authorization'] = `Bearer ${finalKey}`;
    }

    // Using an AbortController for a fast timeout on connection test
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!response.ok) return false;
    return true;
  } catch (error: any) {
    console.error("Connection error:", error);
    if (error.name === 'TypeError' || error.message?.includes('fetch')) {
      console.warn('Network Error: If using a local IP like 192.168.x.x from localhost, Chrome may block it due to Private Network Access. Try using http://localhost:1234 or http://127.0.0.1:1234 instead.');
    }
    return false;
  }
}

export async function generateCompletion(
  config: LLMConfig,
  messages: ChatMessage[],
  temperature = 0.3,
  signal?: AbortSignal
): Promise<string> {

  const callApi = async (url: string, key?: string, isExternal?: boolean) => {
    const { base, extractedKey, isNativeGemini } = normalizeBaseUrl(url, key);
    const finalKey = key || extractedKey;

    if (isNativeGemini) {
      const endpoint = `${base}?key=${finalKey}`;

      // Native Gemini Payload Mapping
      const systemInstruction = messages.find(m => m.role === 'system')?.content;

      const userMessages = messages.filter(m => m.role !== 'system').map(m => {
        let parts: any[] = [];

        if (typeof m.content === 'string') {
          parts = [{ text: m.content }];
        } else {
          parts = m.content.map(part => {
            if (part.type === 'text') return { text: part.text };
            if (part.type === 'image_url' && part.image_url) {
              const b64 = part.image_url.url.split(',')[1];
              const mimeType = part.image_url.url.split(';')[0].split(':')[1];
              return {
                inlineData: {
                  mimeType,
                  data: b64
                }
              };
            }
            return {};
          });
        }

        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts
        };
      });

      const payload: any = {
        contents: userMessages,
        generationConfig: {
          temperature,
          maxOutputTokens: 2000
        }
      };

      if (systemInstruction) {
        if (typeof systemInstruction === 'string') {
          payload.systemInstruction = { parts: [{ text: systemInstruction }] };
        } else {
          payload.systemInstruction = { parts: systemInstruction.map(p => ({ text: p.text })) };
        }
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal
      });

      if (!response.ok) {
        const err = new Error(`LLM API error: ${response.status} ${response.statusText}`);
        (err as any).status = response.status;
        throw err;
      }

      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    }

    // Standard OpenAI Compatible Flow
    let endpoint = base;
    if (!endpoint.endsWith('/chat/completions')) {
      endpoint += '/chat/completions';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (finalKey) {
      headers['Authorization'] = `Bearer ${finalKey}`;
    }

    let model = 'local-model';
    if (isExternal) {
      if (endpoint.includes('gemini') || endpoint.includes('generativelanguage')) model = 'gemini-flash-latest';
      else if (endpoint.includes('openai')) model = 'gpt-3.5-turbo';
      else if (endpoint.includes('groq')) model = 'llama3-8b-8192';
      else if (endpoint.includes('perplexity')) model = 'sonar-small-chat';
    }

    const payload = {
      model,
      messages,
      temperature,
      max_tokens: 2000,
      stream: false
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      const err = new Error(`LLM API error: ${response.status} ${response.statusText}`);
      (err as any).status = response.status;
      throw err;
    }

    const data = await response.json();
    return data.choices[0].message.content;
  };

  // Strict fallback logic
  if (config.externalUrl && config.localUrl) {
    try {
      return await callApi(config.externalUrl, config.apiKey, true);
    } catch (error: any) {
      console.warn("External API failed:", error);

      if (error.name === 'AbortError') {
        throw error;
      }

      // Fallback on timeout, rate limit, or server error
      const isNetworkOrTimeout = error.name === 'TypeError' ||
        error.message?.toLowerCase().includes('fetch') ||
        error.message?.toLowerCase().includes('network') ||
        error.message?.toLowerCase().includes('timeout');

      if (error.status === 429 || error.status >= 500 || isNetworkOrTimeout) {
        if (config.onFallback) config.onFallback();
        try {
          return await callApi(config.localUrl, undefined, false);
        } catch (localError: any) {
          throw formatDetailedError(localError, getProviderNameFromUrl(config.localUrl));
        }
      }
      throw formatDetailedError(error, getProviderNameFromUrl(config.externalUrl));
    }
  } else if (config.externalUrl) {
    // Only External configured
    try {
      return await callApi(config.externalUrl, config.apiKey, true);
    } catch (error: any) {
      throw formatDetailedError(error, getProviderNameFromUrl(config.externalUrl));
    }
  } else if (config.localUrl) {
    // Only Local configured
    try {
      return await callApi(config.localUrl, config.apiKey, false);
    } catch (error: any) {
      throw formatDetailedError(error, getProviderNameFromUrl(config.localUrl));
    }
  }

  throw new Error("No AI providers configured. Please set up a Local Server or External API.");
}
