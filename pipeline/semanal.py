#!/usr/bin/env python3
"""Ciclo semanal completo:  bajar PDF nuevos de Educaragón  ->  leerlos  ->  subirlos a Supabase.

    python3 semanal.py                 # baja y procesa los ultimos 21 dias (no sube nada)
    python3 semanal.py --subir         # ademas sube a Supabase (necesita SUPABASE_URL y SUPABASE_SERVICE_KEY)
    python3 semanal.py --pdfs CARPETA  # no descarga: procesa una carpeta de PDF que ya tengas
    python3 semanal.py --subir --solo-novedades   # reintento de la tarde: solo sube si Educaragón ha publicado algo que aún no está

Requisitos: Python 3.9+, pypdf (pip install pypdf) y pdftotext/pdfinfo de Poppler.
Los PDF (con nombres de personas) se guardan en una carpeta temporal y NO se suben a ningún sitio.
Con --subir, además:
  · lee los PDF que el administrador haya subido desde la web (bucket privado «aragon-pdf») y los borra al terminar;
  · envía los avisos de la app a quien tenga centros favoritos con novedades (avisos.py; necesita «pip install cryptography»);
  · guarda en una tabla PRIVADA de Supabase los candidatos del curso (nombre normalizado y puesto en la lista), para que cada
    persona pueda encontrar sus listas escribiendo su nombre. Esa tabla no la puede leer la web.
"""
import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cargar_supabase  # noqa: E402
import subidos  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))


def ejecutar(args, **kw):
    print("$", " ".join(args), flush=True)
    return subprocess.run([sys.executable, "-u"] + args, **kw)


def hora_aragon():
    """«15:03» en hora de Aragón (para el resumen de cada ejecución)."""
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("Europe/Madrid")).strftime("%H:%M")
    except Exception:
        return dt.datetime.now(dt.timezone.utc).strftime("%H:%M UTC")


def resumen(texto):
    """Una linea en la pagina de la ejecucion de GitHub (Actions), para ver de un vistazo que ha hecho el robot sin abrir el registro."""
    print(texto, flush=True)
    ruta = os.environ.get("GITHUB_STEP_SUMMARY")
    if ruta:
        try:
            with open(ruta, "a", encoding="utf-8") as f:
                f.write(texto + "\n\n")
        except OSError:
            pass


def novedades(salida, base, clave):
    """Compara lo recien leido con lo que ya hay en Supabase y devuelve la lista de novedades (vacia = nada nuevo).
    Es novedad un acto que aun no esta, o uno que ya estaba pero ahora trae mas (p. ej. le ha llegado la adjudicacion).
    Usa los mismos criterios que cargar_supabase.no_empeorar, asi que lo que aqui no sea novedad tampoco cambiaria nada al subirlo."""
    cargar = lambda n: json.load(open(os.path.join(salida, n + ".json"), encoding="utf-8"))
    actos = cargar("actos")
    ids = {x["acto"] for x in actos}
    previos = {x["acto"]: x for x in cargar_supabase.leer_existentes(base, clave, "actos", ids)}
    out = []
    for x in sorted(actos, key=lambda x: x["acto"]):
        p = previos.get(x["acto"])
        if p is None:
            out.append(f"acto nuevo {x['acto']}")
        elif cargar_supabase.puntuacion_acto(x) > cargar_supabase.puntuacion_acto(p):
            out.append(f"acto {x['acto']} con más datos")
    if os.path.exists(os.path.join(salida, "ultimo_llamado.json")):
        clave_u = lambda f: (f["acto"], f["cuerpo_cod"], f["esp"])
        ultimo = [u for u in cargar("ultimo_llamado") if u["acto"] in ids]
        previos_u = {clave_u(u): u for u in cargar_supabase.leer_existentes(base, clave, "ultimo_llamado", ids)}
        mejores = [u for u in ultimo if clave_u(u) not in previos_u or cargar_supabase.puntuacion_ultimo(u) > cargar_supabase.puntuacion_ultimo(previos_u[clave_u(u)])]
        if mejores:
            out.append(f"{len(mejores)} listas con el último llamado nuevo o más completo")
    return out


def enviar_avisos():
    """Avisos en la app (vacantes nuevas y adjudicaciones en los centros favoritos y listas). Si falla no se para nada: se reintenta en la siguiente ejecución."""
    if ejecutar([os.path.join(AQUI, "avisos.py")]).returncode:
        print("AVISO: no se han podido enviar los avisos de la app (los datos sí se han subido). Se reintentará en la próxima ejecución.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dias", type=int, default=21, help="cuantos dias hacia atras buscar (def. 21)")
    ap.add_argument("--pdfs", help="carpeta de PDF ya descargados (omite la descarga)")
    ap.add_argument("--salida", help="carpeta para los JSON (por defecto una temporal)")
    ap.add_argument("--subir", action="store_true", help="sube el resultado a Supabase")
    ap.add_argument("--solo-novedades", action="store_true",
                    help="con --subir: si Educaragón no ha publicado nada que no esté ya en Supabase, no sube nada (solo reintenta los avisos pendientes) y termina bien")
    a = ap.parse_args()

    if shutil.which("pdftotext") is None:
        sys.exit("Falta pdftotext (Poppler). Linux: sudo apt install poppler-utils · Windows: winget install oschwartz10612.Poppler")
    tmp = tempfile.mkdtemp(prefix="interinos_aragon_")
    pdfs = a.pdfs or os.path.join(tmp, "pdfs")
    salida = a.salida or os.path.join(tmp, "json")
    os.makedirs(salida, exist_ok=True)

    subidos_admin = []
    if not a.pdfs:
        desde = (dt.date.today() - dt.timedelta(days=a.dias)).isoformat()
        # el robot sale con codigo 1 si alguna pagina falla; lo importante es si llego algun PDF
        ejecutar([os.path.join(AQUI, "descargar_educaragon.py"), "--salida", pdfs, "--desde", desde])
        if a.subir:
            subidos_admin = subidos.bajar(pdfs)
    n = sum(f.lower().endswith(".pdf") for _, _, fs in os.walk(pdfs) for f in fs) if os.path.isdir(pdfs) else 0
    print(f"PDF disponibles: {n}")
    if n == 0:
        resumen(f"⚠️ {hora_aragon()} (hora de Aragón) · Educaragón no ha respondido (o ha cambiado sus páginas): no se ha podido bajar ningún PDF. "
                "No se ha tocado nada de la web. Suele ser un corte temporal de su servidor: la siguiente pasada lo vuelve a intentar.")
        sys.exit("No se ha descargado ningun PDF (Educaragon no responde o ha cambiado las paginas). Nada que procesar.")

    personas = os.path.join(tmp, "privado", "personas.json")     # NUNCA dentro de web/: lleva nombres
    r = ejecutar([os.path.join(AQUI, "procesar.py"), pdfs, "--salida", salida, "--desde", ""] + (["--personas", personas] if a.subir else []))
    if r.returncode:
        sys.exit("Fallo al leer los PDF.")
    if a.subir and a.solo_novedades:
        base, clave = cargar_supabase.conexion()
        if not base or not clave:
            sys.exit("Faltan las variables SUPABASE_URL y SUPABASE_SERVICE_KEY (ver README, paso 4).")
        motivos = ["hay PDF subidos por el administrador desde la web"] if subidos_admin else novedades(salida, base, clave)
        if not motivos:
            resumen(f"⏸ {hora_aragon()} (hora de Aragón) · Sin novedades: Educaragón no ha publicado nada que no esté ya en la web. No se ha cambiado nada.")
            enviar_avisos()     # por si algún aviso quedó sin enviar en la ejecución anterior
            if not a.pdfs:
                shutil.rmtree(pdfs, ignore_errors=True)
            shutil.rmtree(os.path.dirname(personas), ignore_errors=True)
            print("Terminado.")
            return
        resumen(f"✅ {hora_aragon()} (hora de Aragón) · Novedades: " + "; ".join(motivos[:8]) + (f" y {len(motivos) - 8} más" if len(motivos) > 8 else "") + ". Se suben a la web.")
    if a.subir:
        r = ejecutar([os.path.join(AQUI, "cargar_supabase.py"), salida] + (["--personas", personas] if os.path.exists(personas) else []))
        if r.returncode:
            sys.exit("Fallo al subir a Supabase.")
        subidos.borrar(subidos_admin)     # ya procesados: fuera del bucket
        enviar_avisos()
        if not a.solo_novedades:
            resumen(f"✅ {hora_aragon()} (hora de Aragón) · Descarga completa: datos subidos a la web.")
    else:
        print("JSON en", salida, "(usa --subir para enviarlos a Supabase)")
    if not a.pdfs:
        shutil.rmtree(pdfs, ignore_errors=True)   # no dejar nombres de personas en disco
    shutil.rmtree(os.path.dirname(personas), ignore_errors=True)
    print("Terminado.")


if __name__ == "__main__":
    main()
