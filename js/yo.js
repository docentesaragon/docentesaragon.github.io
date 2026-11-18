// Sección "Mi seguimiento": tu posición en la lista y tus destinos preferidos.
// Con Supabase configurado es el área personal de pago (cuenta con correo y contraseña + pase hasta el 30/06); sin él, funciona en local para pruebas.
import { h, llenar, miles, fmtCorta, fmtDMA, claveDe, parseClave, textoClave, localidadBonita, centroBonito, bonito, leerLocal, guardarLocal } from "./util.js";
import { D, YO, guardarYo, nombreCuerpo, actosDe } from "./datos.js";
import { CUENTA, entrarConGoogle, entrarConCorreo, crearCuenta, recuperarContrasena, nuevaContrasena, salir, pagoHecho,
  diasDePrueba, misReferidos, usarCodigo, enlacesInvitar, codigoPendiente, guardarNombre, buscarMisListas, guardarAhora, ERRORES_NOMBRE, nombreValido, TEXTO_SYNC } from "./cuenta.js";
import { productoActual, cursoDeProducto, compraDisponible, precioEnPlay, comprarPase, restaurarCompra } from "./compra.js";
import { situacion, nombreEspBonito } from "./comun.js";
import { filtrar } from "./vacantes.js";
import { ir, leerRuta } from "./ruta.js";
import { tarjetaProbabilidad } from "./probabilidad.js";
import { bloqueCasa } from "./casa.js";
import { cargarMunicipios, km, textoKm, textoTiempo, coordsLocalidad, enlacesRuta, selectorMunicipio } from "./distancia.js";
import { esFavorito, alternarFavorito, quitarFavorito } from "./favoritos.js";

const URL_PADDOC = "https://aplicaciones.aragon.es/epdtp/welcome";     // solicitud de destinos de Educaragón
const borrador = { cuerpo_cod: "0597", esp: "", lista: "1", fecha: "", bloque: "", orden: "" };
let confirmandoBorrado = false;
let verCompra = false;     // true si quien está en prueba (o ya tiene pase) ha pulsado «Activar mi pase»
let manualAbierto = false; // solo administración: «Cambiar mis especialidades a mano» desplegado (#/yo?manual=1)
let busqueda = null;       // resultado de la última búsqueda por nombre: { estado, nombres?, con_dni? }
let buscando = false;
const CLAVE_PASOS = "docentes-aragon:pasos-ocultos";   // «Primeros pasos» ocultados a mano en este dispositivo
let autoLanzada = false;   // la búsqueda automática se intenta una sola vez por carga de la página
const CLAVE_BUSQUEDA = "docentes-aragon:busqueda";   // «ya buscadas hoy» en este dispositivo (solo una fecha y una marca de la cuenta, nada personal)
let lugarActual = null;    // centro o localidad cuya distancia se está mirando: { localidad, centro, cod, provincia } (llega con #/yo?lugar=...)

export function yo(raiz, params) {
  if (params) {      // llega desde la dirección (no es un repintado interno): la tarjeta de distancia solo sale si se pide
    lugarActual = params.lugar ? { localidad: params.lugar, centro: params.centro || "", cod: params.cod || "", provincia: params.prov || "" } : null;
  } else params = {};
  if (params.manual === "1") manualAbierto = true;
  if (!CUENTA.activa) return seguimiento(raiz);               // modo de prueba, sin cuenta
  if (CUENTA.recuperando && CUENTA.estado !== "anonimo") return pantallaEntrada(raiz, "nueva");   // llegó desde el enlace de «he olvidado mi contraseña»
  if (CUENTA.estado === "anonimo") return pantallaEntrada(raiz);
  if (CUENTA.estado === "sin_pase" || verCompra) return pantallaPase(raiz);
  return seguimiento(raiz);
}

function seguimiento(raiz) {
  const ro = !!CUENTA.verComo;                                  // el administrador mira la cuenta de otra persona: solo lectura
  const cuerposConDatos = [...new Set(D.ultimo.map((u) => u.cuerpo_cod))].sort();
  if (!cuerposConDatos.includes(borrador.cuerpo_cod)) borrador.cuerpo_cod = cuerposConDatos[0];
  const espDe = (cod) => [...new Set(D.ultimo.filter((u) => u.cuerpo_cod === cod && (u.convocados || u.clave_ultimo)).map((u) => u.esp))]
    .map((e) => [e, `${e}: ${nombreEspBonito(cod, e)}`]).sort((a, b) => a[1].localeCompare(b[1], "es"));
  const opcEsp = espDe(borrador.cuerpo_cod);
  if (!opcEsp.some(([e]) => e === borrador.esp)) borrador.esp = opcEsp[0]?.[0] || "";

  const error = h("p", { class: "error", id: "yo-error", hidden: true, role: "alert" });
  const campo = (etiqueta, el) => h("label", null, etiqueta, el);
  const formulario = h("form", { id: "form-lista", onsubmit: (e) => {
    e.preventDefault();
    const clave = claveDe({ lista: borrador.lista, fecha: borrador.fecha, bloque: borrador.bloque, orden: borrador.orden });
    if (!clave || !borrador.esp) { error.textContent = "Rellena todos los campos: lista, fecha del bloque, bloque y orden."; error.hidden = false; return; }
    anadirLista({ cuerpo_cod: borrador.cuerpo_cod, esp: borrador.esp, lista: +borrador.lista, fecha: borrador.fecha, bloque: +borrador.bloque, orden: +borrador.orden, clave });
    guardarYo(); Object.assign(borrador, { fecha: "", bloque: "", orden: "" }); yo(raiz);
  } },
  h("details", { class: "ayuda" }, h("summary", null, "¿Dónde encuentro estos datos?"),
    h("p", null, "En cualquier PDF «Candidatos por especialidad» de Educaragón, en la fila con tu nombre y la especialidad que quieras seguir: copia las columnas LISTA, FECHA, BLOQUE y ORDEN BLOQUE. No uses la columna RELACIÓN: cambia cada semana. Tu posición real no cambia de una semana a otra, por eso sirve para seguirte.")),
  h("div", { class: "campos" },
    campo("Cuerpo", h("select", { id: "y-cuerpo", onchange: (e) => { borrador.cuerpo_cod = e.target.value; yo(raiz); } }, cuerposConDatos.map((c) => h("option", { value: c, selected: c === borrador.cuerpo_cod }, bonito(nombreCuerpo(c)))))),
    campo("Especialidad", h("select", { id: "y-esp", onchange: (e) => { borrador.esp = e.target.value; } }, opcEsp.map(([v, t]) => h("option", { value: v, selected: v === borrador.esp }, t)))),
    campo("Lista", h("select", { id: "y-lista", onchange: (e) => { borrador.lista = e.target.value; } }, ["1", "2"].map((v) => h("option", { value: v, selected: v === borrador.lista }, v)))),
    campo("Fecha del bloque", h("input", { type: "date", id: "y-fecha", value: borrador.fecha, onchange: (e) => { borrador.fecha = e.target.value; } })),
    campo("Bloque", h("input", { type: "number", id: "y-bloque", min: 1, value: borrador.bloque, oninput: (e) => { borrador.bloque = e.target.value; } })),
    campo("Orden en el bloque", h("input", { type: "number", id: "y-orden", min: 1, value: borrador.orden, oninput: (e) => { borrador.orden = e.target.value; } })),
    h("button", { type: "submit", class: "boton", id: "y-anadir" }, "Guardar")),
  error);
  // Con cuenta, un proceso automático busca las listas por el nombre de la cuenta: no hay nada que apuntar a mano. Solo la administración conserva este formulario
  // (enlace de Ajustes), y sin cuenta (modo de prueba) es la única forma de apuntar una posición.
  const conManual = !CUENTA.activa || (CUENTA.admin && manualAbierto);
  const manual = h("details", { class: "bloque manual", id: "manual", open: !CUENTA.activa || manualAbierto, ontoggle: (e) => { if (CUENTA.activa) manualAbierto = e.target.open; } },
    h("summary", null, CUENTA.activa ? "Administrador: cambiar mis especialidades a mano" : "Añadir mi posición en una lista"), formulario);

  const seguimientos = YO.listas.map((l) => bloqueLista(l, raiz, ro));
  const cabecera = CUENTA.activa ? cabeceraSaludo(ro)
    : h("div", { class: "cabecera-vista" },
      h("div", { class: "fila-titulo" }, h("h2", null, "Mi seguimiento"), botonPaddoc()),
      h("p", { class: "tenue" }, "Compara tu posición en la lista con hasta dónde llegó cada semana. Lo que escribas aquí se guarda solo en este navegador: no se envía a ningún sitio y la web no te pide nombre ni DNI."));
  llenar(raiz,
    cabecera,
    CUENTA.activa ? [mensajeCuenta(), barraCuenta(raiz), avisoDeAcceso(raiz)] : null,
    CUENTA.activa && !ro ? primerosPasos(raiz) : null,
    lugarActual && !ro ? bloqueLugar(raiz) : null,
    CUENTA.activa && !ro ? bloqueBuscar(raiz) : null,
    ro || !conManual ? null : manual,
    h("div", { class: "dos-col" }, h("div", null, seguimientos.length ? seguimientos : h("p", { class: "vacio", id: "sin-listas" }, CUENTA.activa ? "Todavía no tenemos ninguna lista tuya." : "Todavía no has añadido ninguna lista.")), h("div", null, CUENTA.activa && !ro ? bloqueCasa({ alCambiar: () => yo(raiz) }) : null, bloqueFavoritos(raiz, ro), destinos(raiz, ro))),
    CUENTA.activa && !ro ? avisarAdmin() : null,
    CUENTA.activa ? h("p", { class: "tenue peq", id: "sync-estado", role: "status" }, TEXTO_SYNC[CUENTA.sync] || "") : borrado(raiz));
  if (CUENTA.activa && !ro) buscarSola(raiz);
}

/** Botón «Invitar y app gratis» de la cabecera de Mi seguimiento: abre la página de invitar. No sale a quien ya pagó (no tendría premio). */
function botonInvitar() {
  const tipo = CUENTA.pase?.tipo;
  if (tipo === "pago_unico" || tipo === "suscripcion") return null;
  return h("a", { class: "boton boton-invitar", id: "ir-invitar", href: "#/invitar" }, "🎁 Invitar y app gratis");
}

/** Página «Invita a tus compañeros y consigue la app gratis» (#/invitar): la tarjeta con el código y los botones, y cómo funciona. */
export function invitar(raiz) {
  const volver = h("p", { class: "volver" }, h("a", { href: "#/yo", id: "invitar-volver" }, "← Volver a Mi seguimiento"));
  if (!CUENTA.activa) {
    llenar(raiz, volver, h("div", { class: "cabecera-vista" }, h("h2", null, "Invita y consigue la app gratis"),
      h("p", { class: "tenue", id: "invitar-sin-cuenta" }, "Para tener tu código de invitación, entra en Mi seguimiento con tu cuenta.")));
    return;
  }
  const tipo = CUENTA.pase?.tipo;
  const pagado = tipo === "pago_unico" || tipo === "suscripcion";
  llenar(raiz, volver,
    h("div", { class: "cabecera-vista" }, h("h2", { id: "invitar-h" }, "Invita y consigue la app gratis")),
    pagado ? h("p", { class: "tenue", id: "invitar-pagado" }, "Ya tienes tu pase de este curso, así que invitar no te da nada más. Aun así, gracias por recomendar la app.") : tarjetaInvitar(),
    h("div", { class: "bloque", id: "invitar-como" },
      h("h3", null, "Cómo funciona"),
      h("ol", { class: "pasos-invitar" },
        h("li", null, "Comparte tu código con tus compañeros por WhatsApp, Telegram o como quieras."),
        h("li", null, "Cada uno crea su cuenta con tu código y activa su pase del curso."),
        h("li", null, "Cuando 3 lo hayan hecho, tu curso es gratis hasta el 30 de junio.")),
      h("p", { class: "tenue peq" }, "Cada persona puede usar un solo código y solo durante sus primeros 30 días. ",
        h("a", { href: "#/ayuda", id: "invitar-ayuda" }, "Más preguntas en Ayuda"), ".")));
}

function botonPaddoc() {
  return h("a", { class: "boton boton-paddoc", id: "ir-paddoc-directo", href: URL_PADDOC, target: "_blank", rel: "noopener", title: "Abre en otra pestaña la web oficial de Educaragón donde se hace la solicitud de destinos" }, "Ir a PADDOC");
}

/** «María José» / «García López» a partir de «GARCÍA LÓPEZ, MARÍA JOSÉ» (el nombre se escribe como en los listados: apellidos, nombre). */
export function datosNombre(texto) {
  const t = (texto || "").trim().replace(/\s+/g, " ");
  if (!t) return { pila: "", completo: "", iniciales: "" };
  const coma = t.indexOf(",");
  const ape = bonito(coma >= 0 ? t.slice(0, coma).trim() : t), pila = coma >= 0 ? bonito(t.slice(coma + 1).trim()) : "";
  const palabras = (pila ? [pila, ape] : ape.split(" ")).filter(Boolean);
  return { pila, completo: pila ? `${pila} ${ape}` : ape, iniciales: palabras.slice(0, 2).map((x) => x[0].toUpperCase()).join("") };
}

/** Lo primero que se ve en Mi seguimiento: quién eres y en qué especialidades estás (como en DocentsCV). */
function cabeceraSaludo(ro) {
  const nombre = (ro ? CUENTA.verComo?.nombre : CUENTA.perfil?.nombre) || "";
  const { pila, completo, iniciales } = datosNombre(nombre);
  const esps = [...YO.listas].sort((a, b) => (a.cuerpo_cod + a.esp < b.cuerpo_cod + b.esp ? -1 : 1));
  const sinEsp = buscando ? "Buscando tus especialidades…"
    : !nombre ? (ro ? "No ha escrito su nombre." : "Escribe tu nombre más abajo y buscamos tus especialidades solas.")
      : ro ? "Todavía sin especialidades." : "Todavía no sales en ninguna lista de este curso: lo comprobamos solos cada día.";
  return h("div", { class: "cabecera-vista saludo", id: "saludo" },
    nombre ? h("div", { class: "avatar", id: "saludo-iniciales", "aria-hidden": "true" }, iniciales) : null,
    h("div", { class: "saludo-texto" },
      h("h2", { id: "saludo-hola" }, nombre ? (pila ? `Hola, ${pila}` : "Hola") : "Mi seguimiento"),
      nombre ? h("p", { class: "saludo-nombre", id: "saludo-nombre" }, completo) : null,
      h("div", { class: "etiquetas", id: "mis-especialidades" }, esps.length
        ? esps.map((l) => h("span", { class: "chip oro", "data-esp": `${l.cuerpo_cod}|${l.esp}`, title: bonito(nombreCuerpo(l.cuerpo_cod)) }, `${l.esp}: ${nombreEspBonito(l.cuerpo_cod, l.esp)}`))
        : h("span", { class: "tenue peq", id: "sin-especialidades" }, sinEsp))),
    h("div", { class: "saludo-botones" }, botonPaddoc(), ro ? null : botonInvitar()));
}

/** Al final de Mi seguimiento: el nombre y las listas no se tocan a mano; si algo está mal, se avisa a la administración. */
function avisarAdmin() {
  return h("p", { class: "tenue avisar-admin", id: "avisar-admin" }, "¿Tu nombre o alguna de tus listas no es correcta? ",
    h("a", { href: "#/ajustes?reclamar=nombre", id: "avisar-admin-enlace" }, "Avisa a la administración"), " y lo corregimos.");
}

/** Pone (o sustituye) una lista en el seguimiento: una por cuerpo y especialidad. */
function anadirLista(l) {
  YO.listas = YO.listas.filter((x) => !(x.cuerpo_cod === l.cuerpo_cod && x.esp === l.esp));
  YO.listas.push(l);
}

// ---------- «Mis listas»: nombre en las listas + búsqueda automática ----------
const hoy = () => new Date().toISOString().slice(0, 10);
const marcaDeCuenta = () => { let n = 5381; for (const c of CUENTA.email || "") n = ((n * 33) ^ c.charCodeAt(0)) >>> 0; return `${hoy()}:${n}`; };   // fecha + número sin sentido fuera de esta cuenta

/** Al entrar en Mi seguimiento, si la cuenta tiene nombre, busca sola las listas: una vez por carga de la página y, como mucho, una vez al día en este dispositivo. */
function buscarSola(raiz) {
  const perfil = CUENTA.perfil;
  if (autoLanzada || buscando || CUENTA.verComo || CUENTA.estado !== "con_pase" || !perfil?.nombre || perfil.busquedas_restantes === 0) return;
  autoLanzada = true;
  if (leerLocal(CLAVE_BUSQUEDA, "") === marcaDeCuenta()) return;
  lanzarBusqueda(raiz);
}

/** Busca por el nombre de la cuenta (y, si hay homónimos, por las cifras del DNI) y apunta en el seguimiento lo que encuentre. */
async function lanzarBusqueda(raiz, nif = "") {
  buscando = true; yo(raiz);
  const r = await buscarMisListas(nif);
  buscando = false; busqueda = r;
  let hayCambios = false;
  if (r.estado === "ok") {
    const nuevas = [];
    for (const l of r.listas || []) {
      const p = parseClave(l.clave); if (!p) continue;
      const ya = YO.listas.find((x) => x.cuerpo_cod === l.cuerpo_cod && x.esp === l.esp);
      if (ya && ya.clave === l.clave) continue;
      anadirLista({ cuerpo_cod: l.cuerpo_cod, esp: l.esp, lista: p.lista, fecha: p.fecha, bloque: p.bloque, orden: p.orden, clave: l.clave });
      nuevas.push(`${l.esp}: ${nombreEspBonito(l.cuerpo_cod, l.esp)}`);
    }
    hayCambios = nuevas.length > 0;
    if (hayCambios) guardarYo();
    busqueda = hayCambios ? { estado: "anadidas", nombres: nuevas } : { estado: "al_dia" };
  }
  if (leerRuta().vista === "yo") yo(raiz);      // si ya se ha ido a otra pantalla, no se la pisa
  // «Ya buscadas hoy» solo si lo encontrado ya está guardado en la cuenta: si se cierra la página antes de guardarse, la próxima vez se busca de nuevo
  if (r.estado === "no_encontrado" || (r.estado === "ok" && (!hayCambios || await guardarAhora()))) guardarLocal(CLAVE_BUSQUEDA, marcaDeCuenta());
}

function bloqueBuscar(raiz) {
  if (!CUENTA.perfil?.nombre) return formularioNombre(raiz);
  const cuerpo = buscando ? h("p", { class: "tenue", id: "busq-ocupado", role: "status" }, "Buscando tus listas con tu nombre…") : resultadoBusqueda(raiz);
  return cuerpo ? h("div", { class: "bloque buscar", id: "buscar" }, h("h3", null, "Mis listas"), cuerpo) : null;
}

/** Solo si la cuenta aún no tiene nombre. Una vez guardado ya no se cambia desde aquí: si hay un error se avisa a la administración. */
function formularioNombre(raiz) {
  const error = h("p", { class: "error-txt", id: "nom-error", role: "alert", hidden: true });
  const entrada = h("input", { type: "text", id: "nom-in", maxlength: 120, autocomplete: "off", placeholder: "GARCÍA LÓPEZ, MARÍA" });
  return h("form", { class: "bloque buscar", id: "form-nombre", novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!nombreValido(entrada.value)) { error.textContent = ERRORES_NOMBRE.invalido; error.hidden = false; return; }
    e.target.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    const estado = await guardarNombre(entrada.value);
    if (estado !== "ok") { e.target.querySelectorAll("button").forEach((b) => { b.disabled = false; }); error.textContent = ERRORES_NOMBRE[estado] || ERRORES_NOMBRE.error; error.hidden = false; return; }
    busqueda = null; autoLanzada = true;
    await lanzarBusqueda(raiz);
  } },
  h("h3", null, "Encuentra tus listas automáticamente"),
  h("p", { class: "tenue" }, "Escribe tu nombre como sale en los listados de Educaragón (apellidos y nombre) y buscamos solos en qué listas y especialidades estás, cada día."),
  h("label", null, "Mi nombre en las listas", entrada),
  h("div", { class: "campos" }, h("button", { type: "submit", class: "boton", id: "nom-guardar" }, "Guardar y buscar mis listas")),
  h("p", { class: "tenue peq" }, "Revísalo bien antes de guardar: después no se puede cambiar desde aquí, solo avisando a la administración. Solo lo usa tu cuenta y la administración puede verlo para ayudarte. En los listados solo salen las personas a las que ya se ha llamado alguna vez este curso."),
  error);
}

function formularioDni(raiz, texto) {
  const entrada = h("input", { type: "text", id: "busq-dni", maxlength: 12, inputmode: "numeric", autocomplete: "off", placeholder: "1285" });
  return h("form", { class: "dni", id: "busq-dni-form", onsubmit: (e) => { e.preventDefault(); const v = entrada.value.trim(); if (v.length >= 3) lanzarBusqueda(raiz, v); } },
    h("p", null, texto),
    h("div", { class: "campos" }, h("label", null, "Cifras de tu DNI que salen en las listas", entrada), h("button", { type: "submit", class: "boton", id: "busq-dni-go" }, "Buscar con mi DNI")),
    h("p", { class: "tenue peq" }, "En los listados el DNI sale tapado (por ejemplo ***1285**); escribe las cifras que se ven. No las guardamos."));
}

/** Lo que se cuenta de la última búsqueda automática. Si todo ha ido bien y no hay novedades, no se enseña nada (devuelve null). */
function resultadoBusqueda(raiz) {
  const b = busqueda;
  if (!b) return null;
  const aviso = (texto, id) => h("p", { class: "tenue", id, role: "status" }, texto);
  const sin = !YO.listas.length;
  if (b.estado === "anadidas") return aviso(`Hemos encontrado tus listas y las hemos añadido a tu seguimiento: ${b.nombres.join(", ")}.`, "busq-hecho");
  if (b.estado === "varios") return formularioDni(raiz, "Hay varias personas con tu mismo nombre en las listas. Para saber cuál eres, escribe las cifras de tu DNI que salen en los listados.");
  if (b.estado === "no_encontrado" && b.con_dni) return [aviso("No hay nadie con ese nombre y esas cifras del DNI. Revisa las cifras e inténtalo de nuevo; si tu nombre no es correcto, avisa a la administración (enlace al final de esta página).", "busq-nada"), formularioDni(raiz, "Escribe las cifras de tu DNI que salen en los listados.")];
  if (b.estado === "no_encontrado") return sin ? aviso("Todavía no sales en las listas de este curso. En los listados semanales solo salen las personas a las que ya se ha llamado alguna vez, así que puede que aún no aparezcas. Lo comprobamos solos cada día; si crees que tu nombre está mal escrito, avisa a la administración (enlace al final de esta página).", "busq-nada") : null;
  if (b.estado === "limite") return sin ? aviso("Hoy ya no podemos buscar más veces. Lo volvemos a intentar mañana.", "busq-limite") : null;
  if (b.estado === "sin_pase") return aviso("Necesitas un pase en vigor para buscar tus listas.", "busq-sinpase");
  if (b.estado === "al_dia") return null;
  return aviso("No se pudo buscar tus listas ahora mismo. Lo intentamos de nuevo la próxima vez que entres.", "busq-error");
}

function bloqueLista(l, raiz, ro = false) {
  const actos = actosDe(D.curso, l.cuerpo_cod === "0597" ? "maestros" : "secundaria").sort((a, b) => (a.fecha_oferta < b.fecha_oferta ? 1 : -1));
  const filas = actos.map((a) => ({ a, u: (D.ultimoPorActo.get(a.acto) || []).find((x) => x.cuerpo_cod === l.cuerpo_cod && x.esp === l.esp && (x.convocados || x.clave_ultimo)) })).filter((x) => x.u);
  const sits = filas.map((x) => ({ ...x, sit: situacion(l.clave, x.u) }));
  const alcanzada = sits.filter((x) => x.sit.cod === "alcanzada").length;
  const ultima = sits[0];
  const resumen = !sits.length
    ? "Todavía no hay semanas con lista para esta especialidad en este curso."
    : `En ${alcanzada} de ${sits.length} semanas con lista, la adjudicación llegó a tu posición. ${ultima ? `La más reciente (${fmtCorta(ultima.a.fecha_oferta)}): ${ultima.sit.texto.toLowerCase()}.` : ""}`;
  return h("div", { class: "bloque", "data-lista": `${l.cuerpo_cod}|${l.esp}` },
    h("div", { class: "campos", style: "justify-content:space-between;align-items:start;margin-top:0" },
      h("div", null, h("h3", null, `${l.esp}: ${nombreEspBonito(l.cuerpo_cod, l.esp)}`), h("p", { class: "tenue peq", style: "margin:0" }, `Tu posición: ${textoClave(l.clave)}`)),
      ro ? null : h("button", { type: "button", class: "boton sec", onclick: () => { YO.listas = YO.listas.filter((x) => x !== l); guardarYo(); yo(raiz); } }, "Quitar")),
    h("p", { class: "resumen-frase situacion" }, resumen),
    tarjetaProbabilidad(l),
    sits.length ? h("div", { class: "tabla-wrap" }, h("table", { class: "datos" },
      h("thead", null, h("tr", null, h("th", null, "Oferta"), h("th", { class: "num" }, "Último llamado"), h("th", null, "Tu situación"))),
      h("tbody", null, sits.slice(0, 12).map(({ a, u, sit }) => h("tr", null,
        h("td", null, fmtDMA(a.fecha_oferta)),
        h("td", { class: "num" }, u.relacion_ultimo ? `n.º ${miles(u.relacion_ultimo)} de ${miles(u.convocados)}` : u.reconstruido ? "Calculado con otras semanas" : `Ninguno (${miles(u.convocados)} convocados)`),
        h("td", { class: sit.cod === "alcanzada" ? "sit-tocaba situacion" : "" }, sit.texto)))))) : null,
    sits.length > 12 ? h("p", { class: "tenue peq" }, `Hay ${sits.length - 12} semanas más; están en la sección Histórico.`) : null,
    h("p", { class: "peq" }, h("a", { href: `#/historico?esp=${encodeURIComponent(l.cuerpo_cod + "|" + l.esp)}` }, "Ver gráfico del histórico")),
    h("p", { class: "tenue peq" }, "Orientativo: depende de quién estuviera disponible cada semana y de las vacantes que hubiera en las provincias que tú pidieras."));
}

// ---------- distancia desde tu casa a un centro (botón «mapa» de Vacantes) ----------
function bloqueLugar(raiz) {
  const L = lugarActual, casa = CUENTA.perfil?.casa || "";
  const nombre = L.centro ? centroBonito(L.centro) : localidadBonita(L.localidad);
  const hasta = coordsLocalidad(L.localidad);
  const cuerpo = h("div", { id: "lugar-cuerpo" }, h("p", { class: "tenue", role: "status" }, "Calculando la distancia…"));
  const objetivo = { centro_cod: L.cod, centro: L.centro, localidad: L.localidad, provincia: L.provincia };
  const fav = L.cod ? esFavorito(L.cod) : false;
  const cerrar = () => { lugarActual = null; history.replaceState(null, "", location.pathname + location.search + "#/yo"); yo(raiz); };

  if (!CUENTA.activa) {
    llenar(cuerpo, h("p", { class: "tenue" }, "Para calcular la distancia desde tu casa hace falta una cuenta (el municipio se guarda en ella)."));
  } else if (!casa) {
    llenar(cuerpo, h("p", null, "Elige el municipio donde vives y te decimos a cuántos kilómetros en línea recta está."), bloqueCasa({ solo: true, empezarEditando: true, alCambiar: () => yo(raiz) }));
  } else {
    cargarMunicipios().then((datos) => {
      const m = datos.porClave.get(casa), desde = m ? { lat: m.lat, lon: m.lon } : null;
      const rutas = enlacesRuta({ casa, centro: L.centro || L.localidad, localidad: L.localidad, provincia: L.provincia }, desde, hasta);
      llenar(cuerpo,
        desde && hasta
          ? h("p", { class: "distancia", id: "lugar-km" }, h("strong", { class: "num" }, textoKm(km(desde, hasta))), ` en línea recta desde ${casa}`)
          : h("p", { class: "tenue", id: "lugar-km" }, "No tenemos las coordenadas de este sitio para calcular la distancia, pero puedes ver la ruta."),
        desde && hasta ? h("p", { class: "tiempo", id: "lugar-tiempo" }, h("strong", null, textoTiempo(km(desde, hasta))), " en coche (aproximado)") : null,
        h("p", { class: "tenue peq" }, "Es la distancia entre tu municipio y la localidad del centro; por carretera suele ser mayor, y el tiempo es solo una estimación sin tráfico." + (hasta?.aprox ? " Las coordenadas de esta localidad son aproximadas." : "")),
        h("div", { class: "campos" },
          h("a", { class: "boton", id: "lugar-ruta", href: rutas.google, target: "_blank", rel: "noopener" }, "Cómo llegar (Google Maps)"),
          rutas.osm ? h("a", { class: "boton sec", id: "lugar-osm", href: rutas.osm, target: "_blank", rel: "noopener" }, "OpenStreetMap") : null));
    }).catch(() => llenar(cuerpo, h("p", { class: "error-txt", role: "alert" }, "No se ha podido cargar la lista de municipios. Recarga la página.")));
  }
  return h("div", { class: "bloque lugar", id: "lugar" },
    h("div", { class: "fila-titulo" }, h("h3", { id: "lugar-titulo" }, `Distancia a ${nombre}`),
      h("button", { type: "button", class: "enlace", id: "lugar-cerrar", onclick: cerrar }, "Cerrar")),
    h("p", { class: "tenue peq", style: "margin-top:0" }, `${localidadBonita(L.localidad)}${L.provincia ? ` (${localidadBonita(L.provincia)})` : ""}`),
    cuerpo,
    L.cod || L.centro ? h("div", { class: "campos" },
      L.cod ? h("button", { type: "button", class: "boton sec", id: "lugar-fav", "aria-pressed": String(fav), onclick: () => { alternarFavorito(objetivo); yo(raiz); } }, fav ? "★ Quitar de favoritos" : "☆ Guardar en favoritos") : null,
      L.centro ? h("a", { class: "boton sec", id: "lugar-vacantes", href: "#/vacantes?" + new URLSearchParams({ centro: L.centro, cuerpo: "todos", semana: "todo" }) }, "Ver sus vacantes") : null) : null);
}

// ---------- centros favoritos (la estrella de Vacantes) ----------
function bloqueFavoritos(raiz, ro = false) {
  const casa = !ro && CUENTA.activa ? CUENTA.perfil?.casa || "" : "";
  const dispositivos = CUENTA.perfil?.dispositivos || 0;
  const lista = h("ul", { class: "favoritos", id: "lista-favoritos" }, YO.favoritos.map((f) => h("li", { "data-cod": f.cod },
    h("div", { class: "fav-datos" },
      h("strong", null, centroBonito(f.centro) || f.cod),
      h("div", { class: "peq tenue" }, `${localidadBonita(f.localidad)}${f.provincia ? ` (${localidadBonita(f.provincia)})` : ""}`, " ", h("span", { class: "fav-km" }))),
    h("div", { class: "fav-acciones" },
      h("a", { class: "enlace", href: "#/vacantes?" + new URLSearchParams({ centro: f.centro, cuerpo: "todos", semana: "todo" }) }, "Vacantes"),
      ro ? null : h("button", { type: "button", class: "enlace", onclick: () => ir("yo", { lugar: f.localidad, centro: f.centro, cod: f.cod, prov: f.provincia }) }, "Distancia"),
      ro ? null : h("button", { type: "button", class: "enlace", "aria-label": `Quitar ${centroBonito(f.centro)} de mis favoritos`, onclick: () => { quitarFavorito(f.cod); yo(raiz); } }, "Quitar")))));
  if (casa && YO.favoritos.length) {
    cargarMunicipios().then((datos) => {
      const m = datos.porClave.get(casa); if (!m) return;
      for (const li of lista.children) {
        const f = YO.favoritos.find((x) => x.cod === li.dataset.cod), c = f && coordsLocalidad(f.localidad);
        if (c) li.querySelector(".fav-km").textContent = `· a ${textoKm(km(m, c))} (${textoTiempo(km(m, c))} en coche) de ${casa.replace(/\s\(.*\)$/, "")}`;
      }
    }).catch(() => { /* sin distancias */ });
  }
  return h("div", { class: "bloque", id: "favoritos" },
    h("h3", null, "Mis centros favoritos"),
    h("p", { class: "tenue peq" }, "Te avisamos en la app cuando sale una vacante nueva o se adjudica una vacante en estos centros."),
    YO.favoritos.length ? lista : h("p", { class: "vacio", id: "sin-favoritos" }, ro ? "No tiene ninguno." : "Todavía no tienes ninguno. En Vacantes, pulsa la estrella de la fila de un centro."),
    !ro && CUENTA.activa ? h("p", { class: "tenue peq", id: "avisos-estado" }, dispositivos
      ? `Avisos activados en ${dispositivos === 1 ? "1 dispositivo" : dispositivos + " dispositivos"}. `
      : "Todavía no recibes avisos en ningún dispositivo. ", h("a", { href: "#/ajustes" }, "Ajustes de avisos")) : null);
}

function destinos(raiz, ro = false) {
  const locs = Object.values(D.locs).map((x) => x.localidad).sort((a, b) => a.localeCompare(b, "es"));
  const entrada = h("input", { type: "text", id: "d-loc", list: "d-lista", placeholder: "Escribe una localidad" });
  const anadir = () => {
    const v = entrada.value.trim().toLowerCase();
    const loc = locs.find((l) => localidadBonita(l).toLowerCase() === v || l.toLowerCase() === v);
    if (loc && !YO.destinos.includes(loc)) { YO.destinos.push(loc); guardarYo(); yo(raiz); }
  };
  const recientes = D.vacantes.length ? filtrar({ cuerpo: "todos", semana: "ult1", prov: "", loc: "", centro: "", esp: "", estado: "todas", jornada: "", duracion: "", tipo: "todas", mis: true }) : [];
  return h("div", { class: "bloque", id: "destinos" },
    h("h3", null, "Mis destinos preferidos"),
    h("p", { class: "tenue peq" }, "Se resaltan en la tabla de vacantes y puedes filtrar por ellos."),
    ro ? null : h("div", { class: "campos" }, h("label", null, "Añadir localidad", entrada), h("datalist", { id: "d-lista" }, locs.map((l) => h("option", { value: localidadBonita(l) }))),
      h("button", { type: "button", class: "boton", id: "d-anadir", onclick: anadir }, "Añadir")),
    h("div", { class: "etiquetas" }, YO.destinos.length ? YO.destinos.map((l) => h("span", { class: "chip oro" }, localidadBonita(l),
      ro ? null : h("button", { type: "button", "aria-label": `Quitar ${localidadBonita(l)}`, onclick: () => { YO.destinos = YO.destinos.filter((x) => x !== l); guardarYo(); yo(raiz); } }, "×"))) : h("span", { class: "tenue peq" }, ro ? "No ha elegido ninguno." : "Aún no has elegido ninguno. También puedes añadirlos desde el mapa.")),
    YO.destinos.length ? [
      h("h3", { style: "margin-top:1rem" }, "Última semana en tus destinos"),
      recientes.length ? h("ul", { style: "padding-left:1.1rem" }, recientes.slice(0, 10).map((v) => h("li", null,
        `${v.esp}, ${centroBonito(v.centro)} en ${localidadBonita(v.localidad)}: ${v.estado === "adjudicada" ? "adjudicada" : "sin adjudicar"}`)))
        : h("p", { class: "tenue" }, "No hubo vacantes en tus destinos en la última semana."),
      h("button", { type: "button", class: "boton sec", onclick: () => ir("vacantes", { mis: "1", cuerpo: "todos", semana: "todo" }) }, "Ver todas en el curso")] : null);
}

/** Solo en el modo de prueba (sin cuenta): los datos viven en este navegador. Con cuenta, borrar datos está en Ajustes. */
function borrado(raiz) {
  const borrarTodo = confirmandoBorrado
    ? h("div", { class: "campos" }, h("span", null, "¿Borrar todo lo guardado?"),
      h("button", { type: "button", class: "boton", id: "borrar-si", onclick: () => { YO.listas = []; YO.destinos = []; YO.favoritos = []; guardarYo(); confirmandoBorrado = false; yo(raiz); } }, "Sí, borrar"),
      h("button", { type: "button", class: "boton sec", onclick: () => { confirmandoBorrado = false; yo(raiz); } }, "Cancelar"))
    : h("button", { type: "button", class: "boton sec", id: "borrar", onclick: () => { confirmandoBorrado = true; yo(raiz); } }, "Borrar mis datos");
  return h("div", { class: "bloque" }, h("h3", null, "Mis datos"),
    h("p", { class: "tenue peq" }, "Tu posición y tus destinos viven en el almacenamiento de este navegador. Si borras los datos del navegador, desaparecen."), borrarTodo);
}

// ---------- cuenta y pase ----------
function barraCuenta(raiz) {
  return h("div", { class: "barra-cuenta" },
    h("span", null, "Sesión de ", h("strong", { id: "cuenta-email" }, CUENTA.email || "tu cuenta")),
    CUENTA.pase ? h("span", { class: "chip oro", id: "pase-activo" }, textoPase()) : null,
    h("div", { class: "acciones-cuenta" },
      h("a", { class: "boton sec", id: "ir-ajustes", href: "#/ajustes" }, "Ajustes"),
      CUENTA.admin ? h("a", { class: "boton sec", id: "ir-admin", href: "#/admin" }, "Administración") : null,
      h("button", { type: "button", class: "boton sec", id: "salir", onclick: async () => { await salir(); yo(raiz); } }, "Cerrar sesión")));
}

export function textoPase() {
  const p = CUENTA.pase;
  if (p.tipo === "admin") return "Administración";
  if (p.tipo === "prueba") { const n = diasDePrueba(); return `Prueba gratuita: ${n === 1 ? "1 día" : n + " días"}`; }
  if (p.tipo === "invitaciones") return `App gratis hasta el ${fmtDMA(p.expira)}`;
  return `Pase activo hasta el ${fmtDMA(p.expira)}`;
}

/** Aviso de arriba en Mi seguimiento: días de prueba que quedan, o app gratis por invitar. */
function avisoDeAcceso(raiz) {
  const p = CUENTA.pase, cfg = window.CONFIG || {}, prod = productoActual(), info = cursoDeProducto(prod);
  if (!p) return null;
  if (p.tipo === "prueba") {
    const n = diasDePrueba();
    return h("div", { class: "aviso-acceso", id: "aviso-prueba" },
      h("div", null, h("strong", null, `Prueba gratuita: ${n === 1 ? "te queda 1 día" : `te quedan ${n} días`}`),
        h("p", null, "Después, ", precioTexto(prod), info ? ` por todo el curso (hasta el ${info.hasta}).` : ".", " Pago único, sin renovación automática.")),
      h("button", { type: "button", class: "boton", id: "activar-pase", onclick: () => { verCompra = true; yo(raiz); } }, `Activar mi pase`));
  }
  if (p.tipo === "invitaciones") {
    return h("div", { class: "aviso-acceso ok", id: "aviso-gratis" },
      h("div", null, h("strong", null, "Tienes la app gratis este curso"), h("p", null, `Gracias por invitar a 3 personas. Acceso hasta el ${fmtDMA(p.expira)}.`)));
  }
  return null;
}

// ---------- invitar: «Invita y consigue la app gratis» ----------
export function bloqueInvitar() {
  const caja = h("div", { class: "bloque invitar", id: "invitar" }, h("h3", null, "Invita y consigue la app gratis"), h("p", { class: "tenue", id: "ref-carga" }, "Cargando…"));
  misReferidos().then((d) => {
    if (!d) { caja.querySelector("#ref-carga").textContent = "No disponible en este momento."; return; }
    const { texto, wa, tg } = enlacesInvitar(d.codigo);
    const msg = h("p", { class: "tenue peq", id: "ref-msg", role: "status" });
    const entrada = h("input", { type: "text", id: "ref-in", maxlength: 16, placeholder: "ARA-XXXXX", autocomplete: "off", value: codigoPendiente() });
    const usar = d.puede_usar ? h("div", { class: "campos" },
      h("label", null, "¿Te invitó alguien? Su código", entrada),
      h("button", { type: "button", class: "boton sec", id: "ref-usar", onclick: async () => {
        const r = await usarCodigo(entrada.value);
        msg.textContent = r.mensaje; msg.className = r.ok ? "tenue peq" : "error-txt peq";
        if (r.ok) llenarInvitar(caja, { ...d, usado: true, puede_usar: false }, msg, wa, tg, texto);
      } }, "Usar código")) : null;
    llenarInvitar(caja, d, msg, wa, tg, texto, usar);
  });
  return caja;
}
function llenarInvitar(caja, d, msg, wa, tg, texto, usar) {
  llenar(caja,
    h("h3", null, "Invita y consigue la app gratis"),
    h("p", null, `Si ${d.necesarios} personas se registran con tu código y pagan, tu curso es gratis.`),
    h("div", { class: "codigo-invitacion", id: "ref-codigo" }, d.codigo),
    h("p", { id: "ref-cuenta" }, "Invitados: ", h("strong", null, String(d.invitados)), " · han pagado: ", h("strong", null, `${d.pagados} de ${d.necesarios}`),
      d.gratis ? " · ¡Conseguido! Tienes la app gratis este curso." : ""),
    h("div", { class: "campos compartir" },
      h("a", { class: "boton", id: "ref-wa", href: wa, target: "_blank", rel: "noopener" }, "WhatsApp"),
      h("a", { class: "boton", id: "ref-tg", href: tg, target: "_blank", rel: "noopener" }, "Telegram"),
      navigator.share ? h("button", { type: "button", class: "boton sec", id: "ref-share", onclick: async () => { try { await navigator.share({ text: texto }); } catch (e) { /* cancelado */ } } }, "Otras apps…") : null,
      h("button", { type: "button", class: "enlace", id: "ref-copiar", onclick: async () => {
        try { await navigator.clipboard.writeText(texto); msg.textContent = "Mensaje copiado: pégalo donde quieras."; } catch (e) { msg.textContent = texto; }
        msg.className = "tenue peq";
      } }, "Copiar mensaje")),
    usar, msg);
}

/** Lista corta para empezar (nombre, municipio, favorito, avisos). Desaparece sola al completarla, o con «Ocultar» en este dispositivo. */
function primerosPasos(raiz) {
  if (leerLocal(CLAVE_PASOS, false)) return null;
  const perfil = CUENTA.perfil || {};
  const ir_a = (id, foco) => () => { const el = document.getElementById(id); if (el) { el.scrollIntoView({ block: "center" }); document.getElementById(foco || id)?.focus(); } };
  const pasos = [
    { id: "paso-nombre", hecho: !!perfil.nombre, texto: "Escribe tu nombre como sale en las listas", detalle: "Así la web encuentra sola tus listas y especialidades.",
      accion: h("button", { type: "button", class: "enlace", onclick: ir_a("form-nombre", "nom-in") }, "Escribirlo") },
    { id: "paso-casa", hecho: !!perfil.casa, texto: "Elige el municipio donde vives", detalle: "Te decimos a cuántos km y minutos está cada centro y puedes filtrar Vacantes por distancia.",
      accion: h("button", { type: "button", class: "enlace", onclick: () => { document.getElementById("casa")?.scrollIntoView({ block: "center" }); document.getElementById("casa-cambiar")?.click(); } }, "Elegirlo") },
    { id: "paso-favorito", hecho: YO.favoritos.length > 0, texto: "Marca un centro como favorito", detalle: "En Vacantes o en Semana, pulsa la estrella de la fila de un centro.",
      accion: h("a", { href: "#/vacantes" }, "Ir a Vacantes") },
    { id: "paso-avisos", hecho: (perfil.dispositivos || 0) > 0, texto: "Activa los avisos en la app", detalle: "Te avisamos de vacantes nuevas en tus favoritos y de cada adjudicación de tus listas.",
      accion: h("a", { href: "#/ajustes" }, "Ir a Ajustes") },
  ];
  const hechos = pasos.filter((x) => x.hecho).length;
  if (hechos === pasos.length) return null;
  return h("section", { class: "pasos", id: "primeros-pasos", "aria-labelledby": "pasos-titulo" },
    h("div", { class: "fila-titulo" },
      h("h3", { id: "pasos-titulo" }, "Primeros pasos ", h("span", { class: "tenue peq", id: "pasos-cuenta" }, `${hechos} de ${pasos.length}`)),
      h("button", { type: "button", class: "enlace", id: "pasos-ocultar", onclick: () => { guardarLocal(CLAVE_PASOS, true); yo(raiz); } }, "Ocultar")),
    h("ul", { class: "pasos-lista" }, pasos.map((x) => h("li", { id: x.id, class: x.hecho ? "hecho" : "" },
      h("span", { class: "pasos-marca", "aria-hidden": "true" }, x.hecho ? "✓" : ""),
      h("div", null, h("strong", null, x.texto, x.hecho ? h("span", { class: "solo-lector" }, " (hecho)") : null), x.hecho ? null : [h("div", { class: "peq tenue" }, x.detalle), x.accion])))));
}

// Tarjeta llamativa de Mi seguimiento: «Invita a tus compañeros y consigue la app gratis». Reutiliza el código y los enlaces de «Invita y consigue la app gratis» de Ajustes.
let referidos = null, referidosHora = 0;     // se guarda un momento para no preguntar al servidor cada vez que se repinta la pantalla
export function tarjetaInvitar() {
  const tipo = CUENTA.pase?.tipo;
  if (tipo === "pago_unico" || tipo === "suscripcion") return null;       // quien ya pagó no necesita el premio
  const caja = h("section", { class: "tarjeta-invitar", id: "invitar-destacado", "aria-labelledby": "inv-titulo" });
  const pinta = (d) => {
    const { texto, wa, tg } = enlacesInvitar(d.codigo);
    const msg = h("p", { class: "inv-msg", id: "ref-msg", role: "status" });
    const puntos = Array.from({ length: d.necesarios }, (_, i) => h("span", { class: "inv-punto" + (i < d.pagados ? " lleno" : ""), "aria-hidden": "true" }, i < d.pagados ? "✓" : String(i + 1)));
    llenar(caja,
      h("div", { class: "inv-cuerpo" },
        h("h3", { id: "inv-titulo" }, d.gratis ? "¡Lo has conseguido! Tienes la app gratis este curso" : "Invita a tus compañeros y consigue la app gratis"),
        h("p", { class: "inv-texto" }, d.gratis
          ? "Gracias por invitar. Si sigues compartiendo tu código, ayudas a más compañeros a no perderse ninguna vacante."
          : `Si ${d.necesarios} compañeros se registran con tu código y activan su pase, tu curso es gratis.`),
        h("div", { class: "inv-progreso", id: "inv-progreso", role: "img", "aria-label": `${d.pagados} de ${d.necesarios} compañeros han activado su pase` },
          puntos, h("span", { class: "inv-cuenta" }, d.gratis ? "¡Conseguido!" : `Llevas ${d.pagados} de ${d.necesarios}`, d.invitados > d.pagados ? ` · ${d.invitados} ${d.invitados === 1 ? "se ha registrado" : "se han registrado"}` : ""))),
      h("div", { class: "inv-accion" },
        h("p", { class: "inv-etiqueta" }, "Tu código"),
        h("div", { class: "inv-codigo", id: "ref-codigo" }, d.codigo),
        h("div", { class: "inv-botones" },
          h("a", { class: "boton-inv", id: "ref-wa", href: wa, target: "_blank", rel: "noopener" }, "WhatsApp"),
          h("a", { class: "boton-inv", id: "ref-tg", href: tg, target: "_blank", rel: "noopener" }, "Telegram"),
          h("button", { type: "button", class: "boton-inv sec", id: "ref-copiar", onclick: async () => {
            try { await navigator.clipboard.writeText(texto); msg.textContent = "Mensaje copiado: pégalo donde quieras."; } catch (e) { msg.textContent = texto; }
          } }, "Copiar mensaje")),
        msg));
  };
  if (referidos && Date.now() - referidosHora < 60000) { pinta(referidos); return caja; }
  llenar(caja, h("h3", { id: "inv-titulo" }, "Invita a tus compañeros y consigue la app gratis"), h("p", { class: "inv-texto", id: "ref-carga" }, "Cargando tu código…"));
  misReferidos().then((d) => { if (!d) { caja.hidden = true; return; } referidos = d; referidosHora = Date.now(); pinta(d); });
  return caja;
}

function cabeceraAcceso() {
  return h("div", { class: "cabecera-vista" }, h("h2", null, "Mi seguimiento"),
    h("p", { class: "tenue" }, "Consultar las adjudicaciones es gratis. Mi seguimiento es tu área personal: apunta tu posición en las listas y tus destinos preferidos, y la web los compara cada semana con lo que se adjudica."));
}
function mensajeCuenta() {
  const m = CUENTA.mensaje; CUENTA.mensaje = "";
  return m ? h("p", { class: "error", role: "alert", id: "cuenta-mensaje" }, m) : null;
}
function precioTexto(prod) {
  const cfg = window.CONFIG || {};
  const el = h("strong", { id: "precio" }, cfg.precio || "7,49 €");
  if (compraDisponible()) precioEnPlay(prod).then((p) => { if (p) el.textContent = p; });
  return el;
}

// Entrada con correo y contraseña, con los mismos modos y textos que DocentsCV: entrar, crear cuenta, recuperar contraseña y nueva contraseña.
const MODOS = {   // título, botón, texto del enlace alternativo, modo al que lleva ese enlace
  login: ["Entrar", "Entrar", "Crear cuenta", "registro"],
  registro: ["Crear cuenta", "Crear cuenta", "Ya tengo cuenta", "login"],
  olvido: ["Recuperar contraseña", "Enviar enlace", "Volver", "login"],
  nueva: ["Nueva contraseña", "Guardar contraseña", "", "login"],
};
let modoAcceso = "login", correoEscrito = "";

function formularioAcceso(raiz, modo) {
  const cfg = window.CONFIG || {};
  const [titulo, boton, alterno, modoAlterno] = MODOS[modo];
  const msg = h("p", { id: "au-msg", role: "status", class: "tenue" });
  const mostrar = (t, error) => { msg.textContent = t; msg.className = error ? "error-txt" : "tenue"; };
  const mail = h("input", { type: "email", id: "au-mail", autocomplete: "username", value: correoEscrito, oninput: (e) => { correoEscrito = e.target.value; } });
  const pass = h("input", { type: "password", id: "au-pass", autocomplete: modo === "login" ? "current-password" : "new-password" });
  const acepto = h("input", { type: "checkbox", id: "au-ok" });
  const codigo = h("input", { type: "text", id: "au-ref", maxlength: 16, placeholder: "ARA-XXXXX", autocomplete: "off", value: codigoPendiente() });
  const nombre = h("input", { type: "text", id: "au-nombre", maxlength: 120, placeholder: "GARCÍA LÓPEZ, MARÍA", autocomplete: "off" });
  const casa = modo === "registro" ? selectorMunicipio({ id: "au-casa" }) : null;
  const ir = async (e) => {
    e.preventDefault();
    const correo = mail.value.trim(), clave = pass.value;
    if (modo !== "nueva" && !/^\S+@\S+\.\S+$/.test(correo)) return mostrar("Escribe un correo válido.", true);
    if (modo !== "olvido" && clave.length < 8) return mostrar("La contraseña debe tener al menos 8 caracteres.", true);
    if (modo === "registro" && nombre.value.trim() && !nombreValido(nombre.value)) return mostrar(ERRORES_NOMBRE.invalido, true);
    if (modo === "registro" && casa.texto() && !casa.valor()) return mostrar("Elige tu municipio de la lista: empieza a escribirlo y pulsa sobre él (o déjalo vacío).", true);
    if (modo === "registro" && !acepto.checked) return mostrar("Para crear la cuenta debes aceptar la política de privacidad y las condiciones.", true);
    mostrar("Un momento…");
    const botones = raiz.querySelectorAll("button"); botones.forEach((b) => { b.disabled = true; });
    let r;
    try {
      if (modo === "login") r = await entrarConCorreo(correo, clave);
      else if (modo === "registro") r = await crearCuenta(correo, clave, codigo.value, nombre.value, casa.valor());
      else if (modo === "olvido") r = await recuperarContrasena(correo);
      else r = await nuevaContrasena(clave);
    } catch (err) { r = { ok: false, mensaje: "Ha ocurrido un error. Inténtalo de nuevo." }; }
    botones.forEach((b) => { b.disabled = false; });
    if (!r.ok) return mostrar("No se pudo completar: " + r.mensaje, true);
    if (modo === "login" || modo === "nueva" || (modo === "registro" && r.sesion)) { pass.value = ""; yo(raiz); return; }
    pass.value = "";
    if (modo === "registro") {
      const otra = cfg.cuentaCompartidaCon;
      mostrar("Te hemos enviado un correo. Pulsa el enlace para confirmar tu cuenta y después entra." +
        (otra ? ` Si ya tienes cuenta en ${otra}, no llegará ningún correo: entra con tu correo y contraseña de siempre, o pulsa «He olvidado mi contraseña».` : ""));
    } else mostrar("Si el correo existe, recibirás un enlace para crear una nueva contraseña.");
  };
  const cambiar = (m) => () => { modoAcceso = m; yo(raiz); };
  const otra = cfg.cuentaCompartidaCon;
  return h("form", { class: "bloque form-acceso", id: "form-acceso", novalidate: true, onsubmit: ir },
    h("h3", { id: "au-title" }, titulo),
    modo !== "nueva" ? h("label", null, "Correo electrónico", mail) : null,
    modo !== "olvido" ? h("label", null, modo === "nueva" ? "Nueva contraseña (mínimo 8 caracteres)" : modo === "registro" ? "Contraseña (mínimo 8 caracteres)" : "Contraseña", pass) : null,
    modo === "registro" ? h("label", null, "Tu nombre como sale en las listas (opcional)", nombre) : null,
    modo === "registro" ? h("p", { class: "tenue peq", id: "au-nombre-ayuda" }, "Sirve para encontrar tus listas y especialidades sin que tengas que buscarlas. Solo lo usa tu cuenta; no se enseña a nadie.") : null,
    modo === "registro" ? h("label", null, "Municipio donde vives (opcional)", casa.el) : null,
    modo === "registro" ? h("p", { class: "tenue peq", id: "au-casa-ayuda" }, "Sirve para decirte a cuántos kilómetros en línea recta está cada centro. Solo guardamos el municipio, no tu dirección.") : null,
    modo === "registro" ? h("label", null, "Código de invitación (opcional)", codigo) : null,
    modo === "registro" ? h("label", { class: "check" }, acepto, h("span", null, "He leído la ", h("a", { href: "privacidad.html", target: "_blank", rel: "noopener" }, "política de privacidad y las condiciones"), " y las acepto.")) : null,
    h("div", { class: "campos" },
      h("button", { type: "submit", class: "boton", id: "au-go" }, boton),
      alterno ? h("button", { type: "button", class: "enlace", id: "au-alt", onclick: cambiar(modoAlterno) }, alterno) : null,
      modo === "login" ? h("button", { type: "button", class: "enlace", id: "au-forgot", onclick: cambiar("olvido") }, "He olvidado mi contraseña") : null),
    msg,
    (modo === "login" || modo === "registro") && otra ? h("p", { class: "tenue peq", id: "au-compartida" }, `¿Ya tienes cuenta en ${otra}? Es la misma: entra con tu correo y contraseña de ${otra}, no hace falta crear otra.`) : null,
    cfg.loginGoogle && (modo === "login" || modo === "registro") ? h("button", { type: "button", class: "boton sec", id: "entrar-google", onclick: entrarConGoogle }, "Entrar con Google") : null);
}

function pantallaEntrada(raiz, modo = modoAcceso) {
  if (CUENTA.recuperando && modo === "nueva") {
    llenar(raiz, cabeceraAcceso(), mensajeCuenta(), formularioAcceso(raiz, "nueva"));
    return;
  }
  const cfg = window.CONFIG || {}, dias = cfg.diasPrueba || 15;
  if (CUENTA.invitacion) { modo = modoAcceso = "registro"; CUENTA.invitacion = false; }   // llegó desde el enlace de una persona que la invita
  const prod = productoActual(), info = cursoDeProducto(prod);
  // El formulario va primero (en el móvil sale arriba) y en pantallas anchas se coloca a la derecha, junto al título.
  llenar(raiz, cabeceraAcceso(), mensajeCuenta(),
    h("div", { class: "acceso-grid" },
    formularioAcceso(raiz, modo),
    h("div", { class: "bloque acceso-info" },
      h("h3", null, "Qué incluye"),
      h("p", { class: "destacado", id: "prueba-gratis" }, h("strong", null, `Prueba gratis ${dias} días`), ": crea tu cuenta y empieza a seguir tus listas ahora mismo, sin pagar nada. ",
        codigoPendiente() ? "Te ha invitado una persona: tu código ya está puesto al crear la cuenta." : ""),
      h("ul", { class: "beneficios" },
        h("li", null, "Tu posición en cada lista, comparada con el último llamado de cada semana."),
        h("li", null, "Tus destinos preferidos, resaltados en Vacantes y en el Mapa."),
        h("li", null, "Centros favoritos y la distancia desde tu casa a cada centro."),
        h("li", null, "Tus datos en tu cuenta: los ves igual en el móvil y en el ordenador."),
        h("li", null, "Avisos en la app cuando sale una vacante nueva o se adjudica una vacante en tus centros favoritos.")),
      h("p", null, "Pase del curso ", info ? info.curso : "", ": ", precioTexto(prod), info ? ` hasta el ${info.hasta}. Pago único, no se renueva solo.` : "."),
      h("p", { class: "tenue peq" }, "Guardamos tu correo, para identificar tu cuenta, lo que apuntes aquí (listas, destinos y centros favoritos) y, si quieres, tu nombre tal como sale en las listas y el municipio donde vives. Nunca guardamos tu DNI (si hay otra persona con tu mismo nombre, para buscar te pedimos las cifras que ya salen tapadas en los listados, y no se guardan). Puedes borrar todos tus datos de Aragón cuando quieras."))));
}

function pantallaPase(raiz) {
  const prod = productoActual(), info = cursoDeProducto(prod);
  const msg = h("p", { id: "compra-msg", role: "status", class: "tenue" });
  const mostrar = (texto, error) => { msg.textContent = texto; msg.className = error ? "error-txt" : "tenue"; };
  const ocupado = (v) => raiz.querySelectorAll("button").forEach((b) => { b.disabled = v; });
  const accion = (f) => async () => {
    ocupado(true);
    try { const r = await f(); if (r.cancelado) { mostrar(""); } else if (r.ok) { verCompra = false; yo(raiz); return; } else mostrar(r.mensaje, true); }
    catch (e) { mostrar("No se pudo completar la operación con Google Play. Inténtalo de nuevo.", true); }
    ocupado(false);
  };
  const caducado = CUENTA.ultimoPase && CUENTA.ultimoPase.expira < new Date().toISOString().slice(0, 10) ? CUENTA.ultimoPase : null;
  const pruebaTerminada = caducado && caducado.tipo === "prueba";
  llenar(raiz, cabeceraAcceso(), mensajeCuenta(), barraCuenta(raiz),
    h("div", { class: "bloque" },
      h("h3", { id: "pase-titulo" }, pruebaTerminada ? "Tu prueba gratuita ha terminado" : info ? `Activa tu pase del curso ${info.curso}` : "Activa tu pase"),
      pruebaTerminada ? h("p", null, `Para seguir viendo tu posición en las listas y tus destinos, activa tu pase${info ? ` del curso ${info.curso}` : ""}. Lo que guardaste sigue en tu cuenta y vuelve a verse al activarlo.`) : null,
      caducado && !pruebaTerminada ? h("p", { class: "tenue" }, `Tu pase anterior caducó el ${fmtDMA(caducado.expira)}. Lo que guardaste sigue en tu cuenta y vuelve a verse al activar el nuevo pase.`) : null,
      h("p", null, "Precio: ", precioTexto(prod), info ? `. Pago único, acceso hasta el ${info.hasta}; no se renueva solo.` : "."),
      compraDisponible()
        ? h("div", { class: "campos" },
          h("button", { type: "button", class: "boton", id: "comprar", onclick: accion(comprarPase) }, "Comprar con Google Play"),
          h("button", { type: "button", class: "boton sec", id: "restaurar", onclick: accion(restaurarCompra) }, "Restaurar compra"))
        : [h("p", null, "La compra se hace desde la app de Android de Docentes Aragón: entra en la app con el mismo correo y contraseña con los que has entrado aquí. Cuando la completes, vuelve a esta página."),
          h("button", { type: "button", class: "boton sec", id: "comprobar", onclick: accion(async () => { await pagoHecho(); return { ok: CUENTA.estado === "con_pase" && CUENTA.pase.tipo !== "prueba", mensaje: "Todavía no vemos ningún pase de pago en tu cuenta." }; }) }, "Ya he comprado: comprobar mi pase")],
      verCompra && CUENTA.estado === "con_pase" ? h("button", { type: "button", class: "enlace", id: "volver", onclick: () => { verCompra = false; yo(raiz); } }, "Volver a Mi seguimiento") : null,
      msg),
    bloqueInvitar());
}
