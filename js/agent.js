// The actual "backbone": a built-in chat that lets any visitor type a request,
// have a real LLM decide which of our WebMCP tool functions to call, execute
// them for real, and reply in plain language — then keep refining across
// follow-ups. Works for anyone, not just visitors using an agentic browser
// that supports WebMCP.
//
// Default (and only, in the UI) experience needs zero setup: "Shared" routes
// through a tiny Cloudflare Worker (../worker/index.js) holding one
// Anthropic key as a server-side secret, so a visitor never sees or needs an
// API key. The Gemini/Claude "bring your own key" provider objects below
// still exist in code — same tool defs, same execute() functions — but the
// dropdown/key-entry UI that let a visitor pick them was removed as demo
// clutter; getStoredApiKey() is what Agent.send() would use for either if
// something ever wires them back up.

const AGENT_KEY_STORAGE_PREFIX = 'signal_path_api_key_';
const AGENT_MODEL_CACHE_PREFIX = 'signal_path_model_';

// Filled in once the Worker is deployed (see worker/wrangler.toml).
const SHARED_WORKER_URL = 'https://signal-path-agent-proxy.mason-mcp-synth.workers.dev';

function getStoredApiKey(provider) {
  return localStorage.getItem(AGENT_KEY_STORAGE_PREFIX + provider) || '';
}

const SYSTEM_TEXT =
  'You are a sound-design tutor controlling a synthesizer through function calls. Translate ' +
  'the user\'s request (which may be vague or purely emotional/descriptive) into specific ' +
  'tool calls using the mappings described in each tool\'s own description. For a broad or ' +
  'vague request, prefer calling load_preset first to get close quickly, then fine-tune with ' +
  'the other tools only if useful. For every tool call that changes a parameter, always ' +
  'include a short, plain-language "reason" written for a beginner, and that reason must ' +
  'describe the exact numeric values you are passing in that same call — never mention a ' +
  'different number than the one in the call\'s own arguments. After you are done making ' +
  'changes, each function result tells you the real, final value of every parameter it ' +
  'touched — you must always send a short, warm, non-technical final reply summarizing what ' +
  'changed (1-3 sentences), and that reply must stay strictly consistent with those returned ' +
  'values (e.g. if a result says "resonance 2.0", do not describe it as heavily resonant or ' +
  'give a different number) — never stop after only calling functions with no reply text, and ' +
  'never describe a value you did not actually set. If the user asks a pure question with no ' +
  'change to make, use explain_parameter and relay its answer conversationally.';

// ---- Shared provider (default, no key needed) ----
const SharedProvider = {
  id: 'shared',
  label: 'Shared (no key needed)',
  needsKey: false,

  async resolveModel() { return ''; }, // model choice lives server-side
  toDeclarations(toolDefs) {
    return toolDefs.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  },
  newHistory() { return []; },
  appendUserText(history, text) { history.push({ role: 'user', content: text }); },

  async requestTurn(history, model, apiKey, declarations) {
    const res = await fetch(SHARED_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: SYSTEM_TEXT, messages: history, tools: declarations }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`The shared agent is unavailable right now (${res.status}). Try a "bring your own key" provider from the dropdown instead. ${bodyText.slice(0, 150)}`);
    }
    const data = await res.json();
    const content = data.content || [];
    history.push({ role: 'assistant', content });
    const functionCalls = content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: b.input }));
    const textReply = content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    return { functionCalls, textReply: functionCalls.length ? null : (textReply || '(no reply text)') };
  },

  appendFunctionResults(history, resultsByCall) {
    history.push({
      role: 'user',
      content: resultsByCall.map(({ id, resultText }) => ({
        type: 'tool_result',
        tool_use_id: id,
        content: resultText,
      })),
    });
  },
};

// ---- Gemini provider (bring your own key) ----
const GeminiProvider = {
  id: 'gemini',
  label: 'Gemini (your key)',
  needsKey: true,
  keyPlaceholder: 'Paste your free Gemini API key',
  getKeyUrl: 'https://aistudio.google.com/apikey',

  async resolveModel(apiKey) {
    const cacheKey = AGENT_MODEL_CACHE_PREFIX + 'gemini';
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) {
      throw new Error(res.status === 400 || res.status === 403
        ? 'That Gemini API key was rejected by Google. Double-check it and try again.'
        : `Could not list Gemini models (HTTP ${res.status}).`);
    }
    const data = await res.json();
    const usable = (data.models || []).filter((m) =>
      (m.supportedGenerationMethods || []).includes('generateContent')
    );
    const flash = usable
      .filter((m) => /flash/i.test(m.name) && !/embed|aqa|vision/i.test(m.name))
      .sort((a, b) => (a.name < b.name ? 1 : -1));
    const pick = flash[0] || usable[0];
    if (!pick) throw new Error('This Gemini key has no model available that supports function calling.');
    const modelId = pick.name.replace(/^models\//, '');
    sessionStorage.setItem(cacheKey, modelId);
    return modelId;
  },

  toDeclarations(toolDefs) {
    return toolDefs.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema }));
  },

  newHistory() { return []; },

  appendUserText(history, text) {
    history.push({ role: 'user', parts: [{ text }] });
  },

  async requestTurn(history, model, apiKey, declarations) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: history,
          tools: [{ functionDeclarations: declarations }],
          systemInstruction: { parts: [{ text: SYSTEM_TEXT }] },
        }),
      }
    );
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`Gemini API error ${res.status}. ${bodyText.slice(0, 200)}`);
    }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    history.push({ role: 'model', parts });
    const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    const textReply = parts.map((p) => p.text).filter(Boolean).join(' ').trim();
    return { functionCalls, textReply: functionCalls.length ? null : (textReply || '(no reply text)') };
  },

  appendFunctionResults(history, resultsByCall) {
    history.push({
      role: 'user',
      parts: resultsByCall.map(({ name, resultText }) => ({
        functionResponse: { name, response: { result: resultText } },
      })),
    });
  },
};

// ---- Claude provider (bring your own key) ----
const ClaudeProvider = {
  id: 'claude',
  label: 'Claude (your key)',
  needsKey: true,
  keyPlaceholder: 'Paste your Claude API key (sk-ant-...)',
  getKeyUrl: 'https://platform.claude.com/settings/keys',

  async resolveModel(apiKey) {
    const cacheKey = AGENT_MODEL_CACHE_PREFIX + 'claude';
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!res.ok) {
      throw new Error(res.status === 401 || res.status === 403
        ? 'That Claude API key was rejected. Double-check it and try again.'
        : `Could not list Claude models (HTTP ${res.status}).`);
    }
    const data = await res.json();
    const models = data.data || [];
    const pick = models.find((m) => /sonnet/i.test(m.id)) || models[0];
    if (!pick) throw new Error('No Claude model available for this API key.');
    sessionStorage.setItem(cacheKey, pick.id);
    return pick.id;
  },

  toDeclarations(toolDefs) {
    return toolDefs.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  },

  newHistory() { return []; },

  appendUserText(history, text) {
    history.push({ role: 'user', content: text });
  },

  async requestTurn(history, model, apiKey, declarations) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: SYSTEM_TEXT,
        messages: history,
        tools: declarations,
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`Claude API error ${res.status}. ${bodyText.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data.content || [];
    history.push({ role: 'assistant', content });
    const functionCalls = content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: b.input }));
    const textReply = content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    return { functionCalls, textReply: functionCalls.length ? null : (textReply || '(no reply text)') };
  },

  appendFunctionResults(history, resultsByCall) {
    history.push({
      role: 'user',
      content: resultsByCall.map(({ id, resultText }) => ({
        type: 'tool_result',
        tool_use_id: id,
        content: resultText,
      })),
    });
  },
};

const PROVIDERS = { shared: SharedProvider, gemini: GeminiProvider, claude: ClaudeProvider };

class Agent {
  constructor(toolDefs, provider) {
    this.toolDefs = toolDefs;
    this.toolMap = Object.fromEntries(toolDefs.map((t) => [t.name, t]));
    this.setProvider(provider);
  }

  setProvider(provider) {
    this.provider = provider;
    this.history = provider.newHistory();
  }

  async send(userText, { onStatus } = {}) {
    const provider = this.provider;
    let apiKey = '';
    if (provider.needsKey) {
      apiKey = getStoredApiKey(provider.id);
      if (!apiKey) {
        const err = new Error('No API key saved yet.');
        err.code = 'NO_KEY';
        throw err;
      }
    }
    onStatus?.('thinking');
    const model = await provider.resolveModel(apiKey);
    const declarations = provider.toDeclarations(this.toolDefs);
    provider.appendUserText(this.history, userText);

    for (let round = 0; round < 4; round++) {
      onStatus?.('thinking');
      const { functionCalls, textReply } = await provider.requestTurn(this.history, model, apiKey, declarations);
      if (!functionCalls.length) return textReply;

      onStatus?.(`calling ${functionCalls.map((c) => c.name).join(', ')}`);
      const resultsByCall = [];
      for (const call of functionCalls) {
        const def = this.toolMap[call.name];
        let resultText;
        try {
          resultText = def ? await def.execute(call.args || {}) : `Unknown tool: ${call.name}`;
        } catch (err) {
          resultText = `Error running ${call.name}: ${err.message}`;
        }
        console.debug(`[agent:${provider.id}] ${call.name}`, { rawArgs: call.args, resultText });
        resultsByCall.push({ ...call, resultText });
      }
      provider.appendFunctionResults(this.history, resultsByCall);
    }
    return 'Made several changes — check the reasoning log below for the full breakdown.';
  }
}

function appendChatMessage(role, text) {
  const log = document.getElementById('agent-log');
  const msg = el('div', `agent-msg agent-msg--${role}`, [text]);
  log.append(msg);
  log.scrollTop = log.scrollHeight;
  return msg;
}

const AGENT_PANEL_POS_STORAGE = 'signal_path_agent_panel_pos';

// Lets the floating agent panel be dragged anywhere by its header, clamped to
// stay on-screen, with its last position remembered across reloads. Clicks on
// real controls inside the header (the provider select, the key toggle) must
// not start a drag.
function makeDraggable(panel, handle) {
  const saved = JSON.parse(localStorage.getItem(AGENT_PANEL_POS_STORAGE) || 'null');
  if (saved) {
    panel.style.left = `${saved.left}px`;
    panel.style.top = `${saved.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  const onMove = (e) => {
    if (!dragging) return;
    const maxLeft = window.innerWidth - panel.offsetWidth - 4;
    const maxTop = window.innerHeight - panel.offsetHeight - 4;
    const left = Math.max(4, Math.min(startLeft + (e.clientX - startX), maxLeft));
    const top = Math.max(4, Math.min(startTop + (e.clientY - startY), maxTop));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const rect = panel.getBoundingClientRect();
    localStorage.setItem(AGENT_PANEL_POS_STORAGE, JSON.stringify({ left: rect.left, top: rect.top }));
  };
  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('select, button, input, a')) return;
    dragging = true;
    handle.classList.add('dragging');
    const rect = panel.getBoundingClientRect();
    startLeft = rect.left; startTop = rect.top;
    startX = e.clientX; startY = e.clientY;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

// The provider abstraction (Shared/Gemini/Claude) still exists above for
// anyone reading the code, but the UI only ever drives Shared now — the
// dropdown and key-entry controls were cut as demo clutter once the shared
// backend made them unnecessary for the default experience.
function initAgentPanel(toolDefs) {
  makeDraggable(document.querySelector('.agent-panel'), document.querySelector('.agent-header'));

  const form = document.getElementById('agent-form');
  const input = document.getElementById('agent-input');
  const sendBtn = document.getElementById('agent-send');

  const agent = new Agent(toolDefs, PROVIDERS.shared);

  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;

    appendChatMessage('user', text);
    input.value = '';
    busy = true;
    sendBtn.disabled = true;
    const statusMsg = appendChatMessage('status', 'Thinking…');

    try {
      const reply = await agent.send(text, {
        onStatus: (s) => { statusMsg.textContent = s === 'thinking' ? 'Thinking…' : `Turning knobs (${s})…`; },
      });
      statusMsg.remove();
      appendChatMessage('agent', reply);
    } catch (err) {
      statusMsg.remove();
      appendChatMessage('error', err.message || 'Something went wrong talking to the agent.');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  });
}
