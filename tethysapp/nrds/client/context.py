import urllib.request
import urllib.error
import os

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")

def _get_context_length_from_ps(model_name: str) -> int | None:
    """Returns current context_length for the running model from /api/ps."""
    url = f"{OLLAMA_HOST}/api/ps"
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            payload = json.load(resp)
    except Exception:
        return None

    models = payload.get("models") or []
    if not isinstance(models, list):
        return None

    # match exact first
    for m in models:
        if not isinstance(m, dict):
            continue
        if m.get("name") == model_name or m.get("model") == model_name:
            cl = m.get("context_length")
            return int(cl) if isinstance(cl, (int, float)) else None

    # fallback match by base name (before :)
    base = model_name.split(":", 1)[0]
    for m in models:
        if not isinstance(m, dict):
            continue
        n = str(m.get("name") or "")
        mo = str(m.get("model") or "")
        if n.split(":", 1)[0] == base or mo.split(":", 1)[0] == base:
            cl = m.get("context_length")
            return int(cl) if isinstance(cl, (int, float)) else None

    return None


def _print_context_usage(resp: dict, model_name: str):
    """Print: used/total + left after each Ollama response."""
    prompt_tokens = resp.get("prompt_eval_count")
    out_tokens = resp.get("eval_count")

    # These fields are present on non-streaming /api/chat responses
    prompt_tokens = int(prompt_tokens) if isinstance(prompt_tokens, (int, float)) else None
    out_tokens = int(out_tokens) if isinstance(out_tokens, (int, float)) else 0

    total_ctx = _get_context_length_from_ps(model_name)

    if total_ctx and prompt_tokens is not None:
        left_after_prompt = max(total_ctx - prompt_tokens, 0)
        used_now = prompt_tokens + out_tokens
        left_now = max(total_ctx - used_now, 0)
        print(
            f"🧠 Context: prompt {prompt_tokens}/{total_ctx} (left {left_after_prompt}); "
            f"output {out_tokens}; total {used_now}/{total_ctx} (left {left_now})"
        )
    elif prompt_tokens is not None:
        print(f"🧠 Tokens: prompt {prompt_tokens}; output {out_tokens}")