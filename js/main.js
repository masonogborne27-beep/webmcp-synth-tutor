const engine = new SynthEngine();

const onLogged = (param) => addReasoningLogEntry(param, '');
const uiHandles = buildSignalPath(engine, onLogged);

initKeyboard(engine);
initPresets(engine, uiHandles);

const mcpReady = registerWebMcpTools({ engine, ...uiHandles });
setMcpStatus(mcpReady);
