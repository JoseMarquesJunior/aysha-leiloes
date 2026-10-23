"""Autoriza o Worker a enviar e-mails pela sua conta do Gmail (API do Gmail, escopo "enviar").

Por que: sem domínio próprio, o e-mail enviado pelo Brevo "em nome de" um endereço do Gmail reprova nas
verificações de autenticidade e cai no spam. Enviado pelos servidores do Google, passa.

Antes de rodar (uma vez, em https://console.cloud.google.com):
  1. Crie um projeto (ex.: aysha-leiloes).
  2. "APIs e serviços" → "Biblioteca" → procure "Gmail API" → Ativar.
  3. "APIs e serviços" → "Tela de permissão OAuth": tipo Externo, nome do app, seu e-mail de suporte; salve.
     Depois clique em "Publicar aplicativo" (status "Em produção"). Em modo de teste o acesso expira em 7 dias.
  4. "Credenciais" → "Criar credenciais" → "ID do cliente OAuth" → tipo "App para computador". Copie o
     ID do cliente e a chave secreta.

Uso:  python scripts/gmail_token.py
  Pede o ID e a chave, abre o navegador para você autorizar (na tela "app não verificado", clique em
  "Avançado" → "Acessar ... (não seguro)" → Permitir), recebe o código, troca pelo refresh token e grava os
  três segredos no Worker com `npx wrangler secret put` (pasta worker/).
"""

from __future__ import annotations

import http.server
import json
import os
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

PORTA = 8792
ESCOPO = "https://www.googleapis.com/auth/gmail.send"
RAIZ = Path(__file__).resolve().parent.parent


def pedir(rotulo: str) -> str:
    v = input(f"{rotulo}: ").strip()
    if not v:
        print("valor vazio; abortando")
        sys.exit(1)
    return v


def main() -> int:
    client_id = os.environ.get("GMAIL_CLIENT_ID") or pedir("ID do cliente OAuth (termina em .apps.googleusercontent.com)")
    client_secret = os.environ.get("GMAIL_CLIENT_SECRET") or pedir("Chave secreta do cliente")
    redirect = f"http://127.0.0.1:{PORTA}/"
    codigo: dict[str, str] = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" in q:
                codigo["code"] = q["code"][0]
                corpo = "<h2>Autorizado. Pode fechar esta aba e voltar ao terminal.</h2>"
            else:
                corpo = f"<h2>Falhou: {q.get('error', ['?'])[0]}</h2>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(corpo.encode("utf-8"))

        def log_message(self, *a):  # silencioso
            pass

    servidor = http.server.HTTPServer(("127.0.0.1", PORTA), Handler)
    threading.Thread(target=servidor.handle_request, daemon=True).start()
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect, "response_type": "code", "scope": ESCOPO,
        "access_type": "offline", "prompt": "consent",
    })
    print("\nAbrindo o navegador para autorizar. Se não abrir, cole esta URL:\n" + url + "\n")
    webbrowser.open(url)
    print("Aguardando a autorização…")
    import time
    for _ in range(600):
        if codigo:
            break
        time.sleep(0.5)
    if not codigo:
        print("Tempo esgotado sem autorização.")
        return 1
    dados = urllib.parse.urlencode({"code": codigo["code"], "client_id": client_id, "client_secret": client_secret,
                                    "redirect_uri": redirect, "grant_type": "authorization_code"}).encode()
    with urllib.request.urlopen("https://oauth2.googleapis.com/token", data=dados, timeout=30) as r:
        resp = json.loads(r.read().decode("utf-8"))
    refresh = resp.get("refresh_token")
    if not refresh:
        print("O Google não devolveu refresh_token. Revogue o acesso em myaccount.google.com/permissions e rode de novo.")
        print(json.dumps(resp, indent=1))
        return 1
    print("\nRefresh token obtido.")
    # teste rápido: um e-mail para a própria conta
    try:
        tok = resp["access_token"]
        with urllib.request.urlopen(urllib.request.Request("https://gmail.googleapis.com/gmail/v1/users/me/profile",
                                                           headers={"Authorization": f"Bearer {tok}"}), timeout=30) as r:
            perfil = json.loads(r.read().decode("utf-8"))
        print(f"Conta autorizada: {perfil.get('emailAddress')}  (use este endereço em EMAIL_REMETENTE no wrangler.toml)")
    except Exception as e:  # noqa: BLE001
        print(f"(não foi possível ler o perfil: {e})")
    gravar = input("\nGravar GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET e GMAIL_REFRESH_TOKEN no Worker agora? [S/n] ").strip().lower()
    if gravar in ("", "s", "sim", "y"):
        npx = "npx.cmd" if os.name == "nt" else "npx"
        for nome, valor in (("GMAIL_CLIENT_ID", client_id), ("GMAIL_CLIENT_SECRET", client_secret), ("GMAIL_REFRESH_TOKEN", refresh)):
            print(f"  wrangler secret put {nome}")
            subprocess.run([npx, "wrangler", "secret", "put", nome], input=valor, text=True, cwd=RAIZ / "worker", check=True)
        print("\nPronto: o Worker passa a enviar pelo Gmail. Teste pedindo um link de login no site.")
    else:
        print("\nGrave você mesmo, na pasta worker/:")
        print(f"  npx wrangler secret put GMAIL_CLIENT_ID      (valor: {client_id})")
        print("  npx wrangler secret put GMAIL_CLIENT_SECRET")
        print(f"  npx wrangler secret put GMAIL_REFRESH_TOKEN  (valor: {refresh})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
