LLM provider — Step 1 / 5

Pick the LLM elanous uses for chat / agent loops. Each provider needs
something different:

  · OpenAI Codex — sign in via ChatGPT OAuth (browser device-code
                   flow) OR paste an OpenAI API key. The model
                   list in the next step is the current one.
  · Local        — Ollama / LM Studio / MLX / Docker on this
                   machine or another Tailscale node. We auto-probe
                   and let you pick.
  · Grok         — paste an xAI API key (https://console.x.ai)
  · OpenAI       — paste an OpenAI key (sk-...)
  · Anthropic    — paste an Anthropic key (sk-ant-...)
  · Gemini       — paste a Google AI Studio key
  · Auto-detect  — leave the choice to the runtime; pick from the
                   first env var it finds at boot.

Cost-conscious: Local is free (your hardware), then Grok / Gemini
free tiers, then OpenAI / Anthropic pay-per-token. elanous doesn't
pin you to one provider — you can switch any time via
`elanous setup llm`.
