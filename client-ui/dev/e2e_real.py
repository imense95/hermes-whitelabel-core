"""Roteiro E2E contra um DASHBOARD REAL (local via proxy Vite, ou a instância
com cookie já logado). Não assume conteúdo: usa o que a instância devolve.
  python e2e_real.py <base_url> <out_dir>
"""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request
import websockets
sys.path.insert(0, os.path.dirname(__file__))
import e2e_cdp  # noqa: E402
from e2e_cdp import CDP, CHROME, PORT, BTN, HASBTN, TEXT, console_errors  # noqa: E402
from e2e_cdp import console_debug  # noqa: E402,F401

BASE = sys.argv[1].rstrip("/")
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
e2e_cdp.OUT = OUT
PROFILE = os.path.join(OUT, "chrome-profile")
report = {"base": BASE, "steps": []}


def note(step, ok, detail=""):
    report["steps"].append({"step": step, "ok": bool(ok), "detail": str(detail)})
    print(("OK  " if ok else "FAIL"), step, "-", detail, flush=True)


async def main():
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
                             f"--remote-debugging-port={PORT}", f"--user-data-dir={PROFILE}", "--window-size=1440,900", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tabs = []
    try:
        for _ in range(40):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json")); break
            except Exception:
                time.sleep(0.25)
        page = next(t for t in tabs if t["type"] == "page")
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=50_000_000) as ws:
            c = CDP(ws); await c.start()
            for d in ("Page", "Runtime", "Network"):
                await c.send(f"{d}.enable")
            await c.send("Emulation.setDeviceMetricsOverride", width=1440, height=900, deviceScaleFactor=1, mobile=False)
            await c.send("Page.navigate", url=BASE + "/")
            await asyncio.sleep(3)
            await c.wait_for("!!document.querySelector('aside')", 15, "app")
            await c.shot("r01_home")
            titles = await c.js("[...document.querySelectorAll('aside .side-convo')].map(b => b.textContent.trim())")
            note("3a. lista de sessões reais", isinstance(titles, list), f"{len(titles)} conversas; primeiras: {titles[:3]}")
            acct = await c.js("document.querySelector('aside .relative.mt-3 > button')?.innerText || ''")
            note("6a. cartão de conta", True, acct.replace("\n", " | ") + "  (sem gate OIDC local: /api/auth/me 401 -> 'Cliente')")

            # histórico de uma sessão existente
            if titles:
                await c.click("[...document.querySelectorAll('aside .side-convo')][0]")
                try:
                    await c.wait_for("(() => { const h = document.querySelector('main section span.truncate')?.textContent || ''; return h && h !== 'Nova conversa' && document.querySelectorAll('main .rounded-2xl.bg-primary').length > 0; })()", 40, "histórico real")
                    n = await c.js("document.querySelectorAll('main .bg-background-50, main .rounded-2xl.bg-primary').length")
                    ttl = await c.js("document.querySelector('main section span.truncate')?.textContent")
                    note("3b. abrir conversa existente (session.resume)", n > 0, f"{n} bolhas; título='{ttl}'")
                except TimeoutError:
                    await c.shot("r02_history_FAIL")
                    note("3b. abrir conversa existente (session.resume)", False, (await c.js("document.body.innerText"))[-300:] + " | debug: " + " ;; ".join(e2e_cdp.console_debug[-8:]))
                await c.shot("r02_history")

            # nova conversa + streaming real
            await c.click(BTN % "Nova conversa")
            await c.wait_for(TEXT % "Como posso ajudar", 5, "hero")
            await c.click("document.querySelector('textarea')")
            await c.type_text("Responda só com a palavra PONG.")
            await c.key("Enter", wkc=13, text="\r")
            t0 = time.time()
            try:
                await c.wait_for("(() => { const b=[...document.querySelectorAll('main .bg-background-50')]; return b.length && !document.querySelector('.animate-pulse') && !document.body.innerText.includes('respondendo'); })()", 120, "resposta real")
                reply = await c.js("[...document.querySelectorAll('main .bg-background-50')].map(e => e.innerText).pop()")
                note("1a. enviar + resposta real em streaming", "pong" in (reply or "").lower(), f"{time.time()-t0:.1f}s: {(reply or '')[:80]}")
            except TimeoutError:
                await c.shot("r03_stream_FAIL")
                note("1a. enviar + resposta real em streaming", False, (await c.js("document.body.innerText"))[-400:] + " | console: " + "; ".join(console_errors[:3]))
            await c.shot("r03_stream")
            title = await c.js("document.querySelector('main section span.truncate')?.textContent")
            note("1b. título + ?s= na URL", bool(title) and (await c.js("location.search.includes('s=')")), f"título='{title}' url={await c.js('location.search')}")
            await asyncio.sleep(2)
            titles2 = await c.js("[...document.querySelectorAll('aside .side-convo')].map(b => b.textContent.trim())")
            note("3d. nova conversa na lista", len(titles2) > len(titles), f"{len(titles)} -> {len(titles2)}")

            # upload real de imagem (PNG 8x8 vermelho) + pergunta sobre ela
            from ws_probe import png_red  # PNG 64x64 vermelho válido
            png = png_red()
            await c.js("""(async () => {
              const b = Uint8Array.from(atob(%r), ch => ch.charCodeAt(0));
              const f1 = new File([b], 'quadrado.png', {type:'image/png'});
              const f2 = new File([new Blob(['linha um\\nlinha dois\\nSENHA-DO-TESTE: abacaxi'])], 'notas.txt', {type:'text/plain'});
              const dt = new DataTransfer(); dt.items.add(f1); dt.items.add(f2);
              const inp = document.querySelector('input[type=file]'); inp.files = dt.files;
              inp.dispatchEvent(new Event('change', {bubbles:true})); return true; })()""" % base64.b64encode(png).decode())
            await c.wait_for("document.querySelectorAll('main img[alt]').length >= 1 && document.body.innerText.includes('notas.txt')", 5, "prévias")
            await c.shot("r04_upload_preview")
            note("2a. prévia dos anexos", True, "imagem + arquivo com chip")
            await c.click("document.querySelector('textarea')")
            await c.type_text("Diga a cor predominante da imagem anexada e a palavra que vem depois de 'SENHA-DO-TESTE:' no arquivo notas.txt. Responda em uma linha.")
            await c.key("Enter", wkc=13, text="\r")
            t0 = time.time()
            try:
                await c.wait_for("(() => { const b=[...document.querySelectorAll('main .bg-background-50')]; return b.length >= 2 && !document.querySelector('.animate-pulse') && !document.body.innerText.includes('respondendo') && document.querySelectorAll('main img[alt]').length === 0; })()", 180, "resposta sobre anexos")
                reply = await c.js("[...document.querySelectorAll('main .bg-background-50')].map(e => e.innerText).pop()") or ""
                ok = "abacaxi" in reply.lower() and ("vermelh" in reply.lower() or "red" in reply.lower())
                note("2b. Hermes recebe e processa imagem + arquivo", ok, f"{time.time()-t0:.1f}s: {reply[:160]}")
            except TimeoutError:
                await c.shot("r05_upload_FAIL")
                note("2b. Hermes recebe e processa imagem + arquivo", False, (await c.js("document.body.innerText"))[-400:])
            await c.shot("r05_upload_sent")

            # aprovação real: pedir um comando que o Hermes trata como perigoso
            await c.click("document.querySelector('textarea')")
            await c.type_text("Use a ferramenta terminal para rodar exatamente este comando e me diga a saída: rm -rf /tmp/pasta-que-nao-existe-e2e")
            await c.key("Enter", wkc=13, text="\r")
            try:
                await c.wait_for("(() => { const t=document.body.innerText.toLowerCase(); return t.includes('quer executar') || (t.includes('permitir') && t.includes('negar')); })()", 90, "cartão de aprovação real")
                await c.shot("r06_approval_card")
                note("5a. cartão de aprovação real (server request 'approval')", True, (await c.js("document.querySelector('pre')?.innerText || ''"))[:100])
                await c.click(BTN % "Negar")
                await c.wait_for("(() => !document.querySelector('.animate-pulse') && !document.body.innerText.includes('respondendo'))()", 120, "agente continua após negar")
                await c.shot("r07_after_deny")
                note("5b. resposta {choice:'deny'} destrava o agente", True, (await c.js("[...document.querySelectorAll('main .bg-background-50')].map(e => e.innerText).pop()") or "")[:120])
            except TimeoutError:
                await c.shot("r06_approval_FAIL")
                note("5. aprovação real", False, "nenhum cartão em 90s (pode ser modo de aprovação 'yolo'/auto na instância) — " + (await c.js("document.body.innerText"))[-300:])

            # clarify real
            await c.click("document.querySelector('textarea')")
            await c.type_text("Use a ferramenta clarify para me perguntar qual cor eu prefiro, com as opções Azul, Verde e Vermelho. Depois só confirme minha escolha.")
            await c.key("Enter", wkc=13, text="\r")
            try:
                await c.wait_for(HASBTN % "Verde", 90, "cartão clarify real")
                await c.shot("r08_clarify_card")
                await c.click(BTN % "Verde")
                await c.wait_for("(() => !document.querySelector('.animate-pulse') && !document.body.innerText.includes('respondendo') && document.body.innerText.toLowerCase().includes('verde'))()", 120, "resposta à escolha")
                await c.shot("r09_clarify_answered")
                note("5c. escolha visual real (server request 'clarify')", True, (await c.js("[...document.querySelectorAll('main .bg-background-50')].map(e => e.innerText).pop()") or "")[:120])
            except TimeoutError:
                await c.shot("r08_clarify_FAIL")
                note("5c. escolha visual real (clarify)", False, (await c.js("document.body.innerText"))[-300:])

            # seletor de modelo
            await c.click("[...document.querySelectorAll('main button')].find(b => b.querySelector('.text-claude') && b.textContent.trim())")
            await c.wait_for(TEXT % "só consulta", 5, "dropdown modelo")
            await c.shot("r10_model_picker")
            models = await c.js("[...document.querySelectorAll('.shadow-pop .truncate')].map(e => e.textContent).filter(Boolean)")
            inuse = await c.js("document.querySelector('main .text-claude')?.parentElement?.innerText")
            note("4. seletor de modelo (só visualização)", len(models) > 0, f"{len(models)//2} modelos; em uso: {inuse}")
            await c.key("Escape", wkc=27)
            await c.click("document.querySelector('main section')")

            # conta / configurações
            await c.click("document.querySelector('aside .relative.mt-3 > button')")
            await c.wait_for(HASBTN % "Configurações", 5, "menu conta")
            await c.click(BTN % "Configurações")
            await c.wait_for(TEXT % "Provedor de login", 5, "aba Conta")
            await c.shot("r11_settings_account")
            note("6b. Configurações > Conta", True, (await c.js("document.body.innerText")).split("Configurações")[-1][:200].replace("\n", " | "))
            await c.click("[...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Modelos'))")
            await c.wait_for(TEXT % "Modelo em uso", 15, "aba Modelos")
            await c.shot("r12_settings_models")
            note("6c. Configurações > Modelos", True, "")
            await c.key("Escape", wkc=27)
            await asyncio.sleep(0.3)

            # busca real
            await c.click(BTN % "Buscar")
            await c.wait_for("!!document.querySelector('input[placeholder*=Buscar]')", 5, "modal busca")
            await c.click("document.querySelector('input[placeholder*=Buscar]')")
            await c.type_text("PONG")
            await c.wait_for(TEXT % "Resultados", 10, "resultados")
            await c.shot("r13_search")
            note("3e. busca real (FTS)", await c.js("document.querySelectorAll('.shadow-pop button.flex-col').length > 0"), "")
            await c.key("Escape", wkc=27)

            # excluir a conversa de teste
            await c.js("window.confirm = () => true")
            await c.click("[...document.querySelectorAll('main section button[title=Mais]')][0]")
            await c.click(BTN % "Excluir conversa")
            await c.wait_for(TEXT % "Como posso ajudar", 10, "volta ao hero")
            await asyncio.sleep(1)
            titles3 = await c.js("[...document.querySelectorAll('aside .side-convo')].map(b => b.textContent.trim())")
            note("3f. excluir conversa real", len(titles3) < len(titles2), f"{len(titles2)} -> {len(titles3)}")
            await c.shot("r14_after_delete")
            note("0. erros de console/JS", not console_errors, "; ".join(console_errors)[:400] or "nenhum")
    finally:
        proc.kill()
    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    fails = [s for s in report["steps"] if not s["ok"]]
    print(f"\n{len(report['steps']) - len(fails)}/{len(report['steps'])} passos OK")
    sys.exit(1 if fails else 0)


asyncio.run(main())
