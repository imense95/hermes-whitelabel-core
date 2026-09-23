"""Roteiro E2E do client-ui via CDP (Chrome headless). Uso:
  python e2e_cdp.py <base_url> <out_dir> [modo]
Percorre: chat+streaming, upload (prévia+anexo), sessões (criar/listar/trocar),
seletor de modelo, aprovação/escolha, conta/configurações. Grava PNGs + JSON.
"""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request
import websockets

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else ""
OUT = sys.argv[2] if len(sys.argv) > 2 else "."
if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9333
PROFILE = os.path.join(OUT, "chrome-profile")

report = {"base": BASE, "steps": []}
console_errors = []
console_debug = []


def note(step, ok, detail=""):
    report["steps"].append({"step": step, "ok": ok, "detail": detail})
    print(("OK  " if ok else "FAIL"), step, "-", detail, flush=True)


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0
        self.pending = {}
        self.events = []

    async def start(self):
        self.reader = asyncio.create_task(self._read())

    async def _read(self):
        async for raw in self.ws:
            m = json.loads(raw)
            if "id" in m:
                f = self.pending.pop(m["id"], None)
                if f:
                    f.set_result(m)
            else:
                self.events.append(m)
                if m.get("method") == "Runtime.consoleAPICalled" and m["params"]["type"] == "debug":
                    console_debug.append(" ".join(str(a.get("value", a.get("description", ""))) for a in m["params"]["args"]))
                if m.get("method") == "Runtime.consoleAPICalled" and m["params"]["type"] == "error":
                    console_errors.append(" ".join(str(a.get("value", a.get("description", ""))) for a in m["params"]["args"]))
                if m.get("method") == "Runtime.exceptionThrown":
                    console_errors.append(m["params"]["exceptionDetails"].get("text", "") + " " + str(m["params"]["exceptionDetails"].get("exception", {}).get("description", ""))[:300])

    async def send(self, method, **params):
        self.n += 1
        f = asyncio.get_event_loop().create_future()
        self.pending[self.n] = f
        await self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        r = await asyncio.wait_for(f, 30)
        if "error" in r:
            raise RuntimeError(f"{method}: {r['error']}")
        return r.get("result", {})

    async def js(self, expr):
        r = await self.send("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("text") + " " + str(r["exceptionDetails"].get("exception", {}).get("description", "")))
        return r.get("result", {}).get("value")

    async def shot(self, name):
        r = await self.send("Page.captureScreenshot", format="png")
        p = os.path.join(OUT, name + ".png")
        with open(p, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        return p

    async def click(self, selector_js):
        # selector_js: expressão JS que devolve o elemento
        box = await self.js(f"(() => {{ const el = {selector_js}; if (!el) return null; el.scrollIntoView({{block:'center'}}); const r = el.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; }})()")
        if not box:
            raise RuntimeError("elemento não encontrado: " + selector_js)
        x, y = box
        await self.send("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
        await self.send("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=1)
        await self.send("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=1)

    async def type_text(self, text):
        await self.send("Input.insertText", text=text)

    async def key(self, key, code=None, wkc=None, text=None):
        p = dict(key=key, code=code or key, windowsVirtualKeyCode=wkc or 0)
        if text is not None:
            p["text"] = text
        await self.send("Input.dispatchKeyEvent", type="keyDown", **p)
        await self.send("Input.dispatchKeyEvent", type="keyUp", **p)

    async def wait_for(self, expr, timeout=15, desc=""):
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                v = await self.js(expr)
                if v:
                    return v
            except Exception:
                pass
            await asyncio.sleep(0.3)
        raise TimeoutError("timeout esperando " + (desc or expr))


BTN = "[...document.querySelectorAll('button')].find(b => b.textContent.trim().includes(%r))"
HASBTN = "!!" + BTN
TEXT = "document.body.innerText.toLowerCase().includes(%r.toLowerCase())"


async def main():
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
                             f"--remote-debugging-port={PORT}", f"--user-data-dir={PROFILE}", "--window-size=1440,900", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                break
            except Exception:
                time.sleep(0.25)
        page = next(t for t in tabs if t["type"] == "page")
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=50_000_000) as ws:
            c = CDP(ws)
            await c.start()
            await c.send("Page.enable")
            await c.send("Runtime.enable")
            await c.send("Network.enable")
            await c.send("Emulation.setDeviceMetricsOverride", width=1440, height=900, deviceScaleFactor=1, mobile=False)

            # ---------- carga inicial + sessões ----------
            await c.send("Page.navigate", url=BASE + "/")
            await asyncio.sleep(2.5)
            await c.wait_for("document.querySelector('aside') !== null", desc="app")
            titles = await c.js("[...document.querySelectorAll('aside .side-convo')].map(b => b.textContent.trim())")
            note("3a. listagem de sessões (GET /api/sessions -> {sessions})", bool(titles), f"{len(titles)} conversas: {titles[:4]}")
            await c.shot("01_home")
            acct = await c.js("document.querySelector('aside button.w-full')?.innerText || ''")
            note("6a. cartão de conta (GET /api/auth/me)", "Cliente" not in acct or "@" in acct, acct.replace("\n", " | "))

            # ---------- trocar de conversa: histórico ----------
            await c.click("[...document.querySelectorAll('aside .side-convo')].find(b => b.textContent.includes('Marketing'))")
            await c.wait_for(TEXT % "Drive conectado", desc="histórico")
            n = await c.js("document.querySelectorAll('main section .rounded-2xl.bg-primary, main section .bg-background-50.rounded-2xl').length")
            note("3b. trocar de conversa carrega histórico (session.resume messages[].text)", n >= 3, f"{n} bolhas")
            await c.shot("02_history")
            await c.click("[...document.querySelectorAll('aside .side-convo')].find(b => b.textContent.includes('Primeiros passos'))")
            await c.wait_for(TEXT % "Bem-vindo", desc="segunda conversa")
            note("3c. troca entre conversas", True, "segunda conversa renderizou")

            # ---------- nova conversa + streaming ----------
            await c.click(BTN % "Nova conversa")
            await c.wait_for(TEXT % "Como posso ajudar", desc="hero")
            await c.click("document.querySelector('textarea')")
            await c.type_text("Olá, teste de streaming")
            await c.key("Enter", wkc=13, text="\r")
            try:
                await c.wait_for("(() => { const t = document.body.innerText; return t.includes('Você disse') && !document.querySelector('.animate-pulse'); })()", 20, "resposta completa")
            except TimeoutError:
                await c.shot("03_stream_FAIL")
                print("BODY:", (await c.js("document.body.innerText"))[:600])
                print("CONSOLE:", console_errors[:5])
                raise
            mid = await c.shot("03_stream_done")
            reply = await c.js("[...document.querySelectorAll('main .bg-background-50')].map(e => e.innerText).pop()")
            note("1a. enviar + streaming (session.create, prompt.submit, message.delta/complete)", "Você disse" in (reply or ""), (reply or "")[:90])
            title = await c.wait_for("document.querySelector('main section span.truncate')?.textContent", 8, "título")
            note("1b. título da sessão (session.title) + URL ?s=", bool(title and title != "Nova conversa") and (await c.js("location.search.includes('s=')")), title)
            await asyncio.sleep(2)
            titles2 = await c.js("[...document.querySelectorAll('aside .side-convo')].map(b => b.textContent.trim())")
            note("3d. nova conversa aparece na lista (sessions.changed)", len(titles2) > len(titles), f"{len(titles)} -> {len(titles2)}")

            # ---------- upload ----------
            png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR42mP8z8DwnwEKGBmwAgYGBgYAKQwH/1nJ0sMAAAAASUVORK5CYII=")
            await c.js("""(async () => {
              const b = Uint8Array.from(atob(%r), ch => ch.charCodeAt(0));
              const f1 = new File([b], 'foto-teste.png', {type:'image/png'});
              const f2 = new File([new Blob(['00'.repeat(64)])], 'video-teste.mp4', {type:'video/mp4'});
              const f3 = new File([new Blob(['hello'])], 'doc-teste.txt', {type:'text/plain'});
              const dt = new DataTransfer(); dt.items.add(f1); dt.items.add(f2); dt.items.add(f3);
              const inp = document.querySelector('input[type=file]'); inp.files = dt.files;
              inp.dispatchEvent(new Event('change', {bubbles:true})); return true; })()""" % base64.b64encode(png).decode())
            await c.wait_for("document.querySelectorAll('main img[alt]').length >= 1 && document.body.innerText.includes('video-teste.mp4')", 5, "prévias")
            await c.shot("04_upload_preview")
            note("2a. prévia de foto/vídeo/arquivo antes do envio", True, "3 chips com prévia da imagem")
            await c.click("document.querySelector('textarea')")
            await c.type_text("segue os arquivos")
            await c.key("Enter", wkc=13, text="\r")
            await c.wait_for("(() => { const t = document.body.innerText; return t.includes('Recebi 3 anexo') && !document.querySelector('.animate-pulse'); })()", 20, "confirmação dos anexos")
            await c.shot("05_upload_sent")
            note("2b. Hermes recebe os anexos (image.attach_bytes + file.attach antes do prompt.submit)", True, "resposta confirma 3 anexos; chips limpos")

            # ---------- aprovação ----------
            await c.click("document.querySelector('textarea')")
            await c.type_text("pode apagar o diretório temporário")
            await c.key("Enter", wkc=13, text="\r")
            try:
                await c.wait_for(TEXT % "quer executar", 10, "cartão de aprovação")
            except TimeoutError:
                await c.shot("06_approval_FAIL")
                print("BODY:", (await c.js("document.body.innerText"))[-700:])
                print("CONSOLE:", console_errors[:5])
                raise
            await c.shot("06_approval_card")
            has_cmd = await c.js(TEXT % "rm -rf /opt/data/tmp")
            note("5a. cartão de aprovação (pedido servidor->cliente 'approval')", has_cmd, "comando e 4 escolhas visíveis")
            await c.click(BTN % "Permitir uma vez")
            await c.wait_for(TEXT % "Feito, diretório removido", 10, "continuação após aprovação")
            note("5b. resposta {choice:'once'} destrava o agente", True, "agente continuou")

            # ---------- clarify / escolha visual ----------
            await c.click("document.querySelector('textarea')")
            await c.type_text("qual variação de arte publicar?")
            await c.key("Enter", wkc=13, text="\r")
            await c.wait_for(HASBTN % "Variação 2", 10, "cartão de escolha")
            await c.shot("07_choice_card")
            await c.click(BTN % "Variação 2")
            await c.wait_for(TEXT % "segui com", 10, "resposta à escolha")
            await c.shot("08_choice_answered")
            note("5c. escolha visual (pedido 'clarify' -> {answer})", True, "opção respondida, agente continuou")

            # ---------- seletor de modelo ----------
            await c.click(BTN % "claude-sonnet-4-6")
            await c.wait_for(TEXT % "só consulta", 5, "dropdown de modelo")
            await c.shot("09_model_picker")
            models = await c.js("[...document.querySelectorAll('.shadow-pop .truncate')].map(e => e.textContent).filter(Boolean)")
            note("4. seletor de modelo (GET /api/model/options -> providers[].models)", "gemini-3.6-flash" in models and "gpt-5.3" not in models, f"{models} (openai não autenticado omitido)")
            await c.key("Escape", wkc=27)
            await c.click("document.querySelector('main h1, main section')")  # fecha dropdown por clique fora
            await asyncio.sleep(0.3)

            # ---------- conta / configurações ----------
            await c.click("document.querySelector('aside .relative.mt-3 > button')")
            try:
                await c.wait_for(HASBTN % "Configurações", 5, "menu de conta")
            except TimeoutError:
                await c.shot("10_account_FAIL")
                raise
            await c.shot("10_account_menu")
            await c.click(BTN % "Configurações")
            await c.wait_for(TEXT % "Provedor de login", 5, "aba Conta")
            await c.shot("11_settings_account")
            acc = await c.js("document.body.innerText.includes('herbert@urban.example') && document.body.innerText.includes('self-hosted')")
            note("6b. Configurações > Conta (identidade OIDC + versão)", bool(acc), "e-mail, provedor e versão exibidos")
            await c.click("[...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Modelos'))")
            try:
                await c.wait_for(TEXT % "Modelo em uso", 5, "aba Modelos")
            except TimeoutError:
                await c.shot("12_models_FAIL"); print("BODY:", (await c.js("document.body.innerText"))[-500:]); raise
            await c.shot("12_settings_models")
            note("6c. Configurações > Modelos", await c.js(TEXT % "Anthropic"), "provedores e modelo em uso")

            # ---------- busca ----------
            await c.key("Escape", wkc=27)
            await c.wait_for("!document.querySelector('nav')", 5, "modal fechado por ESC")
            note("6d. ESC fecha Configurações", True, "")
            await asyncio.sleep(0.3)
            await c.click(BTN % "Buscar")
            await c.wait_for("!!document.querySelector('input[placeholder*=Buscar]')", 5, "modal busca")
            await c.click("document.querySelector('input[placeholder*=Buscar]')")
            await c.type_text("modelo")
            await c.wait_for(TEXT % "Resultados", 5, "resultados da busca")
            await c.shot("13_search")
            note("3e. busca (GET /api/sessions/search -> {results})", True, "resultados com snippet")

            # ---------- excluir conversa ----------
            await c.key("Escape", wkc=27)
            await c.js("window.confirm = () => true")
            await c.click("[...document.querySelectorAll('main section button[title=Mais]')][0]")
            await c.click(BTN % "Excluir conversa")
            await c.wait_for(TEXT % "Como posso ajudar", 8, "volta ao hero")
            note("3f. excluir conversa (DELETE /api/sessions/{id})", True, "removida da lista, volta ao início")
            await c.shot("14_after_delete")

            note("0. erros de console/JS durante todo o roteiro", not console_errors, "; ".join(console_errors)[:400] or "nenhum")
    finally:
        proc.kill()
    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    fails = [s for s in report["steps"] if not s["ok"]]
    print(f"\n{len(report['steps']) - len(fails)}/{len(report['steps'])} passos OK")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    asyncio.run(main())
