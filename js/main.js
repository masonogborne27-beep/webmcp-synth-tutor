const engine = new SynthEngine();

const onLogged = (param) => addReasoningLogEntry(param, '');
const uiHandles = buildSignalPath(engine, onLogged);

buildKeyboardUnit(engine);
initPresets(engine, uiHandles);

const toolDefs = buildToolDefs({ engine, ...uiHandles });
const mcpReady = registerWebMcpTools(toolDefs);
setMcpStatus(mcpReady);

initAgentPanel(toolDefs);
