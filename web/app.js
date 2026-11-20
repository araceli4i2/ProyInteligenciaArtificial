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
// CARGA ASÍNCRONA DE DATOS JSON
// =============================================================================
async function cargarDatosJSON() {
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
          mostrarError(item.seccionError, `No se pudo cargar '${item.url}': ${err.message}`);
          return { clave: item.clave, data: null };
        }
      })
    );

    respuestas.forEach((item) => {
      AppState.datos[item.clave] = item.data;
    });

    return true;
  } catch (error) {
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
  }

  if (regVoraz) {
    const elCritVoraz = document.getElementById("kpi-cob-crit-voraz");
    if (elCritVoraz) elCritVoraz.textContent = `${regVoraz.pct_critica_cubierta.toFixed(2)}%`;

    const elCiclosVoraz = document.getElementById("kpi-ciclos-voraz");
    if (elCiclosVoraz) elCiclosVoraz.textContent = `${regVoraz.ciclos_bateria.toFixed(1)} ciclos`;
  }

  if (regOraculo) {
    const elCritOraculo = document.getElementById("kpi-cob-crit-oraculo");
    if (elCritOraculo) elCritOraculo.textContent = `${regOraculo.pct_critica_cubierta.toFixed(2)}%`;

    const elRecOraculo = document.getElementById("kpi-rec-oraculo");
    if (elRecOraculo) elRecOraculo.textContent = `${regOraculo.recompensa_total.toFixed(1)}`;
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

  // Ciclos útiles: descargas respecto a 1.92 kWh útiles (cap. nominal 2.4 kWh)
  let descargasKwh = 0;
  for (let i = 1; i < est.soc.length; i++) {
    if (est.soc[i] < est.soc[i - 1]) {
      descargasKwh += (est.soc[i - 1] - est.soc[i]) * 2.4;
    }
  }
  const ciclos = descargasKwh / 1.92;

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

  // 1. Renderizar Tarjetas KPI de la semana
  renderizarKpisSemana(semana, estrategia, compararVoraz);

  // 2. Gráfico de Demanda y Generación Solar Horaria
  renderizarGraficoDemandaSemana(semana);

  // 3. Gráfico de Evolución del SoC
  renderizarGraficoSocSemana(semana, estrategia, compararVoraz);

  // 4. Franja de Colores con Acciones Horarias
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
    // Modo comparación Agente vs Voraz
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

  // Líneas constantes de referencia 20% y 100%
  const ref20 = new Array(168).fill(20);
  const ref100 = new Array(168).fill(100);

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
        label: "SoC Mín. Admisible (20%)",
        data: ref20,
        borderColor: "rgba(239, 68, 68, 0.5)",
        borderDash: [5, 5],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      },
      {
        label: "SoC Máx. Admisible (100%)",
        data: ref100,
        borderColor: "rgba(16, 185, 129, 0.5)",
        borderDash: [5, 5],
        borderWidth: 1.5,
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
        label: "SoC Mín. Admisible (20%)",
        data: ref20,
        borderColor: "rgba(239, 68, 68, 0.5)",
        borderDash: [5, 5],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      },
      {
        label: "SoC Máx. Admisible (100%)",
        data: ref100,
        borderColor: "rgba(16, 185, 129, 0.5)",
        borderDash: [5, 5],
        borderWidth: 1.5,
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
            min: 15,
            max: 105,
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

  if (selRad) {
    selRad.addEventListener("change", (e) => {
      AppState.politica.nivelRad = parseInt(e.target.value, 10);
      actualizarPoliticaAprendida();
    });
  }

  if (selRadAyer) {
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
  const matrizPolitica = polData.politica; // [hora:24][soc:10][rad:4][rad_ayer:3]

  const etiquetasSoC = polData.etiquetas.soc; // 10 intervalos ('20-28 %' .. '92-100 %')
  const etiquetasHora = polData.etiquetas.hora; // 24 horas ('00:00' .. '23:00')

  // Renderizar de SoC 100% arriba a SoC 20% abajo (filas 9 down to 0)
  let html = `<div class="grid grid-cols-[68px_repeat(24,1fr)] gap-1 text-[10px] items-center">`;

  // Fila de Cabecera (Horas)
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
// INICIALIZACIÓN PRINCIPAL
// =============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  inicializarTema();
  inicializarFiltrosResultados();

  const exito = await cargarDatosJSON();
  if (!exito) return;

  renderizarHeroKPIs();
  renderizarDatosClima();
  renderizarModeloMDP();
  renderizarEntrenamiento();
  actualizarResultados();

  // Nuevas secciones 6 y 7
  inicializarSimuladorSemanas();
  inicializarPoliticaAprendida();
});
