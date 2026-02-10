/**
 * Dynamic SDK Loader
 *
 * Lazily loads provider SDKs only when the corresponding env var is set.
 * This is a performance optimization — avoids loading unused SDKs.
 */

// Cached SDK references
let _OpenAI: any = null;
let _Anthropic: any = null;
let _Groq: any = null;
let _GoogleGenerativeAI: any = null;

export async function loadOpenAISDK(): Promise<any> {
  if (_OpenAI) return _OpenAI;
  try {
    const mod = await import('openai');
    _OpenAI = mod.default || mod.OpenAI;
    return _OpenAI;
  } catch (e: any) {
    console.warn('[llm] OpenAI SDK not available:', e.message);
    return null;
  }
}

export async function loadAnthropicSDK(): Promise<any> {
  if (_Anthropic) return _Anthropic;
  try {
    const mod = await import('@anthropic-ai/sdk');
    _Anthropic = mod.default || mod.Anthropic;
    return _Anthropic;
  } catch (e: any) {
    console.warn('[llm] Anthropic SDK not available:', e.message);
    return null;
  }
}

export async function loadGroqSDK(): Promise<any> {
  if (_Groq) return _Groq;
  try {
    const mod = await import('groq-sdk');
    _Groq = mod.default || mod.Groq;
    return _Groq;
  } catch (e: any) {
    console.warn('[llm] Groq SDK not available:', e.message);
    return null;
  }
}

export async function loadGeminiSDK(): Promise<any> {
  if (_GoogleGenerativeAI) return _GoogleGenerativeAI;
  try {
    const mod = await import('@google/generative-ai');
    _GoogleGenerativeAI = mod.GoogleGenerativeAI;
    return _GoogleGenerativeAI;
  } catch (e: any) {
    console.warn('[llm] Gemini SDK not available:', e.message);
    return null;
  }
}

/**
 * Load all SDKs that have corresponding env vars set.
 * Returns a map of which SDKs loaded successfully.
 */
export async function loadAllSDKs(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  // Only load if env var suggests the SDK is needed
  if (process.env.GROQ_API_KEY || process.env.GROK_API_KEY) {
    results.groq = !!(await loadGroqSDK());
  }
  if (process.env.ANTHROPIC_API_KEY) {
    results.anthropic = !!(await loadAnthropicSDK());
  }
  if (process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN) {
    results.openai = !!(await loadOpenAISDK());
  }
  if (process.env.GOOGLE_API_KEY) {
    results.gemini = !!(await loadGeminiSDK());
  }

  // OpenAI SDK is also needed for DMR and Ollama (OpenAI-compatible)
  if (!results.openai && (process.env.DMR_PORT || process.env.OLLAMA_BASE_URL)) {
    results.openai = !!(await loadOpenAISDK());
  }

  return results;
}
