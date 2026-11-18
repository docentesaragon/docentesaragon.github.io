// «Ayuda»: preguntas frecuentes. Texto fijo; los precios y fechas salen de la configuración.
import { h, llenar } from "./util.js";
import { CUENTA } from "./cuenta.js";
import { productoActual, cursoDeProducto } from "./compra.js";

function preguntas() {
  const cfg = window.CONFIG || {}, info = cursoDeProducto(productoActual());
  const precio = cfg.precio || "7,49 €", hasta = info ? info.hasta : "30/06", dias = cfg.diasPrueba || 15;
  const enlace = (texto, href) => h("a", { href }, texto);
  return [
    ["Los datos", [
      ["datos", "¿De dónde salen los datos?",
        [h("p", null, "De los listados en PDF que el Departamento de Educación del Gobierno de Aragón publica cada semana en ", h("a", { href: "https://educa.aragon.es", target: "_blank", rel: "noopener" }, "educa.aragon.es"), ": adjudicaciones, vacantes y candidatos por especialidad. Un proceso automático los lee cada día laborable y los carga en la web."),
          h("p", null, "Páginas oficiales de origen: Secundaria, ", h("a", { href: "https://educa.aragon.es/-/adjudicacion-semanal-sec-1", target: "_blank", rel: "noopener" }, "adjudicación semanal"), " y ", h("a", { href: "https://educa.aragon.es/-/oferta-semanal-sec", target: "_blank", rel: "noopener" }, "oferta semanal"), "; Maestros, ", h("a", { href: "https://educa.aragon.es/-/adjudicacion-semanal-maestros", target: "_blank", rel: "noopener" }, "adjudicación semanal"), " y ", h("a", { href: "https://educa.aragon.es/-/oferta-semanal-maestros", target: "_blank", rel: "noopener" }, "oferta semanal"), "."),
          h("p", null, "Esta web y la app no son oficiales: no pertenecen ni están respaldadas por el Gobierno de Aragón ni por Educaragón. Si algo no cuadra, vale siempre el documento oficial.")]],
      ["oficial", "¿Es una app oficial del Gobierno de Aragón?",
        [h("p", null, "No. Docentes Aragón es un proyecto independiente de Fuxters, el mismo responsable de DocentsCV. No tiene relación con el Gobierno de Aragón, con Educaragón ni con PADDOC: solo organiza de forma más cómoda información que la administración ya publica. Para tramitar tus peticiones usa siempre la plataforma oficial (el botón «Ir a PADDOC» de Mi seguimiento te lleva a ella).")]],
      ["ultimo-llamado", "¿Qué significa «hasta dónde llegó la lista»?",
        [h("p", null, "Cada semana se adjudica siguiendo el orden de la lista hasta cierta posición: el «último llamado». Si tu posición está antes o es igual, esa semana te habría tocado (si estabas disponible)."),
          h("p", null, "El último llamado no avanza siempre hacia delante: cada semana se llama a quien está disponible, aunque esté más adelante en la lista. Por eso en el histórico puede subir y bajar."),
          h("p", null, "Cuando falta el PDF de candidatos de una semana, el dato se calcula con las listas de otras semanas y aparece como «Calculado con otras semanas».")]],
      ["kilometros", "¿Cómo se calculan los kilómetros y el tiempo?",
        [h("p", null, "Son los kilómetros en línea recta entre tu municipio y la localidad del centro. El tiempo en coche es una estimación: se suma un 25 % por las curvas de la carretera y se supone una velocidad media de 50, 70 u 80 km/h según la distancia. No cuenta el tráfico."),
          h("p", null, "Si has elegido tu municipio, en ", enlace("Vacantes", "#/vacantes"), " puedes filtrar con «Cerca de mi casa» y ordenar por distancia.")]],
    ]],
    ["Mi seguimiento", [
      ["mis-listas", "¿Cómo encuentra la web mis listas?",
        [h("p", null, "Con el nombre de tu cuenta. Al entrar en Mi seguimiento, la web busca sola en qué listas y especialidades estás y las añade (como mucho una vez al día en cada dispositivo). No tienes que apuntar nada a mano."),
          h("p", null, "Solo salen en los PDF las personas a las que Educaragón ya ha llamado alguna vez este curso, así que si todavía no te han convocado puede que no aparezcas: lo seguimos comprobando cada día. Si hay otra persona con tu mismo nombre, te pedirá las cifras visibles de tu DNI para distinguiros; no se guardan."),
          h("p", null, "El nombre no se cambia desde la web. Si está mal escrito, usa «Avisa a la administración» al final de Mi seguimiento y lo corregimos.")]],
      ["probabilidad", "¿Cómo se calcula la probabilidad de conseguir plaza?",
        [h("p", null, "Mira en cuántas semanas del curso el último llamado llegó a tu posición, da más peso a las últimas semanas y calcula la probabilidad de que pase en alguna de las 3 próximas. Es solo una estimación con datos públicos."),
          h("p", null, "No puede decir cuántas personas compiten contigo ni tu puesto exacto: Aragón no publica las peticiones de destinos, y no sabe si estás disponible ni qué plazas pedirás. El pasado no garantiza lo que pase.")]],
      ["favoritos", "¿Cómo funcionan los favoritos y los avisos?",
        [h("p", null, "Pulsa la estrella en la fila de un centro (en Vacantes o en Semana) y queda en «Mis centros favoritos». Si activas los avisos en la app, te avisamos cuando sale una vacante nueva o se adjudica una vacante en esos centros, y cuando se publica la adjudicación de una de tus listas."),
          h("p", null, "Los avisos se envían una vez cada tarde laborable, cuando se actualizan los datos. No enviamos avisos por correo. Se activan en ", enlace("Ajustes", "#/ajustes"), ", dispositivo a dispositivo (hasta 5 por cuenta).")]],
      ["app", "¿Puedo usarla como una app en el móvil?",
        [h("p", null, "Sí. En Chrome (Android) abre el menú y pulsa «Instalar aplicación»; en iPhone, en Safari pulsa Compartir y «Añadir a pantalla de inicio». En iPhone los avisos solo llegan si la añades a la pantalla de inicio (iOS 16.4 o posterior)."),
          h("p", null, "El pase de pago se compra con Google Play dentro de la app de Android.")]],
    ]],
    ["Cuenta y pago", [
      ["precio", "¿Qué es gratis y qué es de pago?",
        [h("p", null, "Semana, Histórico, Vacantes y Mapa son gratis y no piden cuenta. Mi seguimiento (tus listas, probabilidad, destinos, favoritos y avisos) es tu área personal: tienes ", h("strong", null, `${dias} días de prueba gratis`), ` al entrar la primera vez y después el pase del curso cuesta ${precio} (pago único, hasta el ${hasta}; no se renueva solo).`)]],
      ["invitar", "¿Cómo consigo la app gratis?",
        [h("p", null, "Comparte tu código de invitación (en Mi seguimiento, botón «Invitar y app gratis»). Si 3 compañeros crean su cuenta con tu código y activan su pase del curso, el tuyo es gratis hasta el final del curso. Cada persona puede usar un solo código y solo durante sus primeros 30 días.")]],
      ["cuenta", "¿Es la misma cuenta que en DocentsCV?",
        [h("p", null, "Sí: se entra con el mismo correo y la misma contraseña. Los datos de cada web (seguimiento y pase) se guardan por separado.")]],
    ]],
    ["Privacidad y ayuda", [
      ["privacidad", "¿Qué datos guardáis de mí?",
        [h("p", null, "Tu correo, lo que apuntas en Mi seguimiento (listas, destinos, favoritos), tu nombre y municipio si los has puesto, y los datos técnicos de tus dispositivos de avisos. Nunca guardamos tu DNI. La web pública no muestra nombres ni DNI de nadie."),
          h("p", null, "Puedes borrar todos tus datos de Aragón desde ", enlace("Ajustes", "#/ajustes"), " y pedir que eliminemos también tu cuenta de acceso en la página ", h("a", { href: "eliminar-cuenta.html" }, "Eliminar mi cuenta"), ". Todo el detalle está en la ", h("a", { href: "privacidad.html" }, "política de privacidad"), ".")]],
      ["contacto", "He visto algo que no está bien o tengo una idea",
        [h("p", null, CUENTA.activa && CUENTA.estado !== "anonimo"
          ? ["Escríbelo en ", enlace("Ajustes › Sugerencias y reclamaciones", "#/ajustes"), ": lo lee la administración y te contesta ahí mismo."]
          : "Entra en Mi seguimiento y usa «Sugerencias y reclamaciones» en Ajustes, o escribe a docentscv@gmail.com."),
          h("p", null, "Escribe a docentscv@gmail.com para cualquier otra cosa.")]],
    ]],
  ];
}

export function ayuda(raiz, params = {}) {
  const grupos = preguntas();
  const abierta = params.p || "";
  llenar(raiz,
    h("div", { class: "cabecera-vista" }, h("h2", null, "Ayuda"),
      h("p", { class: "tenue" }, "Respuestas a las preguntas más habituales. Si no encuentras la tuya, escríbenos desde Ajustes.")),
    h("div", { class: "ayuda-grupos" }, grupos.map(([titulo, items]) => h("section", { class: "bloque ayuda-grupo" },
      h("h3", null, titulo),
      items.map(([id, pregunta, respuesta]) => h("details", { class: "faq", id: `faq-${id}`, open: id === abierta }, h("summary", null, pregunta), h("div", { class: "faq-respuesta" }, respuesta)))))));
  if (abierta) setTimeout(() => document.getElementById(`faq-${abierta}`)?.scrollIntoView({ block: "start" }), 0);
}
