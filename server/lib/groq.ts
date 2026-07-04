import 'dotenv/config';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Primary model (higher quality) and a smaller, higher-rate-limit fallback.
const PRIMARY_MODEL = 'openai/gpt-oss-120b';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';

export interface GroqRequest {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;        // per-attempt timeout (default 10s)
  retriesPerModel?: number;  // attempts per model before switching (default 3)
  label?: string;            // log prefix
}

export interface GroqResult {
  content: string;
  model: string;
  finishReason?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isGroqConfigured(): boolean {
  const key = process.env.GROQ_API_KEY;
  return !!key && key.length > 10;
}

/**
 * Resilient Groq chat completion:
 *  1. Retries the primary model up to `retriesPerModel` times on 429 / timeout
 *     (respecting the Retry-After header when present).
 *  2. Falls back to a smaller, higher-rate-limit model and retries again.
 *  3. Throws if every model/attempt fails — the caller should then use its own
 *     rule-based fallback.
 */
export async function groqChatCompletion(req: GroqRequest): Promise<GroqResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.length <= 10) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  const retries = req.retriesPerModel ?? 3;
  const timeoutMs = req.timeoutMs ?? 10000;
  const label = req.label ?? 'Groq';
  let lastError: Error = new Error('Groq call failed');

  for (const model of models) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: req.messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? 2000,
          }),
        });
        clearTimeout(timeoutId);

        if (resp.ok) {
          const data: any = await resp.json();
          const content = data?.choices?.[0]?.message?.content;
          if (content) {
            console.log(`[${label}] Groq success on ${model} (attempt ${attempt})`);
            return { content, model: data.model || model, finishReason: data?.choices?.[0]?.finish_reason };
          }
          lastError = new Error('Groq returned empty content');
          break; // empty content -> try next model
        }

        if (resp.status === 429) {
          const retryAfter = Number(resp.headers.get('retry-after'));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 6000)
            : Math.min(800 * attempt, 4000);
          lastError = new Error(`Groq 429 on ${model}`);
          console.log(`[${label}] 429 on ${model}, attempt ${attempt}/${retries}, waiting ${waitMs}ms`);
          if (attempt < retries) {
            await sleep(waitMs);
            continue;
          }
          break; // retries exhausted on this model -> next model
        }

        const errText = await resp.text();
        lastError = new Error(`Groq error ${resp.status}: ${errText}`);
        console.error(`[${label}] Groq error ${resp.status} on ${model}: ${errText}`);
        break; // non-retryable HTTP error -> next model
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err?.name === 'AbortError') {
          console.log(`[${label}] timeout on ${model} (attempt ${attempt})`);
          if (attempt < retries) continue; // transient -> retry
          break;
        }
        console.error(`[${label}] Groq call failed on ${model}:`, lastError.message);
        break; // network error -> next model
      }
    }
  }

  throw lastError;
}

/** Strips markdown code fences and parses JSON out of a Groq text response. */
export function parseGroqJson(content: string): any {
  let clean = content.trim();
  if (clean.startsWith('```json')) clean = clean.slice(7);
  if (clean.startsWith('```')) clean = clean.slice(3);
  if (clean.endsWith('```')) clean = clean.slice(0, -3);
  return JSON.parse(clean.trim());
}
