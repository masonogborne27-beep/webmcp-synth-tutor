const engine = new SynthEngine();

// A knob the user turned themselves retires the agent's explanation for that
// module (passing no reason clears it) — the live value beneath it keeps
// updating either way, via the engine change subscription below.
const onLogged = (param) => addReasoningLogEntry(param, '');
const uiHandles = buildSignalPath(engine, onLogged);

buildKeyboardUnit(engine);
initPresets(engine, uiHandles);
initSignalFlow();
// Subscribes the annotation bubbles to engine changes, so their numbers are
// re-derived from live state on every change no matter what caused it.
initAnnotations(engine);
initPatchCharacter(engine);

const toolDefs = buildToolDefs({ engine, ...uiHandles });
const mcpReady = registerWebMcpTools(toolDefs);
setMcpStatus(mcpReady);

initAgentPanel(toolDefs, engine);
