"""Cliente HTTP compartilhado por todas as fontes.

Regras (ver prompt do projeto):
- User-Agent identificado com o nome do projeto e o link do repositório;
- intervalo mínimo entre requisições ao mesmo domínio;
- respeita robots.txt (404/erro ao buscar robots = permitido);
- timeout em toda requisição;
- nunca baixa fotos (não há método para isso de propósito).
"""

from __future__ import annotations

import logging
import time
import urllib.robotparser
from urllib.parse import urlparse

import requests

log = logging.getLogger(__name__)

# Texto que a proteção anti-robô (Radware/ShieldSquare) devolve no lugar do conteúdo.
MARCAS_CAPTCHA = (b"Radware Bot Manager CAPTCHA", b"validate.perfdrive.com", b"ShieldSquare")


class BloqueadoPorCaptcha(RuntimeError):
    pass


class BloqueadoPorRobots(RuntimeError):
    pass


class ClienteHTTP:
    def __init__(self, user_agent: str, timeout: int = 60, intervalo: float = 2.0,
                 tentativas: int = 4, respeitar_robots: bool = True):
        self.user_agent = user_agent
        self.timeout = timeout
        self.intervalo = intervalo
        self.tentativas = tentativas
        self.respeitar_robots = respeitar_robots
        self._ultimo_acesso: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.sessao = requests.Session()
        self.sessao.headers.update({"User-Agent": user_agent, "Accept-Language": "pt-BR,pt;q=0.9"})

    # -- robots.txt ---------------------------------------------------------
    def _pode_acessar(self, url: str) -> bool:
        if not self.respeitar_robots:
            return True
        dominio = urlparse(url).netloc
        if dominio not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            robots_url = f"{urlparse(url).scheme}://{dominio}/robots.txt"
            try:
                self._esperar(dominio)
                r = self.sessao.get(robots_url, timeout=self.timeout)
                if r.status_code == 200 and b"<html" not in r.content[:200].lower():
                    rp.parse(r.text.splitlines())
                    self._robots[dominio] = rp
                else:
                    self._robots[dominio] = None  # sem robots válido = permitido
            except requests.RequestException as e:
                log.warning("robots.txt de %s indisponível (%s); seguindo como permitido", dominio, e)
                self._robots[dominio] = None
        rp = self._robots[dominio]
        return True if rp is None else rp.can_fetch(self.user_agent, url)

    # -- ritmo --------------------------------------------------------------
    def _esperar(self, dominio: str, intervalo: float | None = None) -> None:
        intervalo = self.intervalo if intervalo is None else intervalo
        ultimo = self._ultimo_acesso.get(dominio)
        if ultimo is not None:
            falta = intervalo - (time.monotonic() - ultimo)
            if falta > 0:
                time.sleep(falta)
        self._ultimo_acesso[dominio] = time.monotonic()

    # -- requisição ---------------------------------------------------------
    def get(self, url: str, *, params: dict | None = None, intervalo: float | None = None,
            headers: dict | None = None, api: bool = False) -> requests.Response:
        """GET com ritmo por domínio, robots, timeout e novas tentativas com espera crescente.

        `api=True` pula o robots.txt: é para endpoints de API cujo uso é regido por uma política própria
        (ex.: Nominatim, cujo robots.txt bloqueia /search para rastreadores, mas cuja Usage Policy permite
        consultas identificadas a 1 req/s). Páginas HTML nunca usam este modo.
        """
        if not api and not self._pode_acessar(url):
            raise BloqueadoPorRobots(f"robots.txt proíbe {url}")
        dominio = urlparse(url).netloc
        erro: Exception | None = None
        for tentativa in range(1, self.tentativas + 1):
            self._esperar(dominio, intervalo)
            try:
                r = self.sessao.get(url, params=params, timeout=self.timeout, headers=headers)
                if any(m in r.content[:4000] for m in MARCAS_CAPTCHA):
                    raise BloqueadoPorCaptcha(f"CAPTCHA anti-robô em {url}")
                if r.status_code in (429, 500, 502, 503, 504):
                    raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
                r.raise_for_status()
                return r
            except (requests.RequestException, BloqueadoPorCaptcha) as e:
                erro = e
                espera = 5 * (3 ** (tentativa - 1))  # 5, 15, 45, 135 s
                log.warning("tentativa %d/%d falhou para %s: %s (aguardando %ds)",
                            tentativa, self.tentativas, url, e, espera)
                if tentativa < self.tentativas:
                    time.sleep(espera)
        assert erro is not None
        raise erro


def cliente_do_config(config: dict) -> ClienteHTTP:
    h = config.get("http", {})
    return ClienteHTTP(
        user_agent=config["projeto"]["user_agent"],
        timeout=h.get("timeout_segundos", 60),
        intervalo=h.get("intervalo_minimo_por_dominio_segundos", 2),
        tentativas=h.get("tentativas", 4),
        respeitar_robots=h.get("respeitar_robots", True),
    )
