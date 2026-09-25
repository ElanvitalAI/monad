# Model providers

monad can use several model providers. Pick one as the default with `monad config set llm.provider <id>`; you can still choose a different one per run or per role.

| Provider | How you pay | What you need | Set up |
|---|---|---|---|
| `openai-codex` | ChatGPT subscription | a ChatGPT plan | `monad login openai-codex` |
| `grok` | xAI subscription or API credit | `XAI_API_KEY` or a signed-in `grok` CLI | put the key in `~/.cache/xai_api_key` |
| `openrouter` | prepaid credit | `OPENROUTER_API_KEY` | put the key in `~/.cache/openrouter_api_key` |
| `anthropic` | API credit | `ANTHROPIC_API_KEY` | put the key in `~/.cache/anthropic_api_key` |
| `gemini` | API credit | `GEMINI_API_KEY` | put the key in `~/.cache/gemini_api_key` |
| `local` | free | an OpenAI-compatible local server | `monad local setup` |

`monad doctor` shows which of these resolve on your machine. `monad usage` shows what is left on each account.

## What `auto` does

With `llm.provider` left on `auto` (the default), monad uses a ChatGPT sign-in first. When one ChatGPT account runs low, it moves to another signed-in account; when none is left, it follows `llm.fallbackChain` (default: Codex accounts, then Grok), and after that any other provider that has a key. Set `llm.fallbackChain` to `["codex-rotate"]` if you never want it to move to Grok.

## Kimi, GLM and Qwen through OpenRouter

One OpenRouter key gives access to many vendors' models. Model ids look like `openrouter/<vendor>/<model>`.

```bash
monad registry discover --source openrouter            # preview the model list (no key needed)
monad registry discover --source openrouter --write    # add it to your local catalog
```

Use it for the part of a run that writes code, and keep your default for the rest:

```bash
monad harness say --child-llm-provider openrouter --child-llm-model openrouter/moonshotai/kimi-k3 "<sentence>"
```

Or make it the default: `monad config set llm.provider openrouter`.

## Choosing a model by role

`monad harness plan --role-llm <role>=<provider>[/<tier>] "<sentence>"` picks a model for one role in one run; the `roleLlm` setting makes it permanent. Tiers are `budget`, `balanced`, `better`, `best`, `loaded`; `monad tier` shows the model behind each.

## Did it actually use the model I chose?

Check after a run instead of assuming:

```bash
monad logs --since 1h --grep <model id>
```
