"""Sonda direta do WS do dashboard: session.create -> image.attach_bytes -> prompt.submit.
python ws_probe.py <ws_url_with_token> <profile>"""
import asyncio, base64, json, sys, time
import websockets

URL, PROFILE = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("", "")
# PNG 64x64 vermelho sólido gerado aqui (zlib) para não depender de arquivo.
import zlib, struct
def png_red(w=64, h=64):
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

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
                print("  ev:", m.get("params", {}).get("type"), str(m.get("params", {}).get("payload", ""))[:120])
        print("ready:", json.loads(await ws.recv())["params"]["type"])
        await call("client.capabilities", server_requests=True)
        s = await call("session.create", source="web")
        sid = s["result"]["session_id"]; print("session", sid)
        r = await call("image.attach_bytes", session_id=sid, content_base64=base64.b64encode(png_red()).decode(), filename="vermelho.png")
        print("attach:", json.dumps(r)[:300])
        r = await call("file.attach", session_id=sid, data_url="data:text/plain;base64," + base64.b64encode(b"SENHA-DO-TESTE: abacaxi\n").decode(), name="notas.txt")
        print("file:", json.dumps(r)[:300])
        r = await call("prompt.submit", session_id=sid, text="Qual a cor da imagem e qual a palavra depois de SENHA-DO-TESTE no arquivo? Uma linha.")
        print("submit:", json.dumps(r)[:200])
        t0 = time.time()
        while time.time() - t0 < 120:
            m = json.loads(await asyncio.wait_for(ws.recv(), 120))
            p = m.get("params", {})
            if p.get("type") == "message.complete":
                print("COMPLETE:", json.dumps(p.get("payload"))[:400]); break
            if p.get("type") not in ("message.delta",):
                print("  ev:", p.get("type"), str(p.get("payload", ""))[:160])
if __name__ == "__main__":
    asyncio.run(main())
