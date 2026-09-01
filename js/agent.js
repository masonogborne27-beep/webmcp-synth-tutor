// The actual "backbone": a built-in chat that lets any visitor type a request,
// have a real LLM (Gemini, called directly from the browser) decide which of
// our WebMCP tool functions to call, execute them for real, and reply in
// plain language — then keep refining across follow-ups. This works for
// anyone, not just visitors using an agentic browser that supports WebMCP.

const GEMINI_KEY_STORAGE = 'signal_path_gemini_api_key';
const GEMINI_MODEL_CACHE_KEY = 'signal_path_gemini_model';

function getStoredApiKey() {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
}
function setStoredApiKey(key) {
  if (key) localStorage.setItem(GEMINI_KEY_STORAGE, key);
  else localStorage.removeItem(GEMINI_KEY_STORAGE);
}

async function resolveGeminiModel(apiKey) {
  const cached = sessionStorage.getItem(GEMINI_MODEL_CACHE_KEY);
  if (cached) return cached;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  if (!res.ok) {
    throw new Error(res.status === 400 || res.status === 403
      ? 'That API key was rejected by Google. Double-check it and try again.'
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
  if (!pick) throw new Error('This API key has no model available that supports function calling.');

  const modelId = pick.name.replace(/^models\//, '');
  sessionStorage.setItem(GEMINI_MODEL_CACHE_KEY, modelId);
  return modelId;
}

const SYSTEM_INSTRUCTION =
  'You are a sound-design tutor controlling a synthesizer through function calls. Translate ' +
  'the user\'s request (which may be vague or purely emotional/descriptive) into specific ' +
  'tool calls using the mappings described in each tool\'s own description. For a broad or ' +
  'vague request, prefer calling load_preset first to get close quickly, then fine-tune with ' +
  'the other tools only if useful. For every tool call that changes a parameter, always ' +
  'include a short, plain-language "reason" written for a beginner. After you are done making ' +
  'changes, you must always send a short, warm, non-technical final reply summarizing what you ' +
  'changed and why (1-3 sentences) — this is shown directly to the user as chat, so never stop ' +
  'after only calling functions with no reply text. If the user asks a pure question with no ' +
  'change to make, use explain_parameter and relay its answer conversationally.';

class Agent {
  constructor(toolDefs) {
    this.toolDefs = toolDefs;
    this.toolMap = Object.fromEntries(toolDefs.map((t) => [t.name, t]));
    this.history = [];
  }

  async send(userText, { onStatus } = {}) {
    const apiKey = getStoredApiKey();
    if (!apiKey) {
      const err = new Error('No API key saved yet.');
      err.code = 'NO_KEY';
      throw err;
    }
    const model = await resolveGeminiModel(apiKey);
    this.history.push({ role: 'user', parts: [{ text: userText }] });

    const functionDeclarations = this.toolDefs.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));

    for (let round = 0; round < 4; round++) {
      onStatus?.('thinking');
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: this.history,
            tools: [{ functionDeclarations }],
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          }),
        }
      );
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new Error(`Gemini API error ${res.status}. ${bodyText.slice(0, 200)}`);
      }
      const data = await res.json();
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      if (parts.length === 0) {
        return 'The model returned an empty response — try rephrasing your request.';
      }
      this.history.push({ role: 'model', parts });

      const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
      if (functionCalls.length === 0) {
        return parts.map((p) => p.text).filter(Boolean).join(' ').trim() || '(no reply text)';
      }

      onStatus?.(`calling ${functionCalls.map((c) => c.name).join(', ')}`);
      const responseParts = [];
      for (const call of functionCalls) {
        const def = this.toolMap[call.name];
        let resultText;
        try {
          resultText = def ? await def.execute(call.args || {}) : `Unknown tool: ${call.name}`;
        } catch (err) {
          resultText = `Error running ${call.name}: ${err.message}`;
        }
        responseParts.push({ functionResponse: { name: call.name, response: { result: resultText } } });
      }
      this.history.push({ role: 'user', parts: responseParts });
      // loop again — the model may call more tools, or now give a final reply
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

function initAgentPanel(toolDefs) {
  const agent = new Agent(toolDefs);

  const keyToggle = document.getElementById('agent-key-toggle');
  const keyRow = document.getElementById('agent-key-row');
  const keyInput = document.getElementById('agent-key-input');
  const keySave = document.getElementById('agent-key-save');
  const form = document.getElementById('agent-form');
  const input = document.getElementById('agent-input');
  const sendBtn = document.getElementById('agent-send');

  const refreshKeyToggleLabel = () => {
    keyToggle.textContent = getStoredApiKey() ? '⚙ API key ✓' : '⚙ API key needed';
    keyToggle.classList.toggle('agent-key-toggle--set', !!getStoredApiKey());
  };
  refreshKeyToggleLabel();

  keyToggle.addEventListener('click', () => {
    keyRow.hidden = !keyRow.hidden;
    if (!keyRow.hidden) keyInput.focus();
  });

  keySave.addEventListener('click', () => {
    const value = keyInput.value.trim();
    if (!value) return;
    setStoredApiKey(value);
    sessionStorage.removeItem(GEMINI_MODEL_CACHE_KEY);
    keyInput.value = '';
    keyRow.hidden = true;
    refreshKeyToggleLabel();
    appendChatMessage('status', 'API key saved to this browser. Try asking for a sound.');
  });

  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;

    if (!getStoredApiKey()) {
      appendChatMessage('status', 'Add a free Gemini API key first (⚙ above) — get one at aistudio.google.com/apikey.');
      keyRow.hidden = false;
      keyInput.focus();
      return;
    }

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
      if (err.code === 'NO_KEY') {
        appendChatMessage('status', 'Add a free Gemini API key first (⚙ above).');
      } else {
        appendChatMessage('error', err.message || 'Something went wrong talking to the agent.');
      }
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  });
}
