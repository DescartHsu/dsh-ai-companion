export class OpenAICompatible {
  constructor(config, request = fetch) { this.config = config; this.request = request; }
  async complete(messages, signal) {
    const c = this.config;
    const key = process.env[c.apiKeyEnv];
    if (!key) throw new Error(`Missing environment variable: ${c.apiKeyEnv}`);
    const r = await this.request(`${c.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model: c.model, messages, max_tokens: c.maxTokens, stream: false}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(c.timeoutMs)])
    });
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
    const text = (await r.json()).choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw new Error('Invalid LLM response');
    return text;
  }
}
