const $ = id => document.getElementById(id);

const chat = $("chat");
const welcome = $("welcome");
const prompt = $("prompt");
const send = $("send");
const modelSelect = $("modelSelect");
const historyEl = $("history");
const thinkToggle = $("thinkToggle");

let messages = [];
let generating = false;
let abortController = null;
let conversations = JSON.parse(localStorage.getItem("ollama_chats_v4") || localStorage.getItem("ollama_chats") || "[]");

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function b64(s) {
  return btoa(unescape(encodeURIComponent(s)));
}
function fromB64(s) {
  return decodeURIComponent(escape(atob(s)));
}

function save() {
  localStorage.setItem("ollama_chats_v4", JSON.stringify(conversations));
}

function renderHistory() {
  historyEl.innerHTML = "";
  conversations.slice().reverse().forEach((c, reverseIndex) => {
    const index = conversations.length - 1 - reverseIndex;
    const button = document.createElement("button");
    button.className = "history-item";
    button.textContent = c.title || "New chat";
    button.title = c.title || "New chat";
    if (c.id && messages.length && conversations[index]?.id === window.activeChatId) {
      button.classList.add("active");
    }
    button.onclick = () => loadConversation(index);
    historyEl.appendChild(button);
  });
}

function makeCodeBlock(code, lang) {
  const language = (lang || "").trim().toLowerCase();
  const safeCode = esc(code);
  const encoded = b64(code);
  const label = language || "text";
  return `
    <div class="code-wrap" data-code="${encoded}">
      <div class="code-head">
        <span class="code-lang">${esc(label)}</span>
        <button class="copy-btn copy-code" data-copy="${encoded}">Copy</button>
      </div>
      <pre><code class="language-${esc(label)}">${safeCode}</code></pre>
    </div>`;
}

function normalizeMermaid(source) {
  let s = String(source || "")
    .replace(/\r/g, "")
    .replace(/^\s*```(?:mermaid)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  if (!s) return "";

  // Normalize the diagram header and put it on its own line.
  s = s.replace(/^(flowchart|graph)\s+(TD|TB|BT|RL|LR)\s+/i,
    (_, kind, dir) => `${kind} ${dir}\n`);

  // The most common LLM mistake is:
  //   A -->|Create Socket|> B
  // Mermaid's valid form is:
  //   A -->|Create Socket| B
  // Repair that before parsing. Also handle whitespace variants.
  s = s.replace(/(-->|---|==>|-.->|--->|---->|====>)\s*\|([^|\n]*)\|\s*>+/g,
    (_, edge, label) => `${edge}|${label.trim()}| `);

  // Normalize valid-but-awkward spacing around edge labels.
  s = s.replace(/(-->|---|==>|-.->|--->|---->|====>)\s+\|([^|\n]*)\|/g,
    (_, edge, label) => `${edge}|${label.trim()}|`);

  // Split common one-line LLM flowcharts into one statement per line.
  // Example:
  // A -->|x| B B -->|y| C
  // becomes:
  // A -->|x| B
  // B -->|y| C
  const statements = [];
  for (const raw of s.split("\n")) {
    let line = raw.trim();
    if (!line) continue;

    line = line.replace(
      /\s+(?=[A-Za-z_][A-Za-z0-9_]*\s*(?:-->|---|-.->|==>|--->|---->|====>))/g,
      "\n"
    );

    line.split("\n").forEach(part => {
      const p = part.trim();
      if (p) statements.push(p);
    });
  }

  return statements.join("\n").trim();
}

function mermaidRepairCandidates(source) {
  const base = normalizeMermaid(source);
  const candidates = [base];

  // Additional defensive repairs for frequent LLM-generated edge syntax errors.
  const repairs = [
    // A -->|label|> B  -> A -->|label| B
    s => s.replace(/(-->|---|==>|-.->|--->|---->|====>)\|([^|\n]*)\|\s*>+/g,
      (_, edge, label) => `${edge}|${label.trim()}| `),

    // A --> |label| B -> A -->|label| B
    s => s.replace(/(-->|---|==>|-.->)\s+\|([^|\n]*)\|/g,
      (_, edge, label) => `${edge}|${label.trim()}|`),

    // Convert a common malformed closing arrow after a label.
    s => s.replace(/\|\s*>\s+([A-Za-z_][A-Za-z0-9_]*)/g, "| $1"),
  ];

  let current = base;
  for (const repair of repairs) {
    current = repair(current);
    current = normalizeMermaid(current);
    if (current && !candidates.includes(current)) candidates.push(current);
  }

  return candidates.filter(Boolean);
}

async function renderMermaid(container, source) {
  const candidates = mermaidRepairCandidates(source);
  container.dataset.mermaidSource = candidates[0] || "";

  try {
    if (!window.mermaid) throw new Error("Mermaid library is not loaded");

    let lastError = null;
    for (const clean of candidates) {
      try {
        // Validate first. We only render a candidate that Mermaid accepts.
        await mermaid.parse(clean);
        const id = "mmd-" + Math.random().toString(36).slice(2);
        const result = await mermaid.render(id, clean);
        container.dataset.mermaidSource = clean;
        container.querySelector(".diagram-body").innerHTML = result.svg;
        container.classList.remove("diagram-error");
        return;
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error("Invalid Mermaid syntax");
  } catch (err) {
    const clean = candidates[0] || "";
    container.classList.add("diagram-error");
    container.querySelector(".diagram-body").innerHTML =
      `<div class="diagram-error-text"><strong>Mermaid could not render this diagram.</strong>
       <div>${esc(err?.message || "Invalid Mermaid syntax")}</div>
       <details><summary>Show repaired Mermaid source</summary><pre>${esc(clean)}</pre></details></div>`;
  }
}

function renderMarkdown(md) {
  // Protect Mermaid fenced blocks before marked parses Markdown.
  const mermaids = [];
  md = md.replace(/```mermaid\s*([\s\S]*?)```/gi, (_, source) => {
    const index = mermaids.push(source) - 1;
    return `\n<div class="mermaid-placeholder" data-mermaid-index="${index}"></div>\n`;
  });

  const renderer = new marked.Renderer();
  renderer.code = function({text, lang}) {
    return makeCodeBlock(text, lang);
  };

  marked.setOptions({
    gfm: true,
    breaks: true,
    renderer
  });

  let out = marked.parse(md);

  out = out.replace(
    /<div class="mermaid-placeholder" data-mermaid-index="(\d+)"><\/div>/g,
    (_, i) => `
      <div class="diagram-wrap">
        <div class="diagram-head">
          <span>Mermaid diagram</span>
          <button class="copy-btn copy-mermaid" data-copy="${b64(normalizeMermaid(mermaids[Number(i)]))}">Copy code</button>
        </div>
        <div class="diagram-body">Rendering diagram…</div>
      </div>`
  );
  return out;
}

function simpleHighlight(code, lang) {
  const escaped = esc(code);
  const l = (lang || "").toLowerCase();

  // Deterministic lightweight fallback when Highlight.js is unavailable.
  // It is intentionally conservative so it never corrupts indentation/content.
  let out = escaped;
  if (["python","py","javascript","js","typescript","ts","bash","sh","shell","powershell","ps1","yaml","yml","json"].includes(l)) {
    out = out.replace(/(&quot;.*?&quot;|&#039;.*?&#039;|".*?"|'.*?')/g,
      '<span class="tok-string">$1</span>');
    out = out.replace(/(^|[\s(])(#.*$)/gm,
      '$1<span class="tok-comment">$2</span>');
    const keywords = l === "python" ?
      "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|not|or|pass|raise|return|True|try|while|with|yield" :
      "if|else|elif|for|while|function|return|const|let|var|class|new|import|from|export|async|await|try|catch|throw|true|false|null|undefined";
    out = out.replace(new RegExp("\\\\b(" + keywords + ")\\\\b", "g"),
      '<span class="tok-keyword">$1</span>');
    out = out.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
  }
  return out;
}

function highlightBlock(code) {
  const langClass = [...code.classList].find(x => x.startsWith("language-"));
  const lang = langClass ? langClass.slice(9).toLowerCase() : "";

  if (window.hljs) {
    try {
      let normalized = {
        py:"python", js:"javascript", ts:"typescript", sh:"bash",
        shell:"bash", ps1:"powershell", yml:"yaml", md:"markdown"
      }[lang] || lang;

      if (normalized && hljs.getLanguage(normalized)) {
        const result = hljs.highlight(code.textContent, {language: normalized, ignoreIllegals:true});
        code.innerHTML = result.value;
        code.dataset.highlighted = "true";
        return;
      }

      const result = hljs.highlightAuto(code.textContent);
      code.innerHTML = result.value;
      code.dataset.highlighted = "true";
      return;
    } catch {}
  }

  code.innerHTML = simpleHighlight(code.textContent, lang);
  code.dataset.highlighted = "true";
}

function postProcess(container) {
  container.querySelectorAll("pre code").forEach(code => highlightBlock(code));

  container.querySelectorAll(".diagram-wrap").forEach(diagram => {
    const btn = diagram.querySelector(".copy-mermaid");
    const source = btn ? fromB64(btn.dataset.copy) : "";
    renderMermaid(diagram, source);
  });
}

function addMsg(role, content) {
  welcome.classList.add("hidden");
  const row = document.createElement("div");
  row.className = "msg " + role;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "Y" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (role === "user") {
    bubble.innerHTML = esc(content).replace(/\n/g, "<br>");
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }

  row.append(avatar, bubble);
  chat.appendChild(row);

  if (role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "response-actions";
    actions.innerHTML = `<button class="copy-btn copy-response" data-copy="${b64(content)}">Copy response</button>`;
    bubble.appendChild(actions);
    postProcess(bubble);
  }

  chat.scrollTop = chat.scrollHeight;
}

function render() {
  chat.innerHTML = "";
  messages.forEach(m => addMsg(m.role, m.content));
  welcome.classList.toggle("hidden", messages.length > 0);
  renderHistory();
}

function newChat() {
  messages = [];
  window.activeChatId = null;
  render();
  prompt.focus();
}

function loadConversation(index) {
  const c = conversations[index];
  messages = c?.messages || [];
  window.activeChatId = c?.id || null;
  render();
}

function persist() {
  if (!messages.length) return;
  const title = messages.find(m => m.role === "user")?.content?.slice(0, 60) || "New chat";
  const id = window.activeChatId || crypto.randomUUID();

  const existing = conversations.findIndex(c => c.id === id);
  const item = { id, title, messages, updated: Date.now() };

  if (existing >= 0) conversations[existing] = item;
  else conversations.push(item);

  window.activeChatId = id;
  if (conversations.length > 100) conversations = conversations.slice(-100);
  save();
  renderHistory();
}

async function loadModels() {
  try {
    const r = await fetch("/api/models/");
    const data = await r.json();
    if (!r.ok) throw Error(data.detail || data.error || "Ollama unavailable");

    const models = data.models || [];
    modelSelect.innerHTML = "";
    models.forEach(m => {
      const o = document.createElement("option");
      o.value = m.name;
      o.textContent = m.name;
      modelSelect.appendChild(o);
    });

    const chosen = localStorage.getItem("ollama_model");
    if (chosen && [...modelSelect.options].some(o => o.value === chosen)) {
      modelSelect.value = chosen;
    }

    $("sideModel").textContent = models.length ? `${models.length} available` : "No models";
    $("modelInfo").textContent = modelSelect.value || "Ollama";
    updateThinkUi();
    $("statusText").textContent = `Ollama connected • ${models.length} models`;
    $("statusDot").className = "status-dot ok";
  } catch (e) {
    $("statusText").textContent = "Ollama unavailable";
    $("statusDot").className = "status-dot bad";
    modelSelect.innerHTML = "<option>Unavailable</option>";
  }
}

function updateThinkUi() {
  const model = (modelSelect.value || "").toLowerCase();
  const supported = /(qwen3|deepseek-r1|deepseek_r1)/.test(model);
  const label = document.querySelector(".think-toggle");
  if (label) {
    label.title = supported
      ? "Think is OFF by default. Enable only when you want reasoning."
      : "Think is an opt-in setting; most non-thinking models ignore it.";
  }
}

thinkToggle?.addEventListener("change", updateThinkUi);

modelSelect.onchange = () => {
  localStorage.setItem("ollama_model", modelSelect.value);
  $("modelInfo").textContent = modelSelect.value;
  updateThinkUi();
};

$("refreshModels").onclick = loadModels;
$("newChat").onclick = newChat;

$("themeToggle").onclick = () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("theme", document.body.classList.contains("dark") ? "dark" : "light");
};

if (localStorage.getItem("theme") === "dark") document.body.classList.add("dark");

document.querySelectorAll(".suggestions button").forEach(b => {
  b.onclick = () => { prompt.value = b.dataset.prompt; send.click(); };
});

prompt.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send.click();
  }
});

prompt.addEventListener("input", () => {
  prompt.style.height = "auto";
  prompt.style.height = Math.min(prompt.scrollHeight, 180) + "px";
});

// One delegated clipboard handler makes every Copy button reliable, including
// buttons created dynamically during streaming.
document.addEventListener("click", async e => {
  const button = e.target.closest("[data-copy]");
  if (!button) return;
  try {
    const text = fromB64(button.dataset.copy);
    await navigator.clipboard.writeText(text);
    const old = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => button.textContent = old, 1000);
  } catch {
    button.textContent = "Copy failed";
  }
});

async function run() {
  if (generating) {
    abortController?.abort();
    return;
  }

  const text = prompt.value.trim();
  const model = modelSelect.value;
  if (!text || !model) return;

  messages.push({role:"user", content:text});
  addMsg("user", text);
  prompt.value = "";
  prompt.style.height = "auto";

  generating = true;
  send.classList.add("stop");
  send.textContent = "■";
  abortController = new AbortController();

  const row = document.createElement("div");
  row.className = "msg assistant";
  row.innerHTML = '<div class="avatar">AI</div><div class="bubble"><span class="typing">Responding…</span></div>';
  chat.appendChild(row);

  const bubble = row.querySelector(".bubble");
  let answer = "";

  try {
    const r = await fetch("/api/chat/", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model,
        messages,
        temperature:.7,
        // Think is an explicit opt-in. OFF is always sent as false.
        think: thinkToggle?.checked === true
      }),
      signal:abortController.signal
    });

    if (!r.ok) {
      let errorText = "Request failed";
      try {
        const x = await r.json();
        errorText = x.error || errorText;
      } catch {}
      throw Error(errorText);
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const {value, done} = await reader.read();
      if (done) break;

      buf += decoder.decode(value, {stream:true});
      const lines = buf.split("\n");
      buf = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);

          // Always render normal answer content. Reasoning is only shown when
          // the user explicitly enables Think. With Think OFF, ignore the
          // reasoning field even if a model/template sends one anyway.
          if (j.message?.content) answer += j.message.content;
          if (thinkToggle?.checked === true && j.message?.thinking) {
            answer += "\n\n" + j.message.thinking;
          }

          if (answer) {
            bubble.innerHTML = renderMarkdown(answer);
            postProcess(bubble);
            chat.scrollTop = chat.scrollHeight;
          }
        } catch {}
      }
    }

    if (!answer) answer = "No response returned.";

    // Remove accidental <think> blocks from normal non-thinking mode.
    if (!thinkToggle?.checked) {
      answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }

    messages.push({role:"assistant", content:answer});
    bubble.innerHTML = renderMarkdown(answer);

    const actions = document.createElement("div");
    actions.className = "response-actions";
    actions.innerHTML = `<button class="copy-btn copy-response" data-copy="${b64(answer)}">Copy response</button>`;
    bubble.appendChild(actions);
    postProcess(bubble);
    persist();
  } catch (e) {
    if (e.name !== "AbortError") {
      bubble.innerHTML = `<p><strong>Error:</strong> ${esc(e.message)}</p>`;
    }
  } finally {
    generating = false;
    send.classList.remove("stop");
    send.textContent = "↑";
    abortController = null;
  }
}

send.onclick = run;
renderHistory();
loadModels();
updateThinkUi();
render();
