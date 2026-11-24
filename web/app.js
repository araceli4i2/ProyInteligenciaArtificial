/**
 * app.js - Lógica interactiva del Dashboard SolarRL La Paz
 * Carga datos JSON precalculados desde web/data/ y gestiona visualizaciones
 * con Chart.js y renderizado dinámico del DOM para las 8 secciones.
 */

// =============================================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// =============================================================================
const AppState = {
  datos: {
    clima: null,
    config: null,
    aprendizaje: null,
    metricas: null,
    semanas: null,
    politica: null,
  },
  graficos: {
    clima: null,
    aprendizaje: null,
    resultados: null,
    simDemanda: null,
    simSoc: null,
  },
  filtros: {
    periodo: "Prueba 2023-2024",
    epoca: "anual",
    metrica: "pct_critica_cubierta",
  },
  simulador: {
    semanaIdx: 0,
    estrategia: "agente",
    compararVoraz: false,
  },
  politica: {
    nivelRad: 3, // Radiación alta por defecto
    nivelRadAyer: 1, // Día previo medio por defecto
  },
  mapaSolar: {
    mapa: null,
    capasCalor: [],
    marcadores: [],
    hora: 12,
    mes: 6, // Julio por defecto (época seca con sol radiante)
    reproduciendo: false,
    intervaloPlay: null,
  },
};

// Nombres canónicos de acciones y colores
const NOMBRES_ACCIONES = {
  0: "ALMACENAR",
  1: "EQUILIBRAR",
  2: "CONSUMIR",
};

const COLORES_ACCIONES = {
  0: "#d97706", // Ámbar / naranja
  1: "#0284c7", // Azul cielo
  2: "#10b981", // Verde esmeralda
};

// =============================================================================
// COLORES Y CONFIGURACIÓN DE TEMA
// =============================================================================
function esTemaOscuro() {
  return document.documentElement.classList.contains("dark");
}

function obtenerColoresTema() {
  const oscuro = esTemaOscuro();
  return {
    textoPrincipal: oscuro ? "#f1f5f9" : "#0f172a",
    textoMuted: oscuro ? "#94a3b8" : "#64748b",
    lineaGrid: oscuro ? "rgba(148, 163, 184, 0.12)" : "rgba(100, 116, 139, 0.15)",
    bgTooltip: oscuro ? "#0f172a" : "#ffffff",
    borderTooltip: oscuro ? "#334155" : "#e2e8f0",
    textoTooltip: oscuro ? "#f8fafc" : "#0f172a",
    solarAmbar: "#f59e0b",
    solarAmbarTrans: "rgba(245, 158, 11, 0.2)",
    cieloAzul: "#38bdf8",
    verdeEsmeralda: "#10b981",
    rojoVoraz: "#ef4444",
    indigoUmbral: "#6366f1",
    purpuraHoraria: "#a855f7",
  };
}

function inicializarTema() {
  const btnTheme = document.getElementById("btn-theme");
  const themeIcon = document.getElementById("theme-icon");

  const guardado = localStorage.getItem("solarrl-theme");
  if (guardado === "light") {
    document.documentElement.classList.remove("dark");
    if (themeIcon) themeIcon.textContent = "☀️";
  } else {
    document.documentElement.classList.add("dark");
    if (themeIcon) themeIcon.textContent = "🌙";
  }

  if (btnTheme) {
    btnTheme.addEventListener("click", () => {
      const ahoraOscuro = document.documentElement.classList.toggle("dark");
      if (themeIcon) themeIcon.textContent = ahoraOscuro ? "🌙" : "☀️";
      localStorage.setItem("solarrl-theme", ahoraOscuro ? "dark" : "light");
      actualizarEstilosGraficos();
    });
  }
}

function actualizarEstilosGraficos() {
  const c = obtenerColoresTema();

  Object.values(AppState.graficos).forEach((chart) => {
    if (!chart) return;

    if (chart.options.scales) {
      Object.keys(chart.options.scales).forEach((scaleKey) => {
        const scale = chart.options.scales[scaleKey];
        if (scale.ticks) scale.ticks.color = c.textoMuted;
        if (scale.grid) scale.grid.color = c.lineaGrid;
        if (scale.title) scale.title.color = c.textoPrincipal;
      });
    }

    if (chart.options.plugins && chart.options.plugins.legend) {
      chart.options.plugins.legend.labels.color = c.textoPrincipal;
    }

    chart.update();
  });
}

// =============================================================================
// CARGA ASÍNCRONA DE DATOS JSON (Con soporte offline y file:// sin servidor)
// =============================================================================
async function cargarDatosJSON() {
  const claves = ["clima", "config", "aprendizaje", "metricas", "semanas", "politica"];

  // 1. Si los datos están embebidos (ej. apertura directa de index.html con doble clic / protocolo file://)
  // o si no se dispone de servidor web local, usar inmediatamente los datos en memoria.
  const esProtocoloLocal = window.location.protocol === "file:" || !window.location.protocol;
  if (esProtocoloLocal && window.__DATOS_EMBEBIDOS__) {
    let completos = true;
    claves.forEach((k) => {
      if (window.__DATOS_EMBEBIDOS__[k]) {
        AppState.datos[k] = window.__DATOS_EMBEBIDOS__[k];
      } else {
        completos = false;
      }
    });
    if (completos) {
      console.info("Dashboard cargado en modo local (file://) usando datos_embebidos.js.");
      return true;
    }
  }

  // 2. Si se sirve a través de HTTP/HTTPS (GitHub Pages o servidor local), intentar fetch()
  const archivos = [
    { clave: "clima", url: "data/clima.json", seccionError: "datos-error" },
    { clave: "config", url: "data/config.json", seccionError: "modelo-error" },
    { clave: "aprendizaje", url: "data/aprendizaje.json", seccionError: "entrenamiento-error" },
    { clave: "metricas", url: "data/metricas.json", seccionError: "resultados-error" },
    { clave: "semanas", url: "data/semanas.json", seccionError: "simulador-error" },
    { clave: "politica", url: "data/politica.json", seccionError: "politica-error" },
  ];

  try {
    const respuestas = await Promise.all(
      archivos.map(async (item) => {
        try {
          const res = await fetch(item.url);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          }
          return { clave: item.clave, data: await res.json() };
        } catch (err) {
          // Si fetch() falla (ej. restricción de navegador o archivo faltante), recurrir a los datos embebidos
          if (window.__DATOS_EMBEBIDOS__ && window.__DATOS_EMBEBIDOS__[item.clave]) {
            console.warn(`Fallback activo para ${item.clave} tras fallo de fetch:`, err.message);
            return { clave: item.clave, data: window.__DATOS_EMBEBIDOS__[item.clave] };
          }
          mostrarError(item.seccionError, `No se pudo cargar '${item.url}': ${err.message}`);
          return { clave: item.clave, data: null };
        }
      })
    );

    let algunFallo = false;
    respuestas.forEach((item) => {
      AppState.datos[item.clave] = item.data;
      if (!item.data) algunFallo = true;
    });

    // Respaldo de contingencia: si alguna clave no cargó vía fetch, rellenar desde datos embebidos
    if (algunFallo && window.__DATOS_EMBEBIDOS__) {
      claves.forEach((k) => {
        if (!AppState.datos[k] && window.__DATOS_EMBEBIDOS__[k]) {
          AppState.datos[k] = window.__DATOS_EMBEBIDOS__[k];
        }
      });
    }

    return true;
  } catch (error) {
    if (window.__DATOS_EMBEBIDOS__) {
      claves.forEach((k) => {
        AppState.datos[k] = window.__DATOS_EMBEBIDOS__[k];
      });
      return true;
    }
    mostrarError("hero-error", `Error general en carga de datos: ${error.message}`);
    return false;
  }
}

function mostrarError(elementId, mensaje) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = `⚠️ ${mensaje}`;
    el.classList.remove("hidden");
  }
}

// =============================================================================
// SECCIÓN 1: HERO Y TARJETAS KPI
// =============================================================================
function renderizarHeroKPIs() {
  const metData = AppState.datos.metricas;
  if (!metData || !metData.metricas) {
    mostrarError("hero-error", "Datos de métricas no disponibles para las tarjetas KPI.");
    return;
  }

  const registrosPrueba = metData.metricas.filter(
    (m) => m.periodo === "Prueba 2023-2024" && m.epoca === "anual"
  );

  const regAgente = registrosPrueba.find((m) => m.estrategia.includes("Q-Learning"));
  const regVoraz = registrosPrueba.find((m) => m.estrategia === "Voraz");
  const regOraculo = registrosPrueba.find((m) => m.estrategia.includes("Oráculo"));

  if (regAgente) {
    const elCritAgente = document.getElementById("kpi-cob-crit-agente");
    if (elCritAgente) elCritAgente.textContent = `${regAgente.pct_critica_cubierta.toFixed(2)}%`;

    const elCiclosAgente = document.getElementById("kpi-ciclos-agente");
    if (elCiclosAgente) elCiclosAgente.textContent = `${regAgente.ciclos_bateria.toFixed(1)}`;

    const elPctOptimo = document.getElementById("kpi-pct-optimo");
    if (elPctOptimo) elPctOptimo.textContent = `${regAgente.pct_optimo_alcanzado.toFixed(1)}%`;

    const elRecAgente = document.getElementById("kpi-rec-agente");
    if (elRecAgente) elRecAgente.textContent = `${regAgente.recompensa_total.toFixed(1)}`;

    const elResumenCob = document.getElementById("kpi-cob-crit-resumen");
    if (elResumenCob) elResumenCob.textContent = `${regAgente.pct_critica_cubierta.toFixed(1)}%`;
  }

  if (regVoraz) {
    const elCritVoraz = document.getElementById("kpi-cob-crit-voraz");
    if (elCritVoraz) elCritVoraz.textContent = `${regVoraz.pct_critica_cubierta.toFixed(2)}%`;

    const elCiclosVoraz = document.getElementById("kpi-ciclos-voraz");
    if (elCiclosVoraz) elCiclosVoraz.textContent = `${regVoraz.ciclos_bateria.toFixed(1)} ciclos`;
  }

  if (regAgente && regVoraz) {
    const difCrit = (regAgente.pct_critica_cubierta - regVoraz.pct_critica_cubierta).toFixed(2);
    const elDifCrit = document.getElementById("kpi-dif-crit");
    if (elDifCrit) elDifCrit.textContent = difCrit;
  }

  if (regOraculo) {
    const elCritOraculo = document.getElementById("kpi-cob-crit-oraculo");
    if (elCritOraculo) elCritOraculo.textContent = `${regOraculo.pct_critica_cubierta.toFixed(2)}%`;

    const elRecOraculo = document.getElementById("kpi-rec-oraculo");
    if (elRecOraculo) elRecOraculo.textContent = `${regOraculo.recompensa_total.toFixed(1)}`;
  }
}

// =============================================================================
// SECCIÓN 1.B: MAPA SOLAR DEPARTAMENTAL DE LA PAZ (METEOROLÓGICO CONTINUO)
// =============================================================================

// Red de nodos representativos que cubren las 20 provincias del Dpto. de La Paz
// [latitud, longitud, factor_microclima, nombre_zona, altitud_m]
const NODOS_DEPARTAMENTALES_LA_PAZ = [
  // 1. Cuenca Central y Altiplano Metropolitano (Murillo / Ingavi)
  [-16.5000, -68.1500, 1.00, "La Paz (Microrred Murillo)", 3600],
  [-16.5100, -68.1950, 1.04, "El Alto (Altiplano Central)", 4050],
  [-16.5400, -68.0850, 0.98, "Zona Sur (Calacoto/Achumani)", 3250],
  [-16.6000, -68.0400, 0.97, "Mecapaca (Río Abajo)", 2850],
  [-16.6500, -68.3000, 1.03, "Viacha (Ingavi)", 3870],
  [-16.5300, -68.3500, 1.03, "Laja (Los Andes)", 3860],
  [-16.7000, -68.5000, 1.04, "Tiahuanacu (Ingavi)", 3885],

  // 2. Altiplano Sur y Pacajes (Aroma / Pacajes / Gualberto Villarroel)
  [-17.0000, -68.1000, 1.04, "Ayo Ayo (Aroma)", 3810],
  [-17.2330, -67.9170, 1.05, "Patacamaya (Aroma)", 3790],
  [-17.3500, -67.7500, 1.05, "Sica Sica (Aroma)", 3800],
  [-17.2000, -68.5500, 1.05, "Caquiaviri (Pacajes)", 3900],
  [-17.5000, -68.6000, 1.06, "Comanche (Pacajes)", 4000],
  [-17.6000, -69.2000, 1.06, "Charaña (Frontera Andina)", 4050],
  [-17.8000, -68.1000, 1.05, "Curahuara / Límite Sur", 3890],

  // 3. Región Lago Titicaca y Omasuyos (Manco Kapac / Omasuyos / Eliodoro Camacho)
  [-16.1660, -69.0850, 1.02, "Copacabana (Lago Titicaca)", 3812],
  [-16.0000, -69.1800, 1.02, "Isla del Sol (Titicaca)", 3950],
  [-16.0440, -68.6830, 1.01, "Achacachi (Omasuyos)", 3850],
  [-15.8000, -69.1000, 1.02, "Puerto Acosta (Camacho)", 3840],
  [-15.6000, -69.0000, 1.02, "Ulla Ulla (Frontera Altiplánica)", 4200],
  [-16.3000, -68.7000, 1.01, "Huatajata (Lago Menor)", 3815],

  // 4. Cordillera Real (Cumbres y Estribaciones Glaciares)
  [-16.6500, -67.7900, 1.06, "Nevado Illimani", 6438],
  [-16.3500, -68.1200, 1.06, "Huayna Potosí", 6088],
  [-16.1000, -68.2500, 1.05, "Condoriri (Cordillera Real)", 5648],
  [-15.8500, -68.5500, 1.05, "Nevado Illampu", 6368],

  // 5. Valles Interandinos y Cabeceras de Valle (Loayza / Inquisivi)
  [-16.9000, -67.7000, 0.98, "Luribay (Loayza)", 2650],
  [-17.0500, -67.5500, 0.98, "Sapahaqui (Loayza)", 2900],
  [-16.8500, -67.1500, 0.97, "Inquisivi (Valles)", 2760],
  [-16.7000, -67.3500, 0.97, "Cajuata (Inquisivi)", 2450],

  // 6. Yungas y Faja Subandina (Nor Yungas / Sud Yungas / Caranavi)
  [-16.1900, -67.7270, 0.84, "Coroico (Nor Yungas)", 1750],
  [-16.4080, -67.5250, 0.85, "Chulumani (Sud Yungas)", 1740],
  [-16.3500, -67.4000, 0.85, "Irupana (Sud Yungas)", 1900],
  [-16.5000, -67.2500, 0.86, "La Asunta (Sud Yungas)", 1300],
  [-15.8200, -67.5700, 0.87, "Caranavi (Puerta Amazónica)", 975],
  [-15.6500, -67.4000, 0.88, "Palos Blancos (Sud Yungas)", 480],

  // 7. Norte Paceño y Pie de Monte (Larecaja / Franz Tamayo)
  [-15.7720, -68.6490, 0.96, "Sorata (Valle del Illampu)", 2670],
  [-15.5500, -68.3500, 0.92, "Tipuani (Larecaja)", 550],
  [-15.4000, -68.1000, 0.91, "Guanay (Larecaja)", 480],
  [-14.7170, -68.5170, 0.89, "Apolo (Franz Tamayo)", 1430],
  [-15.0000, -68.9000, 0.92, "Pelechuco (Apolobamba)", 3600],

  // 8. Llanura Amazónica del Norte (Abel Iturralde / Madidi)
  [-14.4330, -67.5330, 0.87, "San Buenaventura / Rurrenabaque", 230],
  [-13.7670, -68.1330, 0.88, "Ixiamas (Abel Iturralde)", 260],
  [-13.2000, -68.2500, 0.89, "Parque Nacional Madidi", 220],
  [-12.7000, -68.3500, 0.89, "Alto Madidi", 200],
  [-12.2000, -68.5000, 0.90, "Chive / Río Madre de Dios", 180],
  [-11.8500, -68.6000, 0.90, "Extremo Norte Paceño", 160]
];

function inicializarMapaSolar() {
  const contenedor = document.getElementById("mapa-la-paz");
  if (!contenedor || typeof L === "undefined") return;

  // Si ya existía un mapa, no reinicializarlo
  if (AppState.mapaSolar.mapa) return;

  const clima = AppState.datos.clima;
  if (!clima) return;

  // 1. Inicializar mapa Leaflet centrado en el Departamento de La Paz
  // Centro regional: Lat -15.65°S, Lon -68.10°W, Zoom 7 (vista departamental completa)
  const centroDepartamental = [-15.6500, -68.1000];
  const mapa = L.map("mapa-la-paz", {
    center: centroDepartamental,
    zoom: 7,
    minZoom: 6,
    maxZoom: 13,
    zoomControl: true,
  });

  // 2. Capa base cartográfica blanca libre (ESRI World Light Gray Base - SIN API KEY)
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 16,
    attribution: '&copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
  }).addTo(mapa);

  AppState.mapaSolar.mapa = mapa;

  // 3. Crear capa de interpolación térmica continua (Leaflet.heat) con escala meteorológica
  if (typeof L.heatLayer === "function") {
    const heat = L.heatLayer([], {
      radius: 38,
      blur: 26,
      maxZoom: 9,
      max: 1.0,
      minOpacity: 0.18,
      gradient: {
        0.10: "#3b82f6", // Azul (baja / crepúsculo)
        0.25: "#06b6d4", // Cyan
        0.42: "#22c55e", // Verde (nubosidad / Yungas)
        0.62: "#eab308", // Amarillo (moderada)
        0.78: "#f97316", // Naranja (alta)
        0.90: "#ef4444", // Rojo (muy alta)
        1.00: "#ec4899", // Magenta brillante (Pico Altiplánico >1000 W/m²)
      },
    }).addTo(mapa);

    AppState.mapaSolar.capaHeatmap = heat;
  }

  // 4. Estaciones de Monitoreo Departamental con Popups Técnicos
  const estiloIcono = (icono, colorBg = "#f59e0b") => L.divIcon({
    className: "custom-solar-marker",
    html: `<div style="background-color: ${colorBg}; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 8px rgba(0,0,0,0.3); border: 2px solid white; font-size: 13px;">${icono}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  });

  const estaciones = [
    { coords: [-16.5000, -68.1500], icono: "⚡", bg: "#f59e0b", titulo: "📍 Microrred La Paz (Murillo)", alt: 3600, desc: "Sitio de simulación con IA. 1 kWp FV + 2.4 kWh batería (RL Q-Learning)." },
    { coords: [-16.5100, -68.1950], icono: "🏔️", bg: "#0284c7", titulo: "🏔️ El Alto (Altiplano Central)", alt: 4050, desc: "Meseta altiplánica: máxima irradiación directa y mínima densidad atmosférica." },
    { coords: [-16.1660, -69.0850], icono: "⛵", bg: "#06b6d4", titulo: "⛵ Copacabana (Lago Titicaca)", alt: 3812, desc: "Altiplano lacustre: alta claridad atmosférica y reflexión sobre el espejo de agua." },
    { coords: [-17.2330, -67.9170], icono: "🌾", bg: "#8b5cf6", titulo: "🌾 Patacamaya (Aroma)", alt: 3790, desc: "Altiplano sur seco: radiación global excelente y cielos despejados de invierno." },
    { coords: [-16.0440, -68.6830], icono: "🌾", bg: "#0284c7", titulo: "🌾 Achacachi (Omasuyos)", alt: 3850, desc: "Planicie lacustre-andina: óptimo potencial para bombeo solar agrícola." },
    { coords: [-16.1900, -67.7270], icono: "🌿", bg: "#10b981", titulo: "🌿 Coroico (Nor Yungas)", alt: 1750, desc: "Valles húmedos de montaña: radiación atenuada por condensación orográfica." },
    { coords: [-15.8200, -67.5700], icono: "☕", bg: "#14b8a6", titulo: "☕ Caranavi (Faja Subandina)", alt: 975, desc: "Puerta de la Amazonía: transición tropical con humedad moderada." },
    { coords: [-15.7720, -68.6490], icono: "🏔️", bg: "#6366f1", titulo: "🏔️ Sorata (Larecaja)", alt: 2670, desc: "Valle interandino profundo al pie del macizo Illampu." },
    { coords: [-14.7170, -68.5170], icono: "🌳", bg: "#22c55e", titulo: "🌳 Apolo (Franz Tamayo)", alt: 1430, desc: "Cabeceras de cuenca amazónica y Parque Nacional Madidi." },
    { coords: [-13.7670, -68.1330], icono: "🌴", bg: "#15803d", titulo: "🌴 Ixiamas (Abel Iturralde)", alt: 260, desc: "Norte paceño: llanura amazónica tropical con régimen de radiación difusa." },
    { coords: [-16.6500, -67.7900], icono: "❄️", bg: "#4f46e5", titulo: "❄️ Nevado Illimani", alt: 6438, desc: "Pico tutelar de la Cordillera Real que corona el valle de La Paz." },
  ];

  const marcadoresObj = [];
  estaciones.forEach((est) => {
    const m = L.marker(est.coords, { icon: estiloIcono(est.icono, est.bg) }).addTo(mapa);
    m.bindPopup(`
      <div style="font-family: sans-serif; font-size: 12px; color: #0f172a; line-height: 1.45; min-width: 180px;">
        <strong style="color: ${est.bg}; font-size: 13px;">${est.titulo}</strong><br>
        <b>Altitud:</b> ~${est.alt.toLocaleString()} msnm<br>
        <p style="margin: 4px 0 0; color: #475569; font-size: 11px;">${est.desc}</p>
        <div style="margin-top: 6px; padding-top: 4px; border-top: 1px solid #e2e8f0; font-size: 11px;">
          <b>Radiación estimada:</b> <span class="popup-ghi-val font-mono font-bold" style="color: #d97706;">-- W/m²</span>
        </div>
      </div>
    `);
    marcadoresObj.push({ marker: m, factor: (NODOS_DEPARTAMENTALES_LA_PAZ.find(n => n[0] === est.coords[0] && n[1] === est.coords[1])?.[2] ?? 1.0) });
  });

  AppState.mapaSolar.marcadores = marcadoresObj;

  // 5. Poblar selector de meses en el DOM
  const selectMes = document.getElementById("mapa-select-mes");
  if (selectMes && clima.nombres_meses) {
    selectMes.innerHTML = "";
    clima.nombres_meses.forEach((nom, idx) => {
      const opt = document.createElement("option");
      opt.value = idx;
      opt.textContent = `${nom} (${clima.epocas_meses[idx]})`;
      if (idx === AppState.mapaSolar.mes) opt.selected = true;
      selectMes.appendChild(opt);
    });

    selectMes.addEventListener("change", (e) => {
      AppState.mapaSolar.mes = parseInt(e.target.value, 10);
      actualizarMapaSolar();
    });
  }

  // 6. Conectar slider horario
  const sliderHora = document.getElementById("slider-mapa-hora");
  if (sliderHora) {
    sliderHora.value = AppState.mapaSolar.hora;
    sliderHora.addEventListener("input", (e) => {
      AppState.mapaSolar.hora = parseInt(e.target.value, 10);
      actualizarMapaSolar();
    });
  }

  // 7. Botón Play/Pausa de animación 24h
  const btnPlay = document.getElementById("btn-mapa-play");
  if (btnPlay) {
    btnPlay.addEventListener("click", togglePlayMapaSolar);
  }

  // 8. Botones de acceso rápido a épocas
  document.querySelectorAll(".btn-mapa-epoca").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mesIdx = parseInt(btn.getAttribute("data-mapa-mes"), 10);
      if (!isNaN(mesIdx)) {
        AppState.mapaSolar.mes = mesIdx;
        if (selectMes) selectMes.value = mesIdx;
        actualizarMapaSolar();
      }
    });
  });

  // Ejecutar primer renderizado del mapa departamental
  actualizarMapaSolar();
}

function actualizarMapaSolar() {
  const clima = AppState.datos.clima;
  if (!clima) return;

  const hora = AppState.mapaSolar.hora;
  const mes = AppState.mapaSolar.mes;

  // 1. Obtener valores climáticos base de La Paz (NASA POWER)
  const matriz = clima.matriz_ghi_hora_mes;
  const ghiBase = (matriz && matriz[hora] && matriz[hora][mes] !== undefined) ? matriz[hora][mes] : 0;
  const tempMes = clima.temperatura_media_mes?.[mes] ?? 8.5;

  // Modelo de temperatura diurna en Altiplano
  const factorCicloTemp = hora >= 6 && hora <= 18 ? Math.sin(((hora - 6) / 12) * Math.PI) * 5.2 : -3.2;
  const tempEstimada = Math.round((tempMes + factorCicloTemp) * 10) / 10;

  // 2. Potencia FV estimada (1 kWp con PR y corrección por temperatura)
  const potNominal = AppState.datos.config?.fotovoltaico?.potencia_pico_kw ?? 0.75;
  const pr = AppState.datos.config?.fotovoltaico?.rendimiento_pr ?? 0.8;
  const gamma = AppState.datos.config?.fotovoltaico?.coef_temperatura_por_c ?? -0.004;
  const tRef = AppState.datos.config?.fotovoltaico?.temp_ref_stc_c ?? 25.0;
  const factorTemp = 1.0 + gamma * (tempEstimada - tRef);
  const pvEstimado = Math.max(0, (potNominal * (ghiBase / 1000) * factorTemp * pr));

  // 3. Actualizar controles en el DOM
  const lblHora = document.getElementById("lbl-mapa-hora");
  if (lblHora) lblHora.textContent = `${hora.toString().padStart(2, "0")}:00 h`;

  const sliderHora = document.getElementById("slider-mapa-hora");
  if (sliderHora && parseInt(sliderHora.value, 10) !== hora) {
    sliderHora.value = hora;
  }

  // 4. Actualizar Telemetría HUD
  const elGhiVal = document.getElementById("hud-ghi-valor");
  if (elGhiVal) elGhiVal.textContent = ghiBase.toFixed(1);

  const elGhiBar = document.getElementById("hud-ghi-bar");
  if (elGhiBar) elGhiBar.style.width = `${Math.min(100, (ghiBase / 1100) * 100).toFixed(1)}%`;

  const elLeyendaVal = document.getElementById("mapa-leyenda-val");
  if (elLeyendaVal) elLeyendaVal.textContent = `${ghiBase.toFixed(1)} W/m²`;

  const elTempVal = document.getElementById("hud-temp-valor");
  if (elTempVal) elTempVal.textContent = tempEstimada.toFixed(1);

  const elPvVal = document.getElementById("hud-pv-valor");
  if (elPvVal) elPvVal.textContent = pvEstimado.toFixed(2);

  const elEpocaBadge = document.getElementById("hud-epoca-badge");
  const nomEpoca = clima.epocas_meses?.[mes] ?? "seca";
  if (elEpocaBadge) {
    elEpocaBadge.textContent = nomEpoca === "seca" ? "Época Seca (Invierno)" : (nomEpoca === "lluviosa" ? "Época Lluviosa (Verano)" : "Transición");
  }

  // Estado del sol descriptivo
  const elSolEstado = document.getElementById("hud-sol-estado");
  if (elSolEstado) {
    if (ghiBase <= 1) elSolEstado.textContent = "Noche (Sin radiación solar)";
    else if (ghiBase < 200) elSolEstado.textContent = "Amanecer / Crepúsculo andino";
    else if (ghiBase < 600) elSolEstado.textContent = "Radiación solar moderada";
    else if (ghiBase < 850) elSolEstado.textContent = "Fuerte radiación solar andina";
    else elSolEstado.textContent = "Pico Cenital Altiplánico (>850 W/m²)";
  }

  // Régimen atmosférico solar
  const elSolBadge = document.getElementById("hud-sol-badge");
  const elSolDesc = document.getElementById("hud-sol-desc");
  if (elSolBadge && elSolDesc) {
    if (ghiBase >= 750) {
      elSolBadge.textContent = "PICO ANDINO";
      elSolBadge.className = "px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-red-500/20 text-red-400 border border-red-500/40";
      elSolDesc.textContent = "Atmósfera andina diáfana de máxima transparencia y penetración solar directa.";
    } else if (ghiBase >= 350) {
      elSolBadge.textContent = "MODERADO";
      elSolBadge.className = "px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-amber-500/20 text-solar-400 border border-solar-500/40";
      elSolDesc.textContent = "Generación solar continua favorable en valles interandinos y pie de monte.";
    } else if (ghiBase > 10) {
      elSolBadge.textContent = "CREPÚSCULO";
      elSolBadge.className = "px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-sky-500/20 text-sky-400 border border-sky-500/40";
      elSolDesc.textContent = "Transición solar matutina / vespertina con dispersión atmosférica.";
    } else {
      elSolBadge.textContent = "NOCTURNO";
      elSolBadge.className = "px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-slate-800 text-slate-400 border border-slate-700";
      elSolDesc.textContent = "Periodo nocturno sin irradiación solar (0 W/m²).";
    }
  }

  // Estadísticas históricas del mes
  const elIrradMedia = document.getElementById("hud-irrad-media");
  const elIrradRango = document.getElementById("hud-irrad-rango");
  if (clima.irradiacion_diaria_mes) {
    const med = clima.irradiacion_diaria_mes.media?.[mes] ?? 0;
    const p10 = clima.irradiacion_diaria_mes.p10?.[mes] ?? 0;
    const p90 = clima.irradiacion_diaria_mes.p90?.[mes] ?? 0;
    if (elIrradMedia) elIrradMedia.textContent = `${med.toFixed(2)} kWh/m²/d`;
    if (elIrradRango) elIrradRango.textContent = `P10: ${p10.toFixed(2)} — P90: ${p90.toFixed(2)}`;
  }

  // 5. Actualizar la capa de calor continuo meteorológico (Leaflet.heat)
  if (AppState.mapaSolar.capaHeatmap) {
    if (ghiBase <= 1) {
      // De noche: limpiar la capa para dejar el mapa blanco nítido
      AppState.mapaSolar.capaHeatmap.setLatLngs([]);
    } else {
      const puntosHeat = [];
      const escalaNorm = 1100.0; // Normalización contra pico solar máximo

      NODOS_DEPARTAMENTALES_LA_PAZ.forEach(([lat, lon, factorMicro]) => {
        // En época lluviosa, los Yungas sufren mayor atenuación por nubosidad
        const factorEstacional = (nomEpoca === "lluviosa" && factorMicro < 0.95) ? factorMicro * 0.88 : factorMicro;
        const ghiLocal = ghiBase * factorEstacional;
        const intensidad = Math.min(1.0, Math.max(0.05, ghiLocal / escalaNorm));

        // Punto principal del nodo
        puntosHeat.push([lat, lon, intensidad]);

        // Nodos vecinos de dispersión espacial para suavizar la malla continua
        const offset = 0.08;
        puntosHeat.push([lat + offset, lon, intensidad * 0.92]);
        puntosHeat.push([lat - offset, lon, intensidad * 0.92]);
        puntosHeat.push([lat, lon + offset, intensidad * 0.92]);
        puntosHeat.push([lat, lon - offset, intensidad * 0.92]);
      });

      AppState.mapaSolar.capaHeatmap.setLatLngs(puntosHeat);
    }
  }

  // 6. Actualizar radiación estimada en los popups de las estaciones
  if (AppState.mapaSolar.marcadores && AppState.mapaSolar.marcadores.length > 0) {
    AppState.mapaSolar.marcadores.forEach(({ marker, factor }) => {
      const ghiEstacion = ghiBase <= 1 ? 0 : Math.round(ghiBase * factor * 10) / 10;
      const popup = marker.getPopup();
      if (popup && popup.isOpen()) {
        const popupEl = popup.getElement();
        if (popupEl) {
          const valEl = popupEl.querySelector(".popup-ghi-val");
          if (valEl) valEl.textContent = `${ghiEstacion.toFixed(1)} W/m²`;
        }
      }
    });
  }
}

function togglePlayMapaSolar() {
  const btn = document.getElementById("btn-mapa-play");
  const icon = document.getElementById("mapa-play-icon");
  const txt = document.getElementById("mapa-play-text");

  if (AppState.mapaSolar.reproduciendo) {
    clearInterval(AppState.mapaSolar.intervaloPlay);
    AppState.mapaSolar.intervaloPlay = null;
    AppState.mapaSolar.reproduciendo = false;
    if (icon) icon.textContent = "▶️";
    if (txt) txt.textContent = "Reproducir 24h";
    if (btn) btn.classList.replace("bg-amber-600", "bg-solar-500");
  } else {
    AppState.mapaSolar.reproduciendo = true;
    if (icon) icon.textContent = "⏸️";
    if (txt) txt.textContent = "Pausar";
    if (btn) btn.classList.replace("bg-solar-500", "bg-amber-600");

    AppState.mapaSolar.intervaloPlay = setInterval(() => {
      AppState.mapaSolar.hora = (AppState.mapaSolar.hora + 1) % 24;
      actualizarMapaSolar();
    }, 750);
  }
}

// =============================================================================
// SECCIÓN 2: DATOS CLIMÁTICOS (HEATMAP + GRÁFICO DIARIO)
// =============================================================================
function renderizarDatosClima() {
  const clima = AppState.datos.clima;
  if (!clima) {
    mostrarError("datos-error", "No se cargaron los datos climáticos.");
    return;
  }

  renderizarHeatmap(clima);
  renderizarGraficoClima(clima);
}

function renderizarHeatmap(clima) {
  const contenedor = document.getElementById("heatmap-container");
  if (!contenedor) return;

  const matriz = clima.matriz_ghi_hora_mes;
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const maxGHI = 850.0;

  let html = `<div class="grid grid-cols-[45px_repeat(12,1fr)] gap-1 text-[10px] items-center">`;

  html += `<div class="font-bold text-slate-400 text-center">Hora</div>`;
  meses.forEach((mes) => {
    html += `<div class="font-semibold text-slate-300 text-center py-1 truncate">${mes}</div>`;
  });

  for (let h = 0; h < 24; h++) {
    const horaLabel = `${String(h).padStart(2, "0")}:00`;
    html += `<div class="font-mono text-slate-400 text-right pr-1">${horaLabel}</div>`;

    for (let m = 0; m < 12; m++) {
      const ghi = matriz[h][m];
      const ratio = Math.min(Math.max(ghi / maxGHI, 0), 1);

      let bgEstilo;
      if (ghi < 2) {
        bgEstilo = "background-color: rgba(30, 41, 59, 0.4);";
      } else {
        const light = 18 + ratio * 42;
        const alpha = 0.35 + ratio * 0.65;
        bgEstilo = `background-color: hsla(38, 95%, ${light}%, ${alpha});`;
      }

      const tooltip = `Mes: ${clima.nombres_meses[m]} | Hora: ${horaLabel} | GHI: ${ghi.toFixed(1)} W/m²`;

      html += `<div class="heatmap-cell rounded-sm flex items-center justify-center cursor-pointer" 
                    style="${bgEstilo}" 
                    title="${tooltip}">
               </div>`;
    }
  }

  html += `</div>`;
  contenedor.innerHTML = html;
}

function renderizarGraficoClima(clima) {
  const ctx = document.getElementById("chart-clima");
  if (!ctx) return;

  const c = obtenerColoresTema();
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  AppState.graficos.clima = new Chart(ctx, {
    type: "line",
    data: {
      labels: meses,
      datasets: [
        {
          label: "P90 Irradiación",
          data: clima.irradiacion_diaria_mes.p90,
          borderColor: "transparent",
          backgroundColor: "rgba(245, 158, 11, 0.15)",
          fill: "+1",
          pointRadius: 0,
          yAxisID: "y",
        },
        {
          label: "P10 Irradiación",
          data: clima.irradiacion_diaria_mes.p10,
          borderColor: "transparent",
          backgroundColor: "transparent",
          fill: false,
          pointRadius: 0,
          yAxisID: "y",
        },
        {
          label: "Irradiación Media (kWh/m²/d)",
          data: clima.irradiacion_diaria_mes.media,
          borderColor: c.solarAmbar,
          backgroundColor: c.solarAmbar,
          borderWidth: 2.5,
          pointRadius: 3,
          tension: 0.3,
          yAxisID: "y",
        },
        {
          label: "Temperatura Media (°C)",
          data: clima.temperatura_media_mes,
          borderColor: c.cieloAzul,
          backgroundColor: c.cieloAzul,
          borderWidth: 2,
          pointRadius: 3,
          borderDash: [4, 4],
          tension: 0.3,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c.bgTooltip,
          titleColor: c.textoTooltip,
          bodyColor: c.textoTooltip,
          borderColor: c.borderTooltip,
          borderWidth: 1,
        },
      },
      scales: {
        x: { ticks: { color: c.textoMuted, font: { size: 11 } }, grid: { color: c.lineaGrid } },
        y: {
          type: "linear",
          position: "left",
          title: { display: true, text: "Irradiación (kWh/m²/d)", color: c.solarAmbar },
          ticks: { color: c.textoMuted },
          grid: { color: c.lineaGrid },
          min: 3.5,
          max: 9.0,
        },
        y1: {
          type: "linear",
          position: "right",
          title: { display: true, text: "Temperatura (°C)", color: c.cieloAzul },
          ticks: { color: c.textoMuted },
          grid: { drawOnChartArea: false },
          min: 4,
          max: 16,
        },
      },
    },
  });
}

// =============================================================================
// SECCIÓN 3: MODELO MDP
// =============================================================================
function renderizarModeloMDP() {
  const cfg = AppState.datos.config;
  if (!cfg) {
    mostrarError("modelo-error", "No se cargó la configuración del modelo.");
    return;
  }

  const setTxt = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setTxt("mdp-estados-total", `${cfg.discretizacion.total_estados} estados`);
  setTxt("mdp-num-horas", `${cfg.discretizacion.num_horas} horas (0–23 h)`);
  setTxt("mdp-num-soc", `${cfg.discretizacion.num_soc} niveles (20–100%)`);
  setTxt("mdp-num-ghi", `${cfg.discretizacion.num_ghi} cuantiles`);
  setTxt("mdp-num-ghi-ayer", `${cfg.discretizacion.num_ghi_ayer} terciles`);

  setTxt("mdp-peso-crit", `-${cfg.recompensa.peso_no_srv_crit.toFixed(1)} / kWh`);
  setTxt("mdp-peso-nc", `-${cfg.recompensa.peso_no_srv_nc.toFixed(1)} / kWh`);
  setTxt("mdp-peso-bat", `-${cfg.recompensa.peso_bateria.toFixed(2)} / kWh`);

  setTxt("mdp-fv-pico", `${cfg.fotovoltaico.potencia_pico_kw.toFixed(2)} kWp`);
  setTxt("mdp-fv-pr", `${cfg.fotovoltaico.rendimiento_pr.toFixed(2)}`);
  setTxt("mdp-bat-cap", `${cfg.bateria.capacidad_nominal_kwh.toFixed(1)} kWh (${cfg.bateria.capacidad_util_kwh.toFixed(2)} útiles)`);
  setTxt("mdp-bat-soc-rango", `${(cfg.bateria.soc_min * 100).toFixed(0)}% – ${(cfg.bateria.soc_max * 100).toFixed(0)}%`);
  setTxt("mdp-bat-eficiencia", `${cfg.bateria.eficiencia_carga.toFixed(2)} / ${cfg.bateria.eficiencia_descarga.toFixed(2)}`);
}

// =============================================================================
// SECCIÓN 4: ENTRENAMIENTO
// =============================================================================
function renderizarEntrenamiento() {
  const ap = AppState.datos.aprendizaje;
  const cfg = AppState.datos.config;

  if (!ap) {
    mostrarError("entrenamiento-error", "No se cargó la curva de aprendizaje.");
    return;
  }

  if (cfg && cfg.q_learning) {
    const q = cfg.q_learning;
    const setTxt = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setTxt("param-episodios", q.episodios.toLocaleString());
    setTxt("param-horas-ep", `${q.horas_por_episodio} h (1 semana)`);
    setTxt("param-alfa", q.alfa.toFixed(2));
    setTxt("param-gamma", q.gamma.toFixed(2));
    setTxt("param-epsilon", `${q.epsilon_inicial.toFixed(1)} → ${q.epsilon_final.toFixed(2)}`);
    setTxt("param-decay", `${(q.fraccion_decay * 100).toFixed(0)}% episodios`);
    setTxt("param-train-years", cfg.division_temporal.entrenamiento.join("–"));
    setTxt("param-val-year", cfg.division_temporal.validacion.join(", "));
    setTxt("param-semilla", q.semilla.toString());
  }

  let mejorRec = -Infinity;
  let mejorEp = 0;
  for (let i = 0; i < ap.recompensa_val.length; i++) {
    if (ap.recompensa_val[i] > mejorRec) {
      mejorRec = ap.recompensa_val[i];
      mejorEp = ap.episodios[i];
    }
  }

  const elMejorRec = document.getElementById("train-best-reward");
  const elMejorEp = document.getElementById("train-best-ep");
  if (elMejorRec) elMejorRec.textContent = mejorRec.toFixed(2);
  if (elMejorEp) elMejorEp.textContent = mejorEp.toLocaleString();

  const ctx = document.getElementById("chart-aprendizaje");
  if (!ctx) return;

  const c = obtenerColoresTema();

  AppState.graficos.aprendizaje = new Chart(ctx, {
    type: "line",
    data: {
      labels: ap.episodios,
      datasets: [
        {
          label: "Recompensa Validación (Año 2022)",
          data: ap.recompensa_val,
          borderColor: c.solarAmbar,
          backgroundColor: c.solarAmbarTrans,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          title: { display: true, text: "Episodios de Entrenamiento", color: c.textoMuted },
          ticks: { color: c.textoMuted, maxTicksLimit: 12 },
          grid: { color: c.lineaGrid },
        },
        y: {
          title: { display: true, text: "Recompensa Anual", color: c.solarAmbar },
          ticks: { color: c.textoMuted },
          grid: { color: c.lineaGrid },
        },
      },
    },
  });
}

// =============================================================================
// SECCIÓN 5: RESULTADOS Y COMPARATIVA
// =============================================================================
function inicializarFiltrosResultados() {
  const selPeriodo = document.getElementById("select-periodo");
  const selEpoca = document.getElementById("select-epoca");
  const selMetrica = document.getElementById("select-metrica-grafico");

  if (selPeriodo) {
    selPeriodo.addEventListener("change", (e) => {
      AppState.filtros.periodo = e.target.value;
      actualizarResultados();
    });
  }

  if (selEpoca) {
    selEpoca.addEventListener("change", (e) => {
      AppState.filtros.epoca = e.target.value;
      actualizarResultados();
    });
  }

  if (selMetrica) {
    selMetrica.addEventListener("change", (e) => {
      AppState.filtros.metrica = e.target.value;
      actualizarResultados();
    });
  }
}

function actualizarResultados() {
  const metData = AppState.datos.metricas;
  if (!metData || !metData.metricas) {
    mostrarError("resultados-error", "Datos de métricas no disponibles.");
    return;
  }

  const { periodo, epoca, metrica } = AppState.filtros;

  const registrosFiltrados = metData.metricas.filter(
    (m) => m.periodo === periodo && m.epoca === epoca
  );

  if (registrosFiltrados.length === 0) {
    mostrarError("resultados-error", `No hay datos para periodo '${periodo}' y época '${epoca}'.`);
    return;
  }

  const ordenEstrategias = ["Voraz", "Umbral SoC", "Horaria", "Q-Learning (RL)", "Oráculo (DP)"];
  const registrosOrdenados = [...registrosFiltrados].sort((a, b) => {
    return ordenEstrategias.indexOf(a.estrategia) - ordenEstrategias.indexOf(b.estrategia);
  });

  renderizarTablaResultados(registrosOrdenados);
  renderizarGraficoBarrasResultados(registrosOrdenados, metrica);
}

function renderizarTablaResultados(registros) {
  const tbody = document.getElementById("tabla-metricas-body");
  if (!tbody) return;

  tbody.innerHTML = "";

  registros.forEach((reg) => {
    const esRL = reg.estrategia.includes("Q-Learning");
    const esOraculo = reg.estrategia.includes("Oráculo");

    const tr = document.createElement("tr");
    tr.className = esRL
      ? "bg-solar-500/10 hover:bg-solar-500/20 font-semibold transition-colors"
      : "hover:bg-slate-800/40 transition-colors";

    let nombreHtml = `<span class="font-sans font-bold text-slate-200">${reg.estrategia}</span>`;
    if (esRL) {
      nombreHtml = `<span class="inline-flex items-center gap-1.5 font-sans font-bold text-solar-400">
                      <span class="w-2 h-2 rounded-full bg-solar-400"></span> ${reg.estrategia}
                    </span>`;
    } else if (esOraculo) {
      nombreHtml = `<span class="inline-flex items-center gap-1.5 font-sans font-medium text-emerald-400">
                      <span>★</span> ${reg.estrategia}
                    </span>`;
    }

    tr.innerHTML = `
      <td class="py-3 px-3">${nombreHtml}</td>
      <td class="py-3 px-3 text-right ${esRL ? "text-solar-400 font-bold" : "text-slate-200"}">${reg.pct_critica_cubierta.toFixed(2)}%</td>
      <td class="py-3 px-3 text-right text-slate-300">${reg.pct_no_critica_cubierta.toFixed(2)}%</td>
      <td class="py-3 px-3 text-right text-slate-300">${reg.pct_total_cubierta.toFixed(2)}%</td>
      <td class="py-3 px-3 text-right ${reg.nosrv_crit_kwh > 20 ? "text-red-400" : "text-slate-200"}">${reg.nosrv_crit_kwh.toFixed(2)}</td>
      <td class="py-3 px-3 text-right text-slate-300">${reg.nosrv_total_kwh.toFixed(2)}</td>
      <td class="py-3 px-3 text-right text-slate-300">${reg.ciclos_bateria.toFixed(1)}</td>
      <td class="py-3 px-3 text-right text-slate-400">${reg.vertido_fv_kwh.toFixed(2)}</td>
      <td class="py-3 px-3 text-right ${esRL ? "text-solar-400 font-bold" : "text-slate-200"}">${reg.recompensa_total.toFixed(1)}</td>
      <td class="py-3 px-3 text-right ${esRL ? "text-emerald-400 font-bold" : "text-slate-400"}">${reg.pct_optimo_alcanzado.toFixed(1)}%</td>
    `;

    tbody.appendChild(tr);
  });
}

function renderizarGraficoBarrasResultados(registros, claveMetrica) {
  const ctx = document.getElementById("chart-resultados-barras");
  if (!ctx) return;

  const c = obtenerColoresTema();

  const metaMetricas = {
    pct_critica_cubierta: { titulo: "Demanda Crítica Cubierta (%)", unidad: "%", formato: (v) => `${v.toFixed(2)}%` },
    pct_total_cubierta: { titulo: "Demanda Total Cubierta (%)", unidad: "%", formato: (v) => `${v.toFixed(2)}%` },
    nosrv_crit_kwh: { titulo: "Energía Crítica No Servida (kWh)", unidad: "kWh", formato: (v) => `${v.toFixed(2)} kWh` },
    ciclos_bateria: { titulo: "Ciclos Equivalentes de Batería", unidad: "ciclos", formato: (v) => `${v.toFixed(1)} ciclos` },
    vertido_fv_kwh: { titulo: "Energía Solar Vertida (kWh)", unidad: "kWh", formato: (v) => `${v.toFixed(2)} kWh` },
    recompensa_total: { titulo: "Recompensa Total Acumulada", unidad: "pts", formato: (v) => `${v.toFixed(1)}` },
  };

  const meta = metaMetricas[claveMetrica] || { titulo: claveMetrica, unidad: "", formato: (v) => v.toString() };

  const elTitulo = document.getElementById("titulo-grafico-resultados");
  if (elTitulo) elTitulo.textContent = `Comparativa: ${meta.titulo}`;

  const etiquetas = registros.map((r) => r.estrategia);
  const valores = registros.map((r) => r[claveMetrica]);

  const coloresFondo = registros.map((r) => {
    if (r.estrategia.includes("Q-Learning")) return c.solarAmbar;
    if (r.estrategia.includes("Oráculo")) return c.verdeEsmeralda;
    if (r.estrategia === "Voraz") return c.rojoVoraz;
    if (r.estrategia.includes("Umbral")) return c.indigoUmbral;
    if (r.estrategia.includes("Horaria")) return c.purpuraHoraria;
    return "#64748b";
  });

  if (AppState.graficos.resultados) {
    AppState.graficos.resultados.data.labels = etiquetas;
    AppState.graficos.resultados.data.datasets[0].label = meta.titulo;
    AppState.graficos.resultados.data.datasets[0].data = valores;
    AppState.graficos.resultados.data.datasets[0].backgroundColor = coloresFondo;
    AppState.graficos.resultados.data.datasets[0].borderColor = coloresFondo;
    AppState.graficos.resultados.options.scales.y.title.text = meta.titulo;
    AppState.graficos.resultados.update();
  } else {
    AppState.graficos.resultados = new Chart(ctx, {
      type: "bar",
      data: {
        labels: etiquetas,
        datasets: [
          {
            label: meta.titulo,
            data: valores,
            backgroundColor: coloresFondo,
            borderColor: coloresFondo,
            borderWidth: 1.5,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: c.bgTooltip,
            titleColor: c.textoTooltip,
            bodyColor: c.textoTooltip,
            borderColor: c.borderTooltip,
            borderWidth: 1,
            callbacks: {
              label: (context) => ` ${meta.titulo}: ${meta.formato(context.parsed.y)}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: c.textoPrincipal, font: { weight: "bold", size: 11 } }, grid: { display: false } },
          y: {
            title: { display: true, text: meta.titulo, color: c.textoMuted },
            ticks: { color: c.textoMuted },
            grid: { color: c.lineaGrid },
          },
        },
      },
    });
  }
}

// =============================================================================
// SECCIÓN 6: SIMULADOR DE SEMANAS
// =============================================================================
function inicializarSimuladorSemanas() {
  const semData = AppState.datos.semanas;
  if (!semData || !semData.semanas) {
    mostrarError("simulador-error", "Datos de semanas no disponibles.");
    return;
  }

  const selSemana = document.getElementById("sim-select-semana");
  const selEstrategia = document.getElementById("sim-select-estrategia");
  const chkComparar = document.getElementById("sim-check-comparar");

  // Llenar selector de semanas (12 semanas de 2024)
  if (selSemana) {
    selSemana.innerHTML = "";
    semData.semanas.forEach((s, idx) => {
      const opt = document.createElement("option");
      opt.value = idx.toString();
      opt.textContent = `Semana ${idx + 1} · ${s.nombre_mes} (${s.epoca})`;
      selSemana.appendChild(opt);
    });

    selSemana.addEventListener("change", (e) => {
      AppState.simulador.semanaIdx = parseInt(e.target.value, 10);
      actualizarSimuladorSemanas();
    });
  }

  if (selEstrategia) {
    selEstrategia.addEventListener("change", (e) => {
      AppState.simulador.estrategia = e.target.value;
      actualizarSimuladorSemanas();
    });
  }

  if (chkComparar) {
    chkComparar.addEventListener("change", (e) => {
      AppState.simulador.compararVoraz = e.target.checked;
      const selEstWrapper = document.getElementById("sim-select-estrategia");
      if (selEstWrapper) {
        selEstWrapper.disabled = e.target.checked;
        selEstWrapper.classList.toggle("opacity-50", e.target.checked);
      }
      actualizarSimuladorSemanas();
    });
  }

  actualizarSimuladorSemanas();
}

function calcularMetricasSemana(semana, estrategiaKey) {
  const est = semana.estrategias[estrategiaKey];
  if (!est) return null;

  const demCrit = semana.dem_crit.reduce((a, b) => a + b, 0);
  const demNc = semana.dem_nc.reduce((a, b) => a + b, 0);
  const demTotal = demCrit + demNc;

  const nosrvCrit = est.nosrv_crit.reduce((a, b) => a + b, 0);
  const nosrvNc = est.nosrv_nc.reduce((a, b) => a + b, 0);
  const nosrvTotal = nosrvCrit + nosrvNc;

  const cobCrit = Math.max(0, 100 * (1 - nosrvCrit / demCrit));
  const cobTot = Math.max(0, 100 * (1 - nosrvTotal / demTotal));

  // Capacidad nominal y útil leídas dinámicamente de config.json
  const capNominal = AppState.datos.config?.bateria?.capacidad_nominal_kwh ?? 2.4;
  const capUtil = AppState.datos.config?.bateria?.capacidad_util_kwh ?? 1.92;

  let descargasKwh = 0;
  for (let i = 1; i < est.soc.length; i++) {
    if (est.soc[i] < est.soc[i - 1]) {
      descargasKwh += (est.soc[i - 1] - est.soc[i]) * capNominal;
    }
  }
  const ciclos = descargasKwh / capUtil;

  return {
    demTotal,
    demCrit,
    nosrvCrit,
    nosrvTotal,
    cobCrit,
    cobTot,
    ciclos,
  };
}

function actualizarSimuladorSemanas() {
  const semData = AppState.datos.semanas;
  if (!semData || !semData.semanas) return;

  const { semanaIdx, estrategia, compararVoraz } = AppState.simulador;
  const semana = semData.semanas[semanaIdx];
  if (!semana) return;

  renderizarKpisSemana(semana, estrategia, compararVoraz);
  renderizarGraficoDemandaSemana(semana);
  renderizarGraficoSocSemana(semana, estrategia, compararVoraz);
  renderizarFranjaAccionesSemana(semana, estrategia, compararVoraz);
}

function renderizarKpisSemana(semana, estrategia, compararVoraz) {
  const kpiCont = document.getElementById("sim-kpi-container");
  if (!kpiCont) return;

  const metAgente = calcularMetricasSemana(semana, "agente");
  const metVoraz = calcularMetricasSemana(semana, "voraz");
  const metActual = compararVoraz ? metAgente : calcularMetricasSemana(semana, estrategia);

  if (!compararVoraz) {
    kpiCont.innerHTML = `
      <div class="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl">
        <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Demanda Crítica Cubierta</span>
        <span class="text-2xl font-bold font-mono text-solar-400">${metActual.cobCrit.toFixed(2)}%</span>
        <span class="text-[11px] text-slate-400 block mt-0.5">${metActual.nosrvCrit.toFixed(2)} kWh déficit</span>
      </div>
      <div class="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl">
        <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Demanda Total Cubierta</span>
        <span class="text-2xl font-bold font-mono text-slate-100">${metActual.cobTot.toFixed(2)}%</span>
        <span class="text-[11px] text-slate-400 block mt-0.5">${metActual.nosrvTotal.toFixed(2)} kWh no servidos</span>
      </div>
      <div class="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl">
        <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Ciclos en la Semana</span>
        <span class="text-2xl font-bold font-mono text-slate-200">${metActual.ciclos.toFixed(1)}</span>
        <span class="text-[11px] text-slate-400 block mt-0.5">ciclos útiles de batería</span>
      </div>
      <div class="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl">
        <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Generación FV Semanal</span>
        <span class="text-2xl font-bold font-mono text-emerald-400">${semana.pv_kw.reduce((a,b)=>a+b,0).toFixed(1)}</span>
        <span class="text-[11px] text-slate-400 block mt-0.5">kWh solares generados</span>
      </div>
    `;
  } else {
    const difCrit = metAgente.cobCrit - metVoraz.cobCrit;
    const ahorroKwh = metVoraz.nosrvCrit - metAgente.nosrvCrit;

    kpiCont.innerHTML = `
      <div class="bg-slate-950/70 border border-solar-500/30 p-3.5 rounded-xl">
        <span class="text-[11px] font-semibold text-solar-400 uppercase tracking-wider block">Cob. Crítica: Agente vs Voraz</span>
        <div class="flex items-baseline gap-2">
          <span class="text-xl font-bold font-mono text-solar-400">${metAgente.cobCrit.toFixed(1)}%</span>
          <span class="text-xs text-slate-400">vs</span>
          <span class="text-base font-bold font-mono text-red-400">${metVoraz.cobCrit.toFixed(1)}%</span>
        </div>
        <span class="text-[11px] text-emerald-400 font-semibold block mt-0.5">
          ${difCrit >= 0 ? `+${difCrit.toFixed(2)} p.p. mejora` : `${difCrit.toFixed(2)} p.p.`}
        </span>
      </div>
      <div class="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl">
        <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Déficit Crítico Ahorrado</span>
        <span class="text-2xl font-bold font-mono ${ahorroKwh > 0 ? "text-emerald-400" : "text-slate-200"}">
          ${ahorroKwh > 0 ? `+${ahorroKwh.toFixed(2)} kWh` : `${ahorroKwh.toFixed(2)} kWh`}
        </span>
        <span class="text-[11px] text-slate-400 block mt-0.5">salvados de cortes vitales</span>
      </div>
      <div class="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl">
        <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Cob. Total: Agente vs Voraz</span>
        <div class="flex items-baseline gap-2">
          <span class="text-xl font-bold font-mono text-slate-200">${metAgente.cobTot.toFixed(1)}%</span>
          <span class="text-xs text-slate-400">vs</span>
          <span class="text-base font-mono text-slate-400">${metVoraz.cobTot.toFixed(1)}%</span>
        </div>
        <span class="text-[11px] text-slate-400 block mt-0.5">priorización estratégica</span>
      </div>
      <div class="bg-slate-950/70 border border-slate-800 p-3.5 rounded-xl">
        <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Ciclos: Agente vs Voraz</span>
        <div class="flex items-baseline gap-2">
          <span class="text-xl font-bold font-mono text-slate-200">${metAgente.ciclos.toFixed(1)}</span>
          <span class="text-xs text-slate-400">vs</span>
          <span class="text-base font-mono text-slate-400">${metVoraz.ciclos.toFixed(1)}</span>
        </div>
        <span class="text-[11px] text-slate-400 block mt-0.5">mismo desgaste, mayor valor</span>
      </div>
    `;
  }
}

function generarEtiquetasHorarias168() {
  const dias = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const labels = [];
  for (let h = 0; h < 168; h++) {
    const diaIdx = Math.floor(h / 24);
    const horaDia = h % 24;
    labels.push(`${dias[diaIdx]} ${String(horaDia).padStart(2, "0")}h`);
  }
  return labels;
}

function renderizarGraficoDemandaSemana(semana) {
  const ctx = document.getElementById("chart-sim-demanda");
  if (!ctx) return;

  const c = obtenerColoresTema();
  const labels = generarEtiquetasHorarias168();

  if (AppState.graficos.simDemanda) {
    AppState.graficos.simDemanda.data.labels = labels;
    AppState.graficos.simDemanda.data.datasets[0].data = semana.dem_crit;
    AppState.graficos.simDemanda.data.datasets[1].data = semana.dem_nc;
    AppState.graficos.simDemanda.data.datasets[2].data = semana.pv_kw;
    AppState.graficos.simDemanda.update();
  } else {
    AppState.graficos.simDemanda = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Demanda Crítica (kW)",
            data: semana.dem_crit,
            borderColor: "rgba(239, 68, 68, 0.8)",
            backgroundColor: "rgba(239, 68, 68, 0.4)",
            fill: true,
            stack: "demanda",
            pointRadius: 0,
            borderWidth: 1,
            tension: 0.1,
          },
          {
            label: "Demanda No Crítica (kW)",
            data: semana.dem_nc,
            borderColor: "rgba(245, 158, 11, 0.8)",
            backgroundColor: "rgba(245, 158, 11, 0.35)",
            fill: true,
            stack: "demanda",
            pointRadius: 0,
            borderWidth: 1,
            tension: 0.1,
          },
          {
            label: "Generación Solar FV (kW)",
            data: semana.pv_kw,
            borderColor: "#fbbf24",
            backgroundColor: "transparent",
            fill: false,
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: c.bgTooltip,
            titleColor: c.textoTooltip,
            bodyColor: c.textoTooltip,
            borderColor: c.borderTooltip,
            borderWidth: 1,
          },
        },
        scales: {
          x: {
            ticks: {
              color: c.textoMuted,
              maxTicksLimit: 14,
              font: { size: 10 },
            },
            grid: { color: c.lineaGrid },
          },
          y: {
            title: { display: true, text: "Potencia (kW)", color: c.textoMuted },
            ticks: { color: c.textoMuted },
            grid: { color: c.lineaGrid },
            min: 0,
          },
        },
      },
    });
  }
}

function renderizarGraficoSocSemana(semana, estrategia, compararVoraz) {
  const ctx = document.getElementById("chart-sim-soc");
  if (!ctx) return;

  const c = obtenerColoresTema();
  const labels = generarEtiquetasHorarias168();

  const leyendaAgente = document.getElementById("leyenda-soc-agente");
  const leyendaVoraz = document.getElementById("leyenda-soc-voraz");

  const datosSocAgente = semana.estrategias.agente.soc.map((s) => s * 100);
  const datosSocVoraz = semana.estrategias.voraz.soc.map((s) => s * 100);
  const datosSocElegido = semana.estrategias[estrategia].soc.map((s) => s * 100);

  // Límites de SoC leídos dinámicamente de config.json
  const socMinPct = (AppState.datos.config?.bateria?.soc_min ?? 0.2) * 100;
  const socMaxPct = (AppState.datos.config?.bateria?.soc_max ?? 1.0) * 100;
  const refMin = new Array(168).fill(socMinPct);
  const refMax = new Array(168).fill(socMaxPct);

  const lblMin = document.getElementById("lbl-soc-min-ref");
  const lblMax = document.getElementById("lbl-soc-max-ref");
  if (lblMin) lblMin.textContent = `${socMinPct.toFixed(0)}%`;
  if (lblMax) lblMax.textContent = `${socMaxPct.toFixed(0)}%`;

  let datasets = [];

  if (compararVoraz) {
    if (leyendaAgente) leyendaAgente.classList.remove("hidden");
    if (leyendaVoraz) leyendaVoraz.classList.remove("hidden");

    datasets = [
      {
        label: "Agente Q-Learning (RL)",
        data: datosSocAgente,
        borderColor: c.solarAmbar,
        backgroundColor: "transparent",
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.1,
      },
      {
        label: "Baseline Voraz",
        data: datosSocVoraz,
        borderColor: c.rojoVoraz,
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [3, 3],
        pointRadius: 0,
        tension: 0.1,
      },
      {
        label: `SoC Mín. (${socMinPct.toFixed(0)}%)`,
        data: refMin,
        borderColor: "rgba(220, 38, 38, 0.85)",
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      },
      {
        label: `SoC Máx. (${socMinPct.toFixed(0)}%)`,
        data: refMax,
        borderColor: "rgba(5, 150, 105, 0.85)",
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      },
    ];
  } else {
    if (leyendaAgente) leyendaAgente.classList.remove("hidden");
    if (leyendaVoraz) leyendaVoraz.classList.add("hidden");

    let colorLinea = c.solarAmbar;
    let nombreEst = "Agente Q-Learning";
    if (estrategia === "voraz") { colorLinea = c.rojoVoraz; nombreEst = "Voraz"; }
    else if (estrategia === "umbral") { colorLinea = c.indigoUmbral; nombreEst = "Umbral SoC"; }
    else if (estrategia === "horaria") { colorLinea = c.purpuraHoraria; nombreEst = "Horaria"; }
    else if (estrategia === "oraculo") { colorLinea = c.verdeEsmeralda; nombreEst = "Oráculo DP"; }

    datasets = [
      {
        label: nombreEst,
        data: datosSocElegido,
        borderColor: colorLinea,
        backgroundColor: "transparent",
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.1,
      },
      {
        label: `SoC Mín. (${socMinPct.toFixed(0)}%)`,
        data: refMin,
        borderColor: "rgba(220, 38, 38, 0.85)",
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      },
      {
        label: `SoC Máx. (${socMaxPct.toFixed(0)}%)`,
        data: refMax,
        borderColor: "rgba(5, 150, 105, 0.85)",
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      },
    ];
  }

  if (AppState.graficos.simSoc) {
    AppState.graficos.simSoc.data.labels = labels;
    AppState.graficos.simSoc.data.datasets = datasets;
    AppState.graficos.simSoc.update();
  } else {
    AppState.graficos.simSoc = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: c.bgTooltip,
            titleColor: c.textoTooltip,
            bodyColor: c.textoTooltip,
            borderColor: c.borderTooltip,
            borderWidth: 1,
            callbacks: {
              label: (item) => ` ${item.dataset.label}: ${item.parsed.y.toFixed(1)}%`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: c.textoMuted, maxTicksLimit: 14, font: { size: 10 } },
            grid: { color: c.lineaGrid },
          },
          y: {
            title: { display: true, text: "Estado de Carga - SoC (%)", color: c.textoMuted },
            ticks: { color: c.textoMuted },
            grid: { color: c.lineaGrid },
            min: Math.max(0, socMinPct - 10),
            max: Math.min(105, socMaxPct + 5),
          },
        },
      },
    });
  }
}

function renderizarFranjaAccionesSemana(semana, estrategia, compararVoraz) {
  const cont = document.getElementById("sim-acciones-container");
  if (!cont) return;

  const dias = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

  const generarFilaFranja = (titulo, accionesArr, esAgente = false) => {
    let bloquesHtml = "";
    for (let h = 0; h < 168; h++) {
      const a = accionesArr[h];
      const dia = dias[Math.floor(h / 24)];
      const horaDia = `${String(h % 24).padStart(2, "0")}:00`;
      const color = COLORES_ACCIONES[a] || "#64748b";
      const tooltip = `Hora ${h + 1} (${dia} ${horaDia}) | Acción: ${a} (${NOMBRES_ACCIONES[a]})`;

      bloquesHtml += `<div class="action-block h-6 sm:h-7 rounded-[2px] cursor-pointer" 
                           style="background-color: ${color};" 
                           title="${tooltip}"></div>`;
    }

    return `
      <div class="space-y-1">
        <div class="flex items-center justify-between text-[11px] font-semibold ${esAgente ? "text-solar-400" : "text-slate-300"}">
          <span>${titulo}</span>
          <span class="text-[10px] text-slate-500 font-mono">168 horas consecutivas (7 días)</span>
        </div>
        <div class="grid grid-cols-[repeat(168,1fr)] gap-[1px] bg-slate-950 p-1 rounded-lg border border-slate-800/80">
          ${bloquesHtml}
        </div>
      </div>
    `;
  };

  let htmlFinal = "";
  if (compararVoraz) {
    htmlFinal += generarFilaFranja("Acciones: Agente Q-Learning (RL)", semana.estrategias.agente.accion, true);
    htmlFinal += generarFilaFranja("Acciones: Baseline Voraz (Siempre Consumir)", semana.estrategias.voraz.accion, false);
  } else {
    const nombresEstrategia = {
      agente: "Agente Q-Learning (RL)",
      voraz: "Baseline Voraz",
      umbral: "Heurística Umbral SoC",
      horaria: "Heurística Horaria",
      oraculo: "Oráculo Teórico (DP)",
    };
    htmlFinal += generarFilaFranja(
      `Acciones: ${nombresEstrategia[estrategia] || estrategia}`,
      semana.estrategias[estrategia].accion,
      estrategia === "agente"
    );
  }

  cont.innerHTML = htmlFinal;
}

// =============================================================================
// SECCIÓN 7: POLÍTICA APRENDIDA (HEATMAP HORA x SOC)
// =============================================================================
function inicializarPoliticaAprendida() {
  const polData = AppState.datos.politica;
  if (!polData || !polData.politica) {
    mostrarError("politica-error", "Datos de política aprendida no disponibles.");
    return;
  }

  const selRad = document.getElementById("pol-select-rad");
  const selRadAyer = document.getElementById("pol-select-rad-ayer");

  // Poblar opciones dinámicamente desde politica.json
  if (selRad && polData.etiquetas && polData.etiquetas.radiacion) {
    selRad.innerHTML = "";
    polData.etiquetas.radiacion.forEach((etiq, idx) => {
      const opt = document.createElement("option");
      opt.value = idx.toString();
      opt.textContent = `${idx} · ${etiq}`;
      if (idx === AppState.politica.nivelRad) opt.selected = true;
      selRad.appendChild(opt);
    });

    selRad.addEventListener("change", (e) => {
      AppState.politica.nivelRad = parseInt(e.target.value, 10);
      actualizarPoliticaAprendida();
    });
  }

  if (selRadAyer && polData.etiquetas && polData.etiquetas.radiacion_dia_anterior) {
    selRadAyer.innerHTML = "";
    polData.etiquetas.radiacion_dia_anterior.forEach((etiq, idx) => {
      const opt = document.createElement("option");
      opt.value = idx.toString();
      opt.textContent = `${idx} · ${etiq}`;
      if (idx === AppState.politica.nivelRadAyer) opt.selected = true;
      selRadAyer.appendChild(opt);
    });

    selRadAyer.addEventListener("change", (e) => {
      AppState.politica.nivelRadAyer = parseInt(e.target.value, 10);
      actualizarPoliticaAprendida();
    });
  }

  actualizarPoliticaAprendida();
}

function actualizarPoliticaAprendida() {
  const polData = AppState.datos.politica;
  if (!polData || !polData.politica) return;

  const cont = document.getElementById("pol-heatmap-container");
  if (!cont) return;

  const radIdx = AppState.politica.nivelRad;
  const radAyerIdx = AppState.politica.nivelRadAyer;
  const matrizPolitica = polData.politica;

  const etiquetasSoC = polData.etiquetas.soc;
  const etiquetasHora = polData.etiquetas.hora;

  let html = `<div class="grid grid-cols-[68px_repeat(24,1fr)] gap-1 text-[10px] items-center">`;

  html += `<div class="font-bold text-slate-400 text-center">SoC \\ Hora</div>`;
  etiquetasHora.forEach((hStr) => {
    const horaCorta = hStr.split(":")[0];
    html += `<div class="font-semibold text-slate-300 text-center py-1 truncate">${horaCorta}</div>`;
  });

  for (let s = 9; s >= 0; s--) {
    const socLabel = etiquetasSoC[s];
    html += `<div class="font-mono text-slate-400 text-right pr-1.5 text-[9px] font-semibold">${socLabel}</div>`;

    for (let h = 0; h < 24; h++) {
      const accion = matrizPolitica[h][s][radIdx][radAyerIdx];
      const color = COLORES_ACCIONES[accion] || "#64748b";
      const tooltip = `Hora: ${etiquetasHora[h]} | SoC: ${socLabel} | Acción Greedy: ${accion} (${NOMBRES_ACCIONES[accion]})`;

      html += `<div class="heatmap-cell rounded-sm flex items-center justify-center cursor-pointer font-mono font-bold text-[9px] text-white/90 shadow-sm" 
                    style="background-color: ${color};" 
                    title="${tooltip}">
                    ${accion}
               </div>`;
    }
  }

  html += `</div>`;
  cont.innerHTML = html;
}

// =============================================================================
// SECCIÓN 8: CONCLUSIONES Y LÍMITES (DINÁMICO DESDE METRICAS.JSON)
// =============================================================================
function renderizarConclusiones() {
  const metData = AppState.datos.metricas;
  if (!metData || !metData.metricas) return;

  const registrosPrueba = metData.metricas.filter(
    (m) => m.periodo === "Prueba 2023-2024" && m.epoca === "anual"
  );

  const regAgente = registrosPrueba.find((m) => m.estrategia.includes("Q-Learning"));
  const regVoraz = registrosPrueba.find((m) => m.estrategia === "Voraz");
  const regOraculo = registrosPrueba.find((m) => m.estrategia.includes("Oráculo"));
  const regHoraria = registrosPrueba.find((m) => m.estrategia.includes("Horaria"));

  if (!regAgente || !regVoraz) return;

  const setTxt = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  const pctReduccion = (((regVoraz.nosrv_crit_kwh - regAgente.nosrv_crit_kwh) / regVoraz.nosrv_crit_kwh) * 100).toFixed(1);

  setTxt("concl-horas", regAgente.horas_evaluadas.toLocaleString());
  setTxt("concl-cob-crit-agente", `${regAgente.pct_critica_cubierta.toFixed(2)}%`);
  setTxt("concl-cob-crit-voraz", `${regVoraz.pct_critica_cubierta.toFixed(2)}%`);
  setTxt("concl-nosrv-voraz", `${regVoraz.nosrv_crit_kwh.toFixed(2)}`);
  setTxt("concl-nosrv-agente", `${regAgente.nosrv_crit_kwh.toFixed(2)}`);
  setTxt("concl-pct-reduccion", `${pctReduccion}%`);

  setTxt("concl-rec-agente", `${regAgente.recompensa_total.toFixed(2)}`);
  setTxt("concl-rec-voraz", `${regVoraz.recompensa_total.toFixed(2)}`);
  if (regOraculo) setTxt("concl-rec-oraculo", `${regOraculo.recompensa_total.toFixed(2)}`);
  setTxt("concl-pct-optimo", `${regAgente.pct_optimo_alcanzado.toFixed(2)}%`);

  setTxt("concl-ciclos-agente", `${regAgente.ciclos_bateria.toFixed(1)}`);
  setTxt("concl-ciclos-voraz", `${regVoraz.ciclos_bateria.toFixed(1)}`);

  if (regHoraria) {
    setTxt("concl-ciclos-horaria", `${regHoraria.ciclos_bateria.toFixed(1)}`);
    setTxt("concl-cob-nc-horaria", `${regHoraria.pct_no_critica_cubierta.toFixed(2)}%`);
  }
}

// =============================================================================
// GESTIÓN DE PESTAÑAS (TABS)
// =============================================================================
function inicializarPestanas() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  function activarTab(targetId) {
    // 1. Ocultar todos los paneles de pestañas
    tabContents.forEach((tc) => {
      tc.classList.add("hidden");
    });

    // 2. Mostrar la pestaña seleccionada
    const tabSeleccionada = document.getElementById(targetId);
    if (tabSeleccionada) {
      tabSeleccionada.classList.remove("hidden");
    }

    // 3. Actualizar estilos de los botones de navegación
    tabBtns.forEach((btn) => {
      const esActivo = btn.getAttribute("data-tab-target") === targetId;
      if (esActivo) {
        btn.classList.add("text-solar-400", "bg-slate-900", "border-solar-500/40", "shadow-sm");
        btn.classList.remove("text-slate-400", "hover:text-slate-200", "hover:bg-slate-900/60", "border-transparent");
        btn.setAttribute("aria-selected", "true");
      } else {
        btn.classList.remove("text-solar-400", "bg-slate-900", "border-solar-500/40", "shadow-sm");
        btn.classList.add("text-slate-400", "hover:text-slate-200", "hover:bg-slate-900/60", "border-transparent");
        btn.setAttribute("aria-selected", "false");
      }
    });

    // 4. Actualizar hash de la URL sin saltar el scroll
    try {
      const hashName = targetId.replace("tab-", "");
      if (window.location.hash !== `#${hashName}`) {
        history.replaceState(null, null, `#${hashName}`);
      }
    } catch (e) {}

    // 5. Scroll suave al inicio del contenido
    window.scrollTo({ top: 0, behavior: "smooth" });

    // 6. Renderizar fórmulas matemáticas en la pestaña recién activada
    renderizarFormulasMatematicas(tabSeleccionada);

    // 7. Redibujar gráficos de Chart.js y mapa Leaflet para calcular dimensiones correctas
    setTimeout(() => {
      Object.values(AppState.graficos).forEach((chart) => {
        if (chart && typeof chart.resize === "function") {
          chart.resize();
        }
      });
      if (AppState.mapaSolar?.mapa) {
        AppState.mapaSolar.mapa.invalidateSize();
      }
      window.dispatchEvent(new Event("resize"));
    }, 80);
  }

  // Event listener en los botones
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab-target");
      if (targetId) activarTab(targetId);
    });
  });

  // Activar pestaña según el hash de la URL o por defecto la primera
  const hash = window.location.hash.replace("#", "");
  const targetFromHash = hash ? `tab-${hash}` : null;
  if (targetFromHash && document.getElementById(targetFromHash)) {
    activarTab(targetFromHash);
  } else {
    activarTab("tab-general");
  }

  // Manejar navegación adelante/atrás en el historial
  window.addEventListener("hashchange", () => {
    const nuevoHash = window.location.hash.replace("#", "");
    const nuevoTarget = nuevoHash ? `tab-${nuevoHash}` : "tab-general";
    if (document.getElementById(nuevoTarget)) {
      activarTab(nuevoTarget);
    }
  });
}

// =============================================================================
// RENDERIZADO DE FÓRMULAS MATEMÁTICAS (KaTeX con Fallback Tipográfico)
// =============================================================================
function renderizarFormulasMatematicas(contenedor = document.body) {
  if (!contenedor) return;

  // 1. Si KaTeX auto-render está disponible, renderizar con calidad LaTeX
  if (typeof renderMathInElement === "function") {
    try {
      renderMathInElement(contenedor, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true }
        ],
        throwOnError: false,
        errorColor: "#f59e0b"
      });
      return;
    } catch (e) {
      console.warn("KaTeX renderMathInElement advertencia:", e);
    }
  }

  // 2. Fallback de contingencia (sin red o antes de cargar CDN)
  aplicarFallbackFormulas(contenedor);
}

function aplicarFallbackFormulas(nodo = document.body) {
  if (!nodo) return;
  const walker = document.createTreeWalker(nodo, NodeFilter.SHOW_TEXT, null, false);
  let textNode;
  const nodos = [];

  while ((textNode = walker.nextNode())) {
    if (textNode.nodeValue && textNode.nodeValue.includes("$")) {
      nodos.push(textNode);
    }
  }

  nodos.forEach((n) => {
    const val = n.nodeValue;
    if (/\$[^$]+\$/.test(val)) {
      const span = document.createElement("span");
      let html = val
        .replace(/\$\$\\epsilon\$\$/g, '<span class="font-serif italic text-solar-400">ε</span>')
        .replace(/\$\\epsilon\$/g, '<span class="font-serif italic text-solar-400">ε</span>')
        .replace(/\$\\epsilon\s*=\s*0\$/g, '<span class="font-serif italic text-solar-400">ε = 0</span>')
        .replace(/\$\\epsilon_\{?\\text\{ini\}\}?\s*\\to\s*\\epsilon_\{?\\text\{fin\}\}?\$/g, '<span class="font-serif italic text-solar-400">ε<sub>ini</sub> → ε<sub>fin</sub></span>')
        .replace(/\$\\epsilon_\{ini\}\s*\\to\s*\\epsilon_\{fin\}\$/g, '<span class="font-serif italic text-solar-400">ε<sub>ini</sub> → ε<sub>fin</sub></span>')
        .replace(/\$\\alpha\$/g, '<span class="font-serif italic text-solar-400">α</span>')
        .replace(/\$\\gamma\$/g, '<span class="font-serif italic text-solar-400">γ</span>')
        .replace(/\$\\pi\^\*\(s\)\$/g, '<span class="font-serif italic text-solar-400">π*(s)</span>')
        .replace(/\$\\arg\\max_a\s*Q\(s,a\)\$/g, '<span class="font-serif italic text-solar-400">argmax<sub>a</sub> Q(s, a)</span>')
        .replace(/\$S\$/g, '<span class="font-serif italic font-bold text-solar-400">S</span>')
        .replace(/\$A\$/g, '<span class="font-serif italic font-bold text-solar-400">A</span>')
        .replace(/\$R\$/g, '<span class="font-serif italic font-bold text-solar-400">R</span>')
        .replace(/\$w_c\$/g, '<span class="font-serif italic text-red-400">w<sub>c</sub></span>')
        .replace(/\$w_\{?\\text\{nc\}\}?\$/g, '<span class="font-serif italic text-amber-400">w<sub>nc</sub></span>')
        .replace(/\$w_\{nc\}\$/g, '<span class="font-serif italic text-amber-400">w<sub>nc</sub></span>')
        .replace(/\$w_b\$/g, '<span class="font-serif italic text-slate-300">w<sub>b</sub></span>');
      span.innerHTML = html;
      if (n.parentNode) {
        n.parentNode.replaceChild(span, n);
      }
    }
  });
}

// Exponer globalmente para el handler onload del script de KaTeX
window.renderizarFormulasMatematicas = renderizarFormulasMatematicas;

// =============================================================================
// INICIALIZACIÓN PRINCIPAL
// =============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  inicializarTema();
  inicializarPestanas();
  inicializarFiltrosResultados();

  // Renderizar fórmulas iniciales
  renderizarFormulasMatematicas();

  const exito = await cargarDatosJSON();
  if (!exito) return;

  renderizarHeroKPIs();
  inicializarMapaSolar();
  renderizarDatosClima();
  renderizarModeloMDP();
  renderizarEntrenamiento();
  actualizarResultados();

  inicializarSimuladorSemanas();
  inicializarPoliticaAprendida();
  renderizarConclusiones();

  // Re-evaluar tras la inyección de datos dinámicos
  renderizarFormulasMatematicas();
});

// Renderizar de nuevo cuando todos los recursos (CDN KaTeX) estén listos
window.addEventListener("load", () => {
  renderizarFormulasMatematicas();
});
