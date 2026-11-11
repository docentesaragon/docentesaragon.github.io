#!/usr/bin/env python3
"""Publica en el canal de Telegram de Docentes Aragón un resumen de cada adjudicación semanal nueva.

Lo lanza el robot semanal después de subir los datos (y se puede lanzar a mano con el flujo «Publicar en Telegram»).
Sin nombres ni DNI: solo cifras públicas del acto, las especialidades con más adjudicaciones, el enlace a la web,
la fuente oficial y el aviso de que el proyecto no es oficial.

No repite: guarda en la tabla aragon.telegram_publicados qué actos ya se publicaron (ver supabase/telegram.sql).
Solo publica adjudicaciones recientes (por defecto de los últimos 4 días), para no inundar el canal con el histórico.
Si faltan los datos de Telegram, avisa y termina sin error (el robot semanal no se pone en rojo por esto).

Variables de entorno:
    SUPABASE_URL, SUPABASE_SERVICE_KEY   (las mismas del robot)
    TELEGRAM_BOT_TOKEN                   token que da @BotFather (secreto)
    TELEGRAM_CANAL                       @Docentes_Aragon

Uso:
    python3 telegram_canal.py                    # publica lo que falte
    python3 telegram_canal.py --simulacro        # solo enseña los mensajes (no publica ni guarda nada)
    python3 telegram_canal.py --acto SEC-2026-36 # publica ese acto aunque sea antiguo (si no estaba publicado)
    python3 telegram_canal.py --datos ../web/data --simulacro --acto SEC-2026-36   # pruebas sin Supabase
"""
import argparse
import collections
import datetime as dt
import html
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cargar_supabase  # noqa: E402

WEB = "https://docentesaragon.github.io"
FUENTE = {
    "secundaria": "https://educa.aragon.es/-/adjudicacion-semanal-sec-1",
    "maestros": "https://educa.aragon.es/-/adjudicacion-semanal-maestros",
}
NOMBRE_CUERPO = {"secundaria": "Secundaria, FP y Régimen Especial", "maestros": "Maestros"}
# Etiqueta corta del cuerpo cuando no es el principal del acto (se añade tras la especialidad)
CORTO = {"0592": "EOI", "0593": "Catedráticos Música y AA. EE.", "0594": "Música y AA. EE.",
         "0595": "Artes Plásticas y Diseño", "0596": "Maestros de taller AP y D", "0598": "FP sectores singulares"}
PRINCIPAL = {"secundaria": "0590", "maestros": "0597"}
DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
TOP = 5


# ---------------------------------------------------------------- datos
class Supabase:
    def __init__(self):
        self.base, self.clave = cargar_supabase.conexion()
        if not self.base or not self.clave:
            raise SystemExit("Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY.")

    def get(self, tabla, consulta):
        out = []
        for off in range(0, 200000, 1000):
            url = f"{self.base}/rest/v1/{tabla}?{consulta}&limit=1000&offset={off}"
            _, cuerpo = cargar_supabase.peticion(url, self.clave, "GET")
            lote = json.loads(cuerpo or "[]")
            out.extend(lote)
            if len(lote) < 1000:
                return out

    def actos_adjudicados(self, desde, acto=None):
        filtro = f"acto=eq.{urllib.parse.quote(acto)}" if acto else f"fecha_adjudicacion=gte.{desde}"
        return self.get("actos", f"select=*&tiene_adjudicadas=is.true&{filtro}&order=fecha_adjudicacion.asc,acto.asc")

    def adjudicadas(self, acto):
        return self.get("vacantes", f"select=cuerpo_cod,esp&acto=eq.{urllib.parse.quote(acto)}&estado=eq.adjudicada")

    def especialidades(self):
        return self.get("especialidades", "select=cuerpo_cod,cod,nombre")

    def publicados(self, actos):
        if not actos:
            return set()
        lista = ",".join(urllib.parse.quote(a) for a in actos)
        return {f["acto"] for f in self.get("telegram_publicados", f"select=acto&acto=in.({lista})")}

    def guardar(self, acto, mensaje_id):
        url = f"{self.base}/rest/v1/telegram_publicados?on_conflict=acto"
        cargar_supabase.peticion(url, self.clave, "POST", [{"acto": acto, "mensaje_id": mensaje_id}],
                                 {"Prefer": "resolution=merge-duplicates,return=minimal"})


class Local:
    """Lee los JSON de web/data (solo para pruebas y simulacros)."""
    def __init__(self, carpeta):
        self.c = carpeta
        self.hechos = set()

    def _j(self, n):
        with open(os.path.join(self.c, n + ".json"), encoding="utf-8") as f:
            return json.load(f)

    def actos_adjudicados(self, desde, acto=None):
        xs = [a for a in self._j("actos") if a.get("tiene_adjudicadas") and ((a["acto"] == acto) if acto else (a.get("fecha_adjudicacion") or "") >= desde)]
        return sorted(xs, key=lambda a: (a.get("fecha_adjudicacion") or "", a["acto"]))

    def adjudicadas(self, acto):
        curso = next(a["curso"] for a in self._j("actos") if a["acto"] == acto)
        return [v for v in self._j("vacantes_" + curso) if v["acto"] == acto and v["estado"] == "adjudicada"]

    def especialidades(self):
        return self._j("especialidades")

    def publicados(self, actos):
        return {a for a in actos if a in self.hechos}

    def guardar(self, acto, mensaje_id):
        self.hechos.add(acto)


# ---------------------------------------------------------------- mensaje
# Educaragón escribe muchas especialidades sin tildes; se ponen al publicar (solo palabras que existen en las listas)
TILDES = {w.replace("Á", "A").replace("É", "E").replace("Í", "I").replace("Ó", "O").replace("Ú", "U"): w for w in (
    "ACORDEÓN ADMINISTRACIÓN ALEMÁN ANÁLISIS ASESORÍA AUTOMÁTICOS BIOLOGÍA CÁMARA CATALÁN CERÁMICAS CLÍNICOS "
    "COMPOSICIÓN COMUNICACIÓN CONFECCIÓN CONSERVACIÓN DIAGNÓSTICOS DIRECCIÓN ECONOMÍA EDIFICACIÓN EDUCACIÓN "
    "ELECTRÓNICOS ELECTROTÉCNICOS ENERGÉTICOS ESTAMPACIÓN FABRICACIÓN FILOSOFÍA FÍSICA FOTOGRAFÍA FRANCÉS "
    "GEOGRAFÍA GEOLOGÍA GESTIÓN GRÁFICAS GRÁFICO HOSTELERÍA IMPROVISACIÓN INFORMÁTICA INGLÉS INTERVENCIÓN LATÍN "
    "MATEMÁTICAS MECÁNICA MÚSICA ORGANIZACIÓN ÓRGANO ORIENTACIÓN ORTOPROTÉSICOS PEDAGOGÍA PERCUSIÓN PRODUCCIÓN "
    "QUÍMICA REPRODUCCIÓN RESTAURACIÓN SAXOFÓN TÉCNICAS TECNOLOGÍA TROMBÓN VEHÍCULOS VIOLÍN PÚA").split()}


def bonito(nombre):
    """BIOLOGIA Y GEOLOGIA → Biología y geología (pone las tildes que faltan y deja solo la primera en mayúscula)."""
    palabras = [TILDES.get(w.rstrip(":,.;)"), w.rstrip(":,.;)")) + w[len(w.rstrip(":,.;)")):] for w in (nombre or "").strip().split()]
    return " ".join(palabras).capitalize()


def fecha_larga(iso):
    d = dt.date.fromisoformat(iso)
    return f"{DIAS[d.weekday()].capitalize()} {d.strftime('%d/%m/%Y')}"


def mensaje(acto, adjudicadas, nombres):
    e = html.escape
    cuerpo = acto.get("cuerpo") or ""
    total = acto.get("n_adjudicadas") or len(adjudicadas)
    sing = acto.get("n_singulares_adjudicadas") or 0
    sin = acto.get("n_no_adjudicadas") or 0
    lineas = [f"📢 <b>Adjudicación semanal · {e(NOMBRE_CUERPO.get(cuerpo, cuerpo.capitalize()))}</b>",
              e(fecha_larga(acto["fecha_adjudicacion"])), ""]
    detalle = f" ({total - sing} ordinarias y {sing} singulares)" if sing else ""
    lineas.append(f"✅ <b>{total}</b> {'vacante adjudicada' if total == 1 else 'vacantes adjudicadas'}{e(detalle)}.")
    if sin:
        lineas.append(f"⚪ {sin} {'quedó' if sin == 1 else 'quedaron'} sin adjudicar.")
    cuenta = collections.Counter((v["cuerpo_cod"], v["esp"]) for v in adjudicadas)
    if cuenta:
        lineas += ["", "<b>Especialidades con más adjudicaciones</b>"]
        principal = PRINCIPAL.get(cuerpo)
        top = sorted(cuenta.items(), key=lambda kv: (-kv[1], nombres.get(kv[0], kv[0][1])))[:TOP]
        for (cc, esp), n in top:
            nom = bonito(nombres.get((cc, esp), esp))
            if cc != principal and cc in CORTO:
                nom += f" ({CORTO[cc]})"
            lineas.append(f"• {e(nom)}: {n}")
    lineas += ["",
               f"🔎 Hasta dónde llegó cada lista y qué centros salieron: {WEB}/#/semana",
               f"📄 Fuente oficial: {FUENTE.get(cuerpo, 'https://educa.aragon.es')}",
               "",
               "<i>Docentes Aragón es un proyecto independiente y no oficial. Manda siempre el documento oficial.</i>"]
    return "\n".join(lineas)


# ---------------------------------------------------------------- Telegram
def enviar(token, canal, texto):
    datos = urllib.parse.urlencode({"chat_id": canal, "text": texto, "parse_mode": "HTML",
                                    "disable_web_page_preview": "true"}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=datos)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.loads(r.read().decode())
    except urllib.error.HTTPError as err:
        try:
            res = json.loads(err.read().decode())
        except Exception:
            res = {"ok": False, "description": f"HTTP {err.code}"}
    if not res.get("ok"):
        desc = res.get("description", "error desconocido")
        pista = ""
        if "chat not found" in desc:
            pista = " Revisa el secreto TELEGRAM_CANAL (debe ser @Docentes_Aragon) y que el robot sea administrador del canal."
        elif "Unauthorized" in desc:
            pista = " El token no es válido: revisa el secreto TELEGRAM_BOT_TOKEN."
        elif "not enough rights" in desc or "administrator" in desc:
            pista = " El robot no tiene permiso para publicar: hazlo administrador con «Publicar mensajes»."
        raise RuntimeError(f"Telegram no ha aceptado el mensaje: {desc}.{pista}")
    return res["result"]["message_id"]


def resumen(texto):
    print(texto)
    ruta = os.environ.get("GITHUB_STEP_SUMMARY")
    if ruta:
        with open(ruta, "a", encoding="utf-8") as f:
            f.write(texto + "\n\n")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--simulacro", action="store_true", help="enseña los mensajes sin publicar ni guardar nada")
    ap.add_argument("--acto", help="publica solo este acto (aunque sea antiguo)")
    ap.add_argument("--dias", type=int, default=4, help="antigüedad máxima de la adjudicación (def. 4 días)")
    ap.add_argument("--datos", help="carpeta con los JSON de web/data (pruebas, sin Supabase)")
    ap.add_argument("--hoy", help="fecha de hoy AAAA-MM-DD (pruebas)")
    a = ap.parse_args(argv)

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    canal = os.environ.get("TELEGRAM_CANAL", "").strip()
    if canal and not canal.startswith(("@", "-")):
        canal = "@" + canal.split("/")[-1]           # admite «Docentes_Aragon» o «https://t.me/Docentes_Aragon»
    if not a.simulacro and (not token or not canal):
        resumen("ℹ️ Telegram: faltan los secretos TELEGRAM_BOT_TOKEN y/o TELEGRAM_CANAL; no se publica nada.")
        return 0

    fuente = Local(a.datos) if a.datos else Supabase()
    hoy = dt.date.fromisoformat(a.hoy) if a.hoy else dt.date.today()
    desde = (hoy - dt.timedelta(days=a.dias)).isoformat()
    actos = [x for x in fuente.actos_adjudicados(desde, a.acto) if (x.get("n_adjudicadas") or 0) > 0]
    if a.acto and not actos:
        resumen(f"⚠️ Telegram: no encuentro el acto {a.acto} con adjudicaciones.")
        return 1
    hechos = fuente.publicados([x["acto"] for x in actos])
    pendientes = [x for x in actos if x["acto"] not in hechos]
    if not pendientes:
        resumen("📭 Telegram: nada nuevo que publicar.")
        return 0
    nombres = {(e["cuerpo_cod"], e["cod"]): e["nombre"] for e in fuente.especialidades()}
    errores = 0
    for x in pendientes:
        texto = mensaje(x, fuente.adjudicadas(x["acto"]), nombres)
        if a.simulacro:
            resumen(f"🧪 Simulacro (no se publica) · {x['acto']}:\n\n```\n{texto}\n```")
            continue
        try:
            mid = enviar(token, canal, texto)
        except Exception as err:          # un fallo no debe impedir los demás ni parar el robot
            errores += 1
            resumen(f"❌ Telegram · {x['acto']}: {err}")
            continue
        fuente.guardar(x["acto"], mid)
        resumen(f"📣 Telegram: publicado {x['acto']} en {canal}.")
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
