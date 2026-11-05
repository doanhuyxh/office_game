// Chrome headless qua DevTools Protocol (không cần Playwright, chỉ cần Google Chrome trên macOS). Mỗi phiên một profile riêng → cookie riêng.
export async function launch(port: number, profile: string, width = 1440, height = 900) {
  const chrome = Bun.spawn(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--hide-scrollbars', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank'],
    { stdout: 'ignore', stderr: 'ignore' });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let targets: any[] = [];
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {} await sleep(200); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map<number, (v: any) => void>(); const errors: string[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data as string);
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a: any) => a.value ?? a.description).join(' '));
  };
  const send = (method: string, params: any = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const evalJs = async (expr: string) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; };
  const shot = async (path: string) => { const r = await send('Page.captureScreenshot', { format: 'png' }); await Bun.write(path, Buffer.from(r.result.data, 'base64')); };
  const go = async (url: string, wait = 2500) => { await send('Page.navigate', { url }); await sleep(wait); };
  const key = async (k: string, ms: number) => {
    const code = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', e: 'KeyE', q: 'KeyQ', r: 'KeyR' }[k] ?? k;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k });
    await sleep(ms);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
  };
  const login = async (user: string, password: string) => {
    await go('http://localhost:5173/login', 1500);
    return evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:${JSON.stringify(user)},password:${JSON.stringify(password)}})}).then(r=>r.status)`);
  };
  return { send, evalJs, shot, go, key, login, sleep, errors, close: () => { ws.close(); chrome.kill(); } };
}
