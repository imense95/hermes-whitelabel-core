"""Sonda 2: session.resume de uma sessão armazenada + fluxo de approval real.
python ws_probe2.py <ws_url> <profile> <stored_session_id>"""
import asyncio, json, sys, time
import websockets

URL, PROFILE, STORED = sys.argv[1], sys.argv[2], sys.argv[3]

async def main():
    async with websockets.connect(URL, max_size=50_000_000) as ws:
        n = 0
        async def call(method, **params):
            nonlocal n
            n += 1
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": n, "method": method, "params": {"profile": PROFILE, **params}}))
            while True:
                m = json.loads(await ws.recv())
                if m.get("id") == n:
                    return m
                if "method" in m and isinstance(m.get("id"), str):
                    print("  SERVER REQUEST:", m["id"], m["method"], json.dumps(m.get("params"))[:200]); return m
        print("ready:", json.loads(await ws.recv())["params"]["type"])
        print("caps:", json.dumps(await call("client.capabilities", server_requests=True))[:200])
        r = await call("session.resume", session_id=STORED, source="web")
        res = r.get("result") or r
        print("resume keys:", list(res.keys())[:14] if isinstance(res, dict) else res)
        msgs = res.get("messages") if isinstance(res, dict) else None
        print("messages:", None if msgs is None else len(msgs), "message_count:", res.get("message_count"), "messages_omitted:", res.get("messages_omitted"), "hydrating:", res.get("hydrating"))
        if msgs:
            print(" first:", json.dumps(msgs[0])[:200])
        if res.get("hydrating") or res.get("messages_omitted"):
            print("-> tentando session.history")
            h = await call("session.history", session_id=res["session_id"])
            print("history:", json.dumps(h)[:300])
        sid = res["session_id"]
        r = await call("prompt.submit", session_id=sid, text="Use a ferramenta terminal para rodar exatamente: rm -rf /tmp/pasta-inexistente-e2e ; e me diga a saída.")
        print("submit:", json.dumps(r)[:150])
        t0 = time.time()
        while time.time() - t0 < 120:
            m = json.loads(await asyncio.wait_for(ws.recv(), 120))
            if isinstance(m.get("id"), str) and "method" in m:
                print("SERVER REQUEST:", m["id"], m["method"], json.dumps(m.get("params"))[:300])
                await ws.send(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": {"choice": "deny"}}))
                print("-> respondi deny")
                continue
            p = m.get("params", {})
            t = p.get("type")
            if t == "message.complete":
                print("COMPLETE:", json.dumps(p.get("payload"))[:300]); break
            if t not in ("message.delta", "reasoning.delta", "thinking.delta"):
                print("  ev:", t, str(p.get("payload", ""))[:200])
asyncio.run(main())
