"""E2E das abas de canal (mock espelhando o dashboard real).
python e2e_channels.py <base_url> <out_dir>"""
import asyncio, json, os, subprocess, sys, time, urllib.request
import websockets
sys.path.insert(0, os.path.dirname(__file__))
import e2e_cdp
from e2e_cdp import CDP, CHROME, PORT, BTN, HASBTN, TEXT, console_errors

BASE = sys.argv[1].rstrip("/"); OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True); e2e_cdp.OUT = OUT
report = []

def note(step, ok, detail=""):
    report.append({"step": step, "ok": bool(ok), "detail": str(detail)})
    print(("OK  " if ok else "FAIL"), step, "-", detail, flush=True)

NAVBTN = "[...document.querySelectorAll('nav button')].find(b => b.textContent.includes(%r))"
BADGE = "document.querySelector('.tg-card .rounded-full.text-xs')?.innerText || ''"

async def open_settings(c, section):
    await c.send("Page.navigate", url=f"{BASE}/?settings=1&section={section}")
    await asyncio.sleep(1.5)
    await c.wait_for("!!document.querySelector('nav button')", 10, "aba " + section)
    if section in ("whatsapp", "telegram"):
        await c.wait_for("!!document.querySelector('.tg-card') && !document.querySelector('.tg-card .animate-spin')", 10, "estado carregado")

async def main():
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", f"--remote-debugging-port={PORT}", f"--user-data-dir={OUT}/prof", "--window-size=1440,900", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tabs = []
    try:
        for _ in range(40):
            try: tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json")); break
            except Exception: time.sleep(0.25)
        page = next(t for t in tabs if t["type"] == "page")
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=50_000_000) as ws:
            c = CDP(ws); await c.start()
            for d in ("Page", "Runtime", "Network"): await c.send(f"{d}.enable")
            await c.send("Emulation.setDeviceMetricsOverride", width=1440, height=900, deviceScaleFactor=1, mobile=False)
            await c.js("window.confirm = () => true")

            # ---------- WhatsApp ----------
            await open_settings(c, "whatsapp")
            note("WA1. estado inicial lido de /platforms", (await c.js(BADGE)) == "Desligado", await c.js(BADGE))
            note("WA2. modo padrão = Só comigo", await c.js("!!document.querySelector('.tg-card button.border-primary')?.innerText.includes('Só comigo')"), "")
            await c.click(BTN % "Iniciar pareamento")
            await c.wait_for(HASBTN % "Confirmar e ativar", 15, "pareado")
            await c.shot("wa_paired")
            note("WA3. pareia e pede confirmação com modo", await c.js(TEXT % "Número pareado"), "")
            await c.click(BTN % "Confirmar e ativar")
            await c.wait_for(TEXT % "reiniciando", 10, "apply notice")
            await c.shot("wa_applied")
            note("WA4. apply -> aviso de reinício (restart_started)", True, "")
            # sair e voltar: estado deve PERSISTIR (lido do backend)
            await c.wait_for("(() => { const b = %s; return b === 'Ativo'; })()" % BADGE, 20, "badge Ativo após reinício simulado")
            await open_settings(c, "account")
            await open_settings(c, "whatsapp")
            await c.shot("wa_reopened")
            badge = await c.js(BADGE)
            note("WA5. sair e voltar: estado persiste (Ativo + modo Só comigo)", badge == "Ativo" and (await c.js(TEXT % "Só comigo")), f"badge={badge}")
            await c.js("window.confirm = () => true")
            await c.click(BTN % "Desligar WhatsApp")
            await c.wait_for("(() => { const b = %s; return b === 'Desligado'; })()" % BADGE, 10, "desligado")
            note("WA6. Desligar -> PUT enabled=false -> Desligado", True, "")

            # ---------- Telegram ----------
            await open_settings(c, "telegram")
            note("TG1. estado inicial lido de /platforms", (await c.js(BADGE)) == "Desligado", await c.js(BADGE))
            await c.click(BTN % "Iniciar conexão")
            await c.wait_for(TEXT % "Aguardando autorização", 5, "waiting")
            await c.wait_for(HASBTN % "Confirmar e ativar", 15, "ready")
            await c.shot("tg_ready")
            note("TG2. status 'ready' reconhecido (bot autorizado)", await c.js(TEXT % "urban_bot"), "")
            note("TG3. owner_user_id pré-preenchido", (await c.js("document.querySelector('.tg-card input')?.value")) == "123456789", "")
            # valida campo obrigatório
            await c.click("document.querySelector('.tg-card input')")
            await c.js("(() => { const i = document.querySelector('.tg-card input'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i, ''); i.dispatchEvent(new Event('input', {bubbles:true})); })()")
            note("TG4. sem ID -> botão desabilitado", await c.js("(%s)?.disabled === true" % (BTN % "Confirmar e ativar")), "")
            await c.js("(() => { const i = document.querySelector('.tg-card input'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i, '987654321'); i.dispatchEvent(new Event('input', {bubbles:true})); })()")
            await c.click(BTN % "Confirmar e ativar")
            await c.wait_for(TEXT % "reiniciando", 10, "apply notice tg")
            note("TG5. apply com allowed_user_ids -> reinício", True, "")
            await c.wait_for("(() => { const b = %s; return b === 'Ativo'; })()" % BADGE, 20, "tg Ativo")
            await open_settings(c, "account")
            await open_settings(c, "telegram")
            await c.shot("tg_reopened")
            note("TG6. sair e voltar: estado persiste (Ativo)", (await c.js(BADGE)) == "Ativo", await c.js(BADGE))
            await c.js("window.confirm = () => true")
            await c.click(BTN % "Desligar Telegram")
            await c.wait_for("(() => { const b = %s; return b === 'Desligado'; })()" % BADGE, 10, "tg desligado")
            note("TG7. Desligar -> Desligado", True, "")
            note("0. erros de console", not console_errors, "; ".join(console_errors)[:300] or "nenhum")
    finally:
        proc.kill()
    fails = [r for r in report if not r["ok"]]
    print(f"\n{len(report)-len(fails)}/{len(report)} passos OK")
    sys.exit(1 if fails else 0)

asyncio.run(main())
