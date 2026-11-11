#!/usr/bin/env python3
"""
Robot de descarga de convocatorias de interinos de Aragon (Educaragon).

Que hace
  1. Lee las 4 paginas oficiales (oferta y adjudicacion semanal, Maestros y
     Secundaria) y baja todos los PDF con fecha que enlazan.
  2. Recupera el historico: Educaragon sustituye los enlaces de las paginas cada
     semana, pero los PDF siguen en el servidor. El robot prueba los nombres de
     archivo de cada dia desde --desde hasta hoy (los 404 son rapidos).
  3. Comprueba la cabecera de cada PDF (contador del acto, p. ej. "PRI - 2026 - 34",
     y fecha). Los nombres se reutilizan entre cursos (CANDIDATOS-POR-ESPECIALIDAD+20_10
     puede ser de 2025), asi que cada archivo se guarda segun la fecha de SU cabecera.
  4. No duplica: guarda el SHA-256 de lo ya bajado y un manifiesto CSV.

Uso
  pip install pypdf
  python descargar_convocatorias_aragon.py                  # todo desde el 25/08/2026
  python descargar_convocatorias_aragon.py --sin-historico  # solo lo publicado ahora (rapido)
  python descargar_convocatorias_aragon.py --desde 2025-09-01 --salida D:\\Interinos

Carpeta de salida (por defecto ~/InterinosAragon):
  maestros/2026-10-22/CANDIDATOS-POR-ESPECIALIDAD 22_10.pdf
  secundaria/2026-10-19/Candidatos oferta 19-10-2026.pdf
  _sin_verificar/...        PDF cuya cabecera no se pudo leer
  _manifiesto.csv           una fila por archivo nuevo
  _estado.json              memoria del robot (no lo borres si quieres ejecuciones rapidas)

Aviso: los PDF de candidatos y adjudicados contienen nombres y NIF de personas.
Son para tu archivo personal; si publicas una web, no los republiques tal cual.
"""
import argparse
import csv
import datetime as dt
import email.utils
import hashlib
import html
import io
import json
import re
import ssl
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:  # se avisa en main()
    PdfReader = None

BASE = "https://educa.aragon.es"
GRUPO = 20126
USER_AGENT = "Mozilla/5.0 (compatible; ArchivoInterinosAragon/1.0; uso personal)"
VENTANA_RECHEQUEO = 10  # dias: los 404 de fechas mas recientes se vuelven a probar

# Paginas oficiales que se leen en cada ejecucion
PAGINAS = {
    "maestros": ["/-/oferta-semanal-maestros", "/-/adjudicacion-semanal-maestros",
                 "/web/guest/-/OFERTA%20VACANTES%20EXTRAORDINARIAS1"],
    "secundaria": ["/-/oferta-semanal-sec", "/-/adjudicacion-semanal-sec-1"],
}

# Patrones de nombre para el historico (titulo base + fecha + sufijo)
HISTORICO = {
    "maestros": {
        "fecha": "%d_%m",
        "carpetas": ["215241", "0", "216771"],
        "sufijos": ["", " (1)"],
        "titulos": [
            "CANDIDATOS-POR-ESPECIALIDAD", "RESOLUCION-OFERTA", "VACANTES-ORDINARIAS",
            "RESOLUCION-OFERTA SINGULARES", "VACANTES-SINGULARIZADAS",
            "CANDIDATOS PRI", "CANDIDATOS EF", "CANDIDATOS FF",
            "CANDIDATOS COLABORADOR BILINGÜE", "CANDIDATOS VACANTES BILINGÜES",
            "RESOLUCION-ADJUDICACION", "ADJUDICADOS-POR-ESPECIALIDAD", "ADJUDICADOS-ALFABETICO",
            "EFECTOS-LISTA", "RESOLUCION-ADJUDICACION SINGULARES", "ADJUDICADOS-SINGULARES",
            "VACANTES-SINGULARES ANULADAS", "VACANTES-SINGULARES-NO-ADJUDICADAS",
            # extraordinarias de Maestros: nombres supuestos (no confirmados)
            "VACANTES-EXTRAORDINARIAS", "CANDIDATOS VACANTES EXTRAORDINARIAS",
            "RESOLUCION-OFERTA EXTRAORDINARIAS",
            "ADJUDICADOS-EXTRAORDINARIAS", "RESOLUCION-ADJUDICACION EXTRAORDINARIAS",
        ],
    },
    "secundaria": {
        "fecha": "%d-%m-%Y",
        "carpetas": ["0"],
        "sufijos": [""],
        "titulos": [
            "Candidatos oferta", "Candidatos Oferta", "Listado Candidatos por especialidad",
            "Vacantes Oferta", "Vacantes oferta", "Vacantes oferta singular",
            "Resolución", "Vacantes Oferta Singular", "Resolución Adjudicación",
            "Vacantes adjudicadas orden alfabético",
            "Vacantes adjudicadas por cuerpo y especialidad", "Vacantes no adjudicadas",
            "Vacantes anuladas", "Efectos en lista", "Vacantes singulares adjudicadas",
            "Vacantes extraordinarias", "Vacantes extraordinarias sin requisito máster",
            # Educaragon escribe estos nombres con erratas; se prueban tal cual
            "Vacantes extraordinairas", "Vacantes extraordinairas sin requisito máster",
            "Vacantes extraordinrias adjudicadas con y sin requisito máster",
            "Vacantes extraordinarias adjudicadas con y sin requisito máster",
        ],
    },
}

# ---- Inicio de curso (julio-septiembre): paginas y patrones para el robot de inicio de curso ----
INICIO_PAGINAS = {
    "inicio_maestros": [
        "/-/inicio%20curso%20funcionarios%20interinos%201",
        "/-/inicio%20curso%20funcionarios%20carrera",
        "/web/guest/-/INICIO%20CURSO%20PERSONAL%20FUNCIONARIO%20EN%20PR%C3%81CTICAS",
        "/-/inicio-curso-colaboradores",
    ],
    "inicio_secundaria": [
        "/-/inicio-curso-pes-funcionario-interinos",
        "/-/inicio-curso-pes-funcionario-carrera",
        "/-/inicio-curso-func.-obtienen-plaza-concurso-de-m%C3%89ritos-y-pr%C3%81cticas",
        "/-/pes-perfil-aragones",
    ],
}
INICIO_HISTORICO = {
    "inicio_maestros": {
        "fecha": "%d_%m", "carpetas": ["315901", "318037", "215241"], "sufijos": [""],
        "titulos": ["VACANTES", "CANDIDATOS", "VACANTES-OFERTADAS", "PERSONAL CANDIDATO",
                    "VACANTES-ORDINARIAS", "CANDIDATOS-POR-ESPECIALIDAD", "RESOLUCION-OFERTA",
                    "ADJUDICADOS-ALFABETICO", "ADJUDICADOS-POR-CENTRO", "ADJUDICADOS-POR-COLECTIVO",
                    "ADJUDICADOS-POR-ESPECIALIDAD", "VACANTES-ANULADAS", "RESOLUCION-ADJUDICACION"],
    },
    "inicio_secundaria": {
        "fecha": "%d-%m-%Y", "carpetas": ["0"], "sufijos": [""],
        "titulos": ["Vacantes oferta", "Candidatos oferta", "Candidatos Oferta", "Resolución", "Resolución adjudicación",
                    "Vacantes adjudicadas por cuerpo y especialidad", "Vacantes no adjudicadas"],
    },
}

# Enlaces de las paginas que NO interesan (ayudas, normativa...)
RE_IGNORAR = re.compile(r"ayuda|instrucciones|anexo|normativa|perfiles|solicitud\+?vacantes|a cumplimentar|incompatibilidades|modelo 145|agencia tributaria", re.I)
# Solo se bajan enlaces cuyo nombre lleve una fecha (22_10, 26-10-2026, 16 01 25...)
# Duplicados de otros listados (mismo contenido ordenado por apellido): no hacen falta
RE_PRESCINDIBLE = re.compile(r"alfab[eé]tic", re.I)
RE_TIENE_FECHA = re.compile(r"\d{1,2}[_\-. ]\d{1,2}([_\-. ]\d{2,4})?")

MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
         "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11,
         "diciembre": 12}
RE_ACTO = re.compile(r"\b([A-Z]{3})\s*-\s*(\d{4})\s*-\s*(\d{1,3})\b")
RE_FECHA_ACTO = re.compile(r"FECHA:\s*(\d{2})/(\d{2})/(\d{4})")
RE_FECHA_LARGA = re.compile(r"(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+de\s+(\d{4})", re.I)
RE_FECHA_NUM = re.compile(r"\b(\d{2})/(\d{2})/(\d{4})\b")


def sin_tildes(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def identificar(datos):
    """Devuelve (acto, fecha) leyendo la primera pagina del PDF. Cualquiera puede ser None."""
    try:
        texto = PdfReader(io.BytesIO(datos)).pages[0].extract_text() or ""
    except Exception:
        return None, None
    m = RE_ACTO.search(texto)
    acto = f"{m.group(1)}-{m.group(2)}-{int(m.group(3))}" if m else None
    fecha = None
    try:
        m = RE_FECHA_ACTO.search(texto)
        if m:
            fecha = dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        else:
            for m in RE_FECHA_LARGA.finditer(texto):
                mes = MESES.get(sin_tildes(m.group(2)).lower())
                if mes:
                    fecha = dt.date(int(m.group(3)), mes, int(m.group(1)))
                    break
            if fecha is None:
                m = RE_FECHA_NUM.search(texto)
                if m:
                    fecha = dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        fecha = None
    return acto, fecha


def fecha_servidor(valor):
    """Last-Modified HTTP -> date (o None)."""
    try:
        return email.utils.parsedate_to_datetime(valor).date() if valor else None
    except Exception:
        return None


class Robot:
    def __init__(self, salida, base=BASE, workers=4, pausa=0.1, solo_necesarios=True, inseguro=False, solo_regex=None, exige_fecha=True):
        self.exige_fecha = exige_fecha
        self.solo_re = re.compile(solo_regex, re.I) if solo_regex else None
        self.solo_necesarios = solo_necesarios
        self.ultimo_error = ""
        self.ctx = ssl._create_unverified_context() if inseguro else None
        self.base = base.rstrip("/")
        self.salida = Path(salida).expanduser()
        self.workers = workers
        self.pausa = pausa
        self.lock = threading.Lock()
        self.hoy = dt.date.today()
        self.salida.mkdir(parents=True, exist_ok=True)
        self.f_estado = self.salida / "_estado.json"
        self.f_manifiesto = self.salida / "_manifiesto.csv"
        self.estado = {"urls": {}, "hashes": {}}
        if self.f_estado.exists():
            try:
                self.estado = json.loads(self.f_estado.read_text(encoding="utf-8"))
            except Exception:
                print("Aviso: _estado.json ilegible, se empieza de cero.")
        self.nuevos, self.repetidos, self.otros_anios, self.sin_verificar = [], 0, 0, 0
        self.errores = []
        self.sin_red = 0

    # ---------- red ----------
    def pedir(self, url):
        """GET con reintentos. Devuelve (status, bytes, fecha Last-Modified o None).
        status 0 = fallo de red."""
        esperas = [5, 15, 30, 60]          # Educaragón a veces corta la conexión unos minutos: se insiste con paciencia
        for intento in range(len(esperas) + 1):
            time.sleep(self.pausa)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=40, context=self.ctx) as r:
                    return r.status, r.read(), fecha_servidor(r.headers.get("Last-Modified"))
            except urllib.error.HTTPError as e:
                if e.code in (404, 410):
                    return 404, b"", None
                if e.code in (429, 500, 502, 503, 504) and intento < len(esperas):
                    time.sleep(esperas[intento])
                    continue
                return e.code, b"", None
            except Exception as e:
                self.ultimo_error = f"{type(e).__name__}: {e}"
                if intento < len(esperas):
                    print(f"  Educaragón no responde ({type(e).__name__}); reintento en {esperas[intento]} s…", flush=True)
                    time.sleep(esperas[intento])
        with self.lock:
            self.sin_red += 1
        return 0, b"", None

    # ---------- guardado ----------
    def guardar(self, cuerpo, url, titulo, datos, esperada=None, servidor=None):
        sha = hashlib.sha256(datos).hexdigest()
        with self.lock:
            if sha in self.estado["hashes"]:
                self.repetidos += 1
                return "repetido"
        acto, fecha = identificar(datos)
        estado_f = "ok"
        if fecha is None and servidor is not None:
            # cabecera ilegible: se usa la fecha de subida (Last-Modified) del servidor
            fecha, estado_f = servidor, "fecha_servidor"
        if fecha is None:
            estado_f, carpeta = "sin_verificar", self.salida / "_sin_verificar" / cuerpo
        else:
            carpeta = self.salida / cuerpo / fecha.isoformat()
            if esperada is not None:
                dias = (esperada - fecha).days
                # la fecha del acto precede (0-7 dias) a la del nombre de archivo;
                # la de subida del servidor puede caer unos dias a cada lado
                if estado_f == "fecha_servidor":
                    valida = abs(dias) <= 7
                else:
                    valida = fecha.year == esperada.year and 0 <= dias <= 7
                if not valida:
                    estado_f = "otro_anio"  # nombre reutilizado: es de otro curso
        nombre = re.sub(r'[<>:"/\\|?*]', "_", titulo).strip()
        if not nombre.lower().endswith(".pdf"):
            nombre += ".pdf"
        with self.lock:
            carpeta.mkdir(parents=True, exist_ok=True)
            ruta = carpeta / nombre
            if ruta.exists():
                ruta = carpeta / f"{ruta.stem}_{sha[:8]}.pdf"
            ruta.write_bytes(datos)
            rel = ruta.relative_to(self.salida).as_posix()
            self.estado["hashes"][sha] = rel
            nuevo = not self.f_manifiesto.exists()
            with open(self.f_manifiesto, "a", newline="", encoding="utf-8-sig") as f:
                w = csv.writer(f)
                if nuevo:
                    w.writerow(["descargado", "cuerpo", "fecha_acto", "acto", "estado",
                                "bytes", "sha256", "ruta", "url"])
                w.writerow([dt.datetime.now().isoformat(timespec="seconds"), cuerpo,
                            fecha.isoformat() if fecha else "", acto or "", estado_f,
                            len(datos), sha, rel, url])
            self.nuevos.append((cuerpo, fecha, acto, rel, estado_f))
            print(f"  Descargado: {rel}", flush=True)
            if estado_f == "otro_anio":
                self.otros_anios += 1
            elif estado_f == "sin_verificar":
                self.sin_verificar += 1
        return estado_f

    def guardar_estado(self):
        with self.lock:
            tmp = self.f_estado.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.estado, ensure_ascii=False, indent=0), encoding="utf-8")
            tmp.replace(self.f_estado)

    # ---------- 1) paginas oficiales ----------
    def enlaces_pagina(self, ruta_pagina):
        status, datos, _ = self.pedir(self.base + urllib.parse.quote(ruta_pagina, safe="/%-._~"))
        if status != 200:
            self.errores.append(f"No se pudo leer {ruta_pagina} (HTTP {status})")
            return []
        pagina = datos.decode("utf-8", errors="replace")
        enlaces = []
        for href in re.findall(r'href="([^"]*?/documents/\d+/\d+/[^"]+)"', pagina):
            href = html.unescape(href)
            url = href if href.startswith("http") else self.base + href
            partes = urllib.parse.urlsplit(url).path.split("/documents/", 1)[1].split("/")
            titulo = urllib.parse.unquote_plus(partes[2])
            if not titulo.lower().endswith(".pdf") or RE_IGNORAR.search(titulo):
                continue
            if self.exige_fecha and not RE_TIENE_FECHA.search(titulo):
                continue
            if self.solo_necesarios and RE_PRESCINDIBLE.search(titulo):
                continue
            if self.solo_re and not self.solo_re.search(titulo):
                continue
            enlaces.append((url, titulo))
        return list(dict.fromkeys(enlaces))

    def descargar_paginas(self):
        tareas = []
        for cuerpo, rutas in PAGINAS.items():
            for ruta in rutas:
                if self.sin_red >= 2 and not tareas:
                    break          # dos páginas seguidas sin conexión: no se insiste con el resto
                for url, titulo in self.enlaces_pagina(ruta):
                    tareas.append((cuerpo, url, titulo))
        if not tareas and self.sin_red:
            hint = ""
            if "CERTIFICATE" in self.ultimo_error.upper() or "SSL" in self.ultimo_error.upper():
                hint = ("\nProbable fallo de certificado de Windows/antivirus. Si es asi, marca la "
                        "casilla 'Ignorar error de certificado' (solo descarga PDF publicos).")
            raise RuntimeError(f"Sin conexion con educa.aragon.es.\nDetalle: {self.ultimo_error}{hint}")
        print(f"Paginas oficiales: {len(tareas)} enlaces con fecha.")

        def una(t):
            cuerpo, url, titulo = t
            with self.lock:
                if url in self.estado["urls"]:
                    return
            status, datos, lm = self.pedir(url)
            if status == 200 and datos[:5] == b"%PDF-":
                self.guardar(cuerpo, url, titulo, datos, servidor=lm)
                with self.lock:
                    self.estado["urls"][url] = {"status": 200}
            else:  # un enlace publicado en la pagina que no baja es un fallo real
                self.errores.append(f"{titulo}: HTTP {status}")

        with ThreadPoolExecutor(self.workers) as ex:
            list(ex.map(una, tareas))
        self.guardar_estado()

    # ---------- 2) historico ----------
    def tareas_historico(self, desde, hasta):
        dia = desde
        while dia <= hasta:
            if dia.weekday() < 5:  # lunes a viernes
                for cuerpo, cfg in HISTORICO.items():
                    f = dia.strftime(cfg["fecha"])
                    for base in cfg["titulos"]:
                        if self.solo_necesarios and RE_PRESCINDIBLE.search(base):
                            continue
                        if self.solo_re and not self.solo_re.search(base):
                            continue
                        for suf in cfg["sufijos"]:
                            titulo = f"{base} {f}{suf}"
                            urls = [f"{self.base}/documents/{GRUPO}/{c}/"
                                    f"{urllib.parse.quote_plus(titulo)}.pdf" for c in cfg["carpetas"]]
                            yield cuerpo, dia, titulo, urls
            dia += dt.timedelta(days=1)

    def sondear(self, tarea):
        cuerpo, dia, titulo, urls = tarea
        antiguo = (self.hoy - dia).days > VENTANA_RECHEQUEO
        for url in urls:
            with self.lock:
                previo = self.estado["urls"].get(url)
            if previo and antiguo:
                continue  # ya probado (404 o ya descargado): se sigue con la siguiente carpeta
            status, datos, lm = self.pedir(url)
            if status == 200 and datos[:5] == b"%PDF-":
                res = self.guardar(cuerpo, url, titulo, datos, esperada=dia, servidor=lm)
                with self.lock:
                    self.estado["urls"][url] = {"status": 200}
                if res != "otro_anio":
                    return  # encontrado el de este curso
                continue  # es de otro curso: se prueba la siguiente carpeta
            if status == 404 or status == 200:
                with self.lock:
                    self.estado["urls"][url] = {"status": 404, "visto": self.hoy.isoformat()}
            elif status != 0:
                self.errores.append(f"{titulo}: HTTP {status}")

    def descargar_historico(self, desde, hasta):
        tareas = list(self.tareas_historico(desde, hasta))
        print(f"Historico: {len(tareas)} nombres que probar entre {desde} y {hasta}...")
        hechas = 0
        with ThreadPoolExecutor(self.workers) as ex:
            for _ in ex.map(self.sondear, tareas):
                hechas += 1
                if hechas % 100 == 0:
                    print(f"  {hechas}/{len(tareas)}  (nuevos: {len(self.nuevos)})")
                    self.guardar_estado()
                if self.sin_red >= 15:
                    print("Demasiados fallos de red seguidos; se detiene.")
                    ex.shutdown(wait=False, cancel_futures=True)
                    break
        self.guardar_estado()

    # ---------- informe ----------
    def informe(self):
        print("\n=== Resumen ===")
        print(f"Archivos nuevos: {len(self.nuevos)}  |  ya tenidos: {self.repetidos}  |  "
              f"de otros cursos: {self.otros_anios}  |  sin verificar: {self.sin_verificar}")
        for e in self.errores[:10]:
            print("  Error:", e)
        print(f"Carpeta: {self.salida}")
        por_acto = {}
        for ruta in self.estado["hashes"].values():
            partes = ruta.split("/")
            if len(partes) == 3 and partes[0] in HISTORICO:
                por_acto.setdefault(partes[0], {}).setdefault(partes[1], 0)
                por_acto[partes[0]][partes[1]] += 1
        for cuerpo, d in por_acto.items():
            recientes = sorted(k for k in d if k >= f"{self.hoy.year}-08-01")
            if recientes:
                print(f"\nActos {cuerpo} desde agosto ({len(recientes)}): " +
                      ", ".join(f"{k[8:]}/{k[5:7]} ({d[k]})" for k in recientes))
        if self.sin_verificar:
            print(f"\n{self.sin_verificar} PDF sin cabecera legible: estan en _sin_verificar/.")
        if self.errores:
            sys.exit(1)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="Descarga convocatorias de interinos de Aragon.")
    ap.add_argument("--salida", default=str(Path.home() / "InterinosAragon"),
                    help="carpeta donde guardar (por defecto ~/InterinosAragon)")
    ap.add_argument("--desde", default="2026-08-25", help="inicio del historico, AAAA-MM-DD")
    ap.add_argument("--hasta", default=None, help="fin del historico (por defecto hoy)")
    ap.add_argument("--sin-historico", action="store_true",
                    help="solo las paginas oficiales (rapido, para ejecutar a diario)")
    ap.add_argument("--solo-historico", action="store_true", help="omite las paginas oficiales")
    ap.add_argument("--todo", action="store_true", help="incluye tambien los listados alfabeticos (duplicados)")
    ap.add_argument("--inseguro", action="store_true", help="no verifica el certificado SSL (solo si falla)")
    ap.add_argument("--workers", type=int, default=4, help="descargas en paralelo (def. 4)")
    ap.add_argument("--base", default=BASE, help=argparse.SUPPRESS)  # para pruebas
    a = ap.parse_args()

    if PdfReader is None:
        sys.exit("Falta la libreria pypdf. Instalala con:  pip install pypdf")

    robot = Robot(a.salida, base=a.base, workers=a.workers, solo_necesarios=not a.todo, inseguro=a.inseguro)
    hasta = dt.date.fromisoformat(a.hasta) if a.hasta else robot.hoy
    try:
        if not a.solo_historico:
            robot.descargar_paginas()
        if not a.sin_historico:
            robot.descargar_historico(dt.date.fromisoformat(a.desde), hasta)
    except KeyboardInterrupt:
        print("\nInterrumpido; se guarda lo hecho.")
    finally:
        robot.guardar_estado()
    robot.informe()


if __name__ == "__main__":
    main()
