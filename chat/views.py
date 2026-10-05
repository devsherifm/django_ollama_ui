import json
import re
import requests

from django.conf import settings
from django.http import JsonResponse, StreamingHttpResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt


def index(request):
    return render(request, "chat/index.html")


def models(request):
    try:
        r = requests.get(f"{settings.OLLAMA_BASE_URL}/api/tags", timeout=5)
        r.raise_for_status()
        data = r.json()
        return JsonResponse(data)
    except requests.RequestException as exc:
        return JsonResponse(
            {"error": "Cannot connect to Ollama", "detail": str(exc)},
            status=503,
        )


@csrf_exempt
def chat(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)

    try:
        body = json.loads(request.body.decode("utf-8"))
        model = body.get("model")
        messages = body.get("messages", [])
        temperature = body.get("temperature", 0.7)

        if not model:
            return JsonResponse({"error": "No model selected"}, status=400)
        # Keep the model focused and prevent accidental exposure of internal reasoning.
        # Qwen3-family hybrid models can also be controlled with the explicit /no_think
        # switch. We use both the Ollama API flag and the template-level switch so
        # that Think OFF remains OFF even when a model/template ignores one of them.
        think = bool(body.get("think", False))
        hybrid_model = any(tag in model.lower() for tag in ("qwen3", "deepseek-r1", "deepseek_r1"))
        system_prompt = settings.OLLAMA_SYSTEM_PROMPT
        if not think and hybrid_model:
            system_prompt += "\n/no_think"

        cleaned_messages = []
        for m in messages:
            if m.get("role") not in {"user", "assistant"}:
                continue
            content = m.get("content", "")
            # Never feed previous hidden-thought blocks back into the model.
            content = re.sub(r"<think>[\s\S]*?</think>", "", str(content), flags=re.IGNORECASE).strip()
            cleaned_messages.append({"role": m["role"], "content": content})

        messages = [{"role": "system", "content": system_prompt}] + cleaned_messages

        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "think": think,
            "options": {"temperature": temperature},
        }

        upstream = requests.post(
            f"{settings.OLLAMA_BASE_URL}/api/chat",
            json=payload,
            stream=True,
            timeout=600,
        )
        upstream.raise_for_status()

    except (ValueError, requests.RequestException) as exc:
        return JsonResponse({"error": str(exc)}, status=500)

    def generate():
        try:
            for line in upstream.iter_lines():
                if line:
                    if isinstance(line, bytes):
                        line = line.decode("utf-8", errors="replace")
                    yield (line + "\n").encode("utf-8")
        finally:
            upstream.close()

    response = StreamingHttpResponse(
        generate(),
        content_type="application/x-ndjson",
    )
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response
