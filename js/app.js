// Arranque y navegación.
import { h, llenar, fmtLarga } from "./util.js";
import { D, cargarBase, cargarVacantes } from "./datos.js";
import { leerRuta, ir } from "./ruta.js";
import { semana } from "./semana.js";
import { historico } from "./historico.js";
import { vacantes } from "./vacantes.js";
import { mapa } from "./mapa.js";
import { yo, invitar } from "./yo.js";
import { ajustes } from "./ajustes.js";
import { admin } from "./admin.js";
import { ayuda } from "./ayuda.js";
import { iniciarCuenta, CUENTA, salirVerComo } from "./cuenta.js";
import { registrarSW, resincronizarAvisos } from "./avisos.js";

const VISTAS = { semana, historico, vacantes, mapa, yo, ajustes, admin, ayuda, invitar };
const NECESITA_VACANTES = new Set(["vacantes", "mapa", "yo"]);
const PESTANA = { ajustes: "yo", admin: "yo", invitar: "yo" };      // estas cuelgan de «Mi seguimiento»
const raiz = document.getElementById("vista");

/** Barra de arriba mientras la administradora mira la web como otra persona (solo lectura). */
function avisoVerComo() {
  const el = document.getElementById("aviso-vercomo");
  if (!CUENTA.verComo) { el.hidden = true; el.replaceChildren(); return; }
  llenar(el,
    h("span", null, "Estás viendo la web como ", h("strong", { id: "vercomo-quien" }, CUENTA.verComo.email), CUENTA.verComo.nombre ? ` (${CUENTA.verComo.nombre})` : "", ". Solo lectura: no se guarda nada."),
    h("button", { type: "button", class: "boton", id: "vercomo-salir", onclick: () => { salirVerComo(); location.hash = "#/admin?seccion=usuarios"; window.dispatchEvent(new Event("hashchange")); } }, "Volver a mi cuenta"));
  el.hidden = false;
}

async function pintar() {
  const { vista, params } = leerRuta();
  const nombre = VISTAS[vista] ? vista : "semana";
  document.querySelectorAll(".pestanas a").forEach((a) => {
    if (a.dataset.vista === (PESTANA[nombre] || nombre)) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  avisoVerComo();
  try {
    if (NECESITA_VACANTES.has(nombre) && D.vacantes._curso !== D.curso) {
      llenar(raiz, h("p", { class: "cargando" }, "Cargando vacantes…"));
      const v = await cargarVacantes(D.curso);
      v._curso = D.curso;
    }
    VISTAS[nombre](raiz, params);
  } catch (e) {
    console.error(e);
    llenar(raiz, h("div", { class: "error" }, h("strong", null, "No se han podido cargar los datos. "), `${e.message}. Recarga la página; si sigue igual, vuelve a intentarlo más tarde.`));
  }
  if (!params._sinfoco) window.scrollTo({ top: 0 });
}

async function arrancar() {
  try {
    await cargarBase();
  } catch (e) {
    console.error(e);
    llenar(raiz, h("div", { class: "error" }, h("strong", null, "No se han podido cargar los datos. "), `${e.message}. Si abres el fichero index.html con doble clic no funciona: usa «abrir_local.bat» o la dirección publicada de la web.`));
    return;
  }
  D.curso = D.cursos[0];
  await iniciarCuenta();   // si volvemos de Google, recoge la sesión; carga el pase y el seguimiento
  registrarSW().then(resincronizarAvisos);   // avisos de la app: service worker y, si este dispositivo ya los tenía, recordárselo a la cuenta
  if (D.aviso) { const a = document.getElementById("aviso-datos"); a.textContent = D.aviso; a.hidden = false; }
  document.getElementById("pie-actualizado").textContent = `Datos hasta la oferta del ${fmtLarga(D.actos[0]?.fecha_oferta)}${D.modo === "estatico" ? " (copia guardada en la web)" : ""}.`;
  window.addEventListener("hashchange", pintar);
  pintar();
}
arrancar();
