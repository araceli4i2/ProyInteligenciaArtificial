/**
 * app.js - Lógica interactiva del Dashboard SolarRL La Paz
 * Carga datos JSON precalculados desde web/data/ y gestiona visualizaciones
 * con Chart.js y renderizado dinámico del DOM.
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
  },
  graficos: {
    clima: null,
    aprendizaje: null,
    resultados: null,
  },
  filtros: {
    periodo: "Prueba 2023-2024",
    epoca: "anual",
    metrica: "pct_critica_cubierta",
  },
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

  // Preferencia guardada o por defecto oscuro
  const guardado = localStorage.getItem("solarrl-theme");
  if (guardado === "light") {
    document.documentElement.classList.remove("dark");
    themeIcon.textContent = "☀️";
  } else {
    document.documentElement.classList.add("dark");
    themeIcon.textContent = "🌙";
  }

  btnTheme.addEventListener("click", () => {
    const ahoraOscuro = document.documentElement.classList.toggle("dark");
    themeIcon.textContent = ahoraOscuro ? "🌙" : "☀️";
    localStorage.setItem("solarrl-theme", ahoraOscuro ? "dark" : "light");

    // Actualizar gráficos existentes
    actualizarEstilosGraficos();
  });
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

  // Filtrar periodo de prueba completo (2023-2024) y época anual
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

  // 1. Renderizar Mapa de Calor (Hora local x Mes)
  renderizarHeatmap(clima);

  // 2. Renderizar Gráfico de Irradiación Diaria y Temperatura
  renderizarGraficoClima(clima);
}

function renderizarHeatmap(clima) {
  const contenedor = document.getElementById("heatmap-container");
  if (!contenedor) return;

  const matriz = clima.matriz_ghi_hora_mes; // 24 filas x 12 columnas
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const maxGHI = 850.0; // W/m² de referencia para saturación

  // Estructura HTML en Grid CSS: 13 columnas (Etiqueta de Hora + 12 Meses)
  let html = `<div class="grid grid-cols-[45px_repeat(12,1fr)] gap-1 text-[10px] items-center">`;

  // Fila de Cabecera (Nombres de meses)
  html += `<div class="font-bold text-slate-400 text-center">Hora</div>`;
  meses.forEach((mes) => {
    html += `<div class="font-semibold text-slate-300 text-center py-1 truncate">${mes}</div>`;
  });

  // 24 Filas (Horas 0 a 23)
  for (let h = 0; h < 24; h++) {
    const horaLabel = `${String(h).padStart(2, "0")}:00`;
    html += `<div class="font-mono text-slate-400 text-right pr-1">${horaLabel}</div>`;

    for (let m = 0; m < 12; m++) {
      const ghi = matriz[h][m];
      const ratio = Math.min(Math.max(ghi / maxGHI, 0), 1);

      // Paleta secuencial ámbar: desde fondo neutro oscuro en 0 W/m² hasta ámbar vivo en >800 W/m²
      let bgEstilo;
      if (ghi < 2) {
        bgEstilo = "background-color: rgba(30, 41, 59, 0.4);";
      } else {
        // HSL de ámbar/dorado: matiz 38-42, luminosidad escalada entre 18% y 60%
        const light = 18 + ratio * 42;
        const alpha = 0.35 + ratio * 0.65;
        bgEstilo = `background-color: hsla(38, 95%, ${light}%, ${alpha});`;
      }

      const tooltip = `Mes: ${clima.nombres_meses[m]} | Hora: ${horaLabel} | GHI: ${ghi.toFixed(1)} W/m²`;

      html += `<div class="heatmap-cell rounded-sm flex items-center justify-center cursor-pointer" 
                    style="${bgEstilo}" 
                    title="${tooltip}"
                    data-ghi="${ghi.toFixed(1)}">
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
        // Banda P90 (límite superior de sombreado)
        {
          label: "P90 Irradiación",
          data: clima.irradiacion_diaria_mes.p90,
          borderColor: "transparent",
          backgroundColor: "rgba(245, 158, 11, 0.15)",
          fill: "+1", // Llena hacia el siguiente dataset (P10)
          pointRadius: 0,
          yAxisID: "y",
        },
        // Banda P10 (límite inferior de sombreado)
        {
          label: "P10 Irradiación",
          data: clima.irradiacion_diaria_mes.p10,
          borderColor: "transparent",
          backgroundColor: "transparent",
          fill: false,
          pointRadius: 0,
          yAxisID: "y",
        },
        // Media de Irradiación Diaria
        {
          label: "Irradiación Media (kWh/m²/d)",
          data: clima.irradiacion_diaria_mes.media,
          borderColor: c.solarAmbar,
          backgroundColor: c.solarAmbar,
          borderWidth: 2.5,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.3,
          yAxisID: "y",
        },
        // Temperatura Media Mensual
        {
          label: "Temperatura Media (°C)",
          data: clima.temperatura_media_mes,
          borderColor: c.cieloAzul,
          backgroundColor: c.cieloAzul,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderDash: [4, 4],
          tension: 0.3,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: false, // La leyenda está en el pie de la tarjeta
        },
        tooltip: {
          backgroundColor: c.bgTooltip,
          titleColor: c.textoTooltip,
          bodyColor: c.textoTooltip,
          borderColor: c.borderTooltip,
          borderWidth: 1,
          padding: 8,
          callbacks: {
            label: function (context) {
              const datasetLabel = context.dataset.label || "";
              const val = context.parsed.y;
              if (datasetLabel.includes("Temperatura")) {
                return ` ${datasetLabel}: ${val.toFixed(2)} °C`;
              }
              return ` ${datasetLabel}: ${val.toFixed(2)} kWh/m²/d`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: c.textoMuted, font: { size: 11 } },
          grid: { color: c.lineaGrid },
        },
        y: {
          type: "linear",
          position: "left",
          title: {
            display: true,
            text: "Irradiación Diaria (kWh/m²/día)",
            color: c.solarAmbar,
            font: { size: 11, weight: "bold" },
          },
          ticks: { color: c.textoMuted },
          grid: { color: c.lineaGrid },
          min: 3.5,
          max: 9.0,
        },
        y1: {
          type: "linear",
          position: "right",
          title: {
            display: true,
            text: "Temperatura Media (°C)",
            color: c.cieloAzul,
            font: { size: 11, weight: "bold" },
          },
          ticks: { color: c.textoMuted },
          grid: { drawOnChartArea: false }, // No solapar líneas de grid
          min: 4,
          max: 16,
        },
      },
    },
  });
}

// =============================================================================
// SECCIÓN 3: MODELO MDP (INYECCIÓN DE VALORES DE CONFIG.JSON)
// =============================================================================
function renderizarModeloMDP() {
  const cfg = AppState.datos.config;
  if (!cfg) {
    mostrarError("modelo-error", "No se cargó la configuración del modelo.");
    return;
  }

  // 1. Estado
  const setTxt = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setTxt("mdp-estados-total", `${cfg.discretizacion.total_estados} estados`);
  setTxt("mdp-num-horas", `${cfg.discretizacion.num_horas} horas (0–23 h)`);
  setTxt("mdp-num-soc", `${cfg.discretizacion.num_soc} niveles (20–100%)`);
  setTxt("mdp-num-ghi", `${cfg.discretizacion.num_ghi} cuantiles`);
  setTxt("mdp-num-ghi-ayer", `${cfg.discretizacion.num_ghi_ayer} terciles`);

  // 3. Recompensa
  setTxt("mdp-peso-crit", `-${cfg.recompensa.peso_no_srv_crit.toFixed(1)} / kWh`);
  setTxt("mdp-peso-nc", `-${cfg.recompensa.peso_no_srv_nc.toFixed(1)} / kWh`);
  setTxt("mdp-peso-bat", `-${cfg.recompensa.peso_bateria.toFixed(2)} / kWh`);

  // 4. Física y Transición
  setTxt("mdp-fv-pico", `${cfg.fotovoltaico.potencia_pico_kw.toFixed(2)} kWp`);
  setTxt("mdp-fv-pr", `${cfg.fotovoltaico.rendimiento_pr.toFixed(2)}`);
  setTxt("mdp-bat-cap", `${cfg.bateria.capacidad_nominal_kwh.toFixed(1)} kWh (${cfg.bateria.capacidad_util_kwh.toFixed(2)} útiles)`);
  setTxt("mdp-bat-soc-rango", `${(cfg.bateria.soc_min * 100).toFixed(0)}% – ${(cfg.bateria.soc_max * 100).toFixed(0)}%`);
  setTxt("mdp-bat-eficiencia", `${cfg.bateria.eficiencia_carga.toFixed(2)} / ${cfg.bateria.eficiencia_descarga.toFixed(2)}`);
}

// =============================================================================
// SECCIÓN 4: ENTRENAMIENTO (CURVA DE APRENDIZAJE Y PARÁMETROS)
// =============================================================================
function renderizarEntrenamiento() {
  const ap = AppState.datos.aprendizaje;
  const cfg = AppState.datos.config;

  if (!ap) {
    mostrarError("entrenamiento-error", "No se cargó la curva de aprendizaje.");
    return;
  }

  // 1. Mostrar mejores valores y parámetros
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

  // Encontrar la mejor recompensa
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

  // 2. Gráfico de Curva de Aprendizaje con Chart.js
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
          pointHoverRadius: 5,
          tension: 0.1,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c.bgTooltip,
          titleColor: c.textoTooltip,
          bodyColor: c.textoTooltip,
          borderColor: c.borderTooltip,
          borderWidth: 1,
          callbacks: {
            title: (items) => `Episodio ${items[0].label}`,
            label: (item) => ` Recompensa Validación: ${item.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Episodios de Entrenamiento (Semanas de 168 h)",
            color: c.textoMuted,
            font: { size: 11 },
          },
          ticks: {
            color: c.textoMuted,
            maxTicksLimit: 12,
            callback: (val, idx) => ap.episodios[idx]?.toLocaleString(),
          },
          grid: { color: c.lineaGrid },
        },
        y: {
          title: {
            display: true,
            text: "Recompensa Anual Acumulada",
            color: c.solarAmbar,
            font: { size: 11, weight: "bold" },
          },
          ticks: { color: c.textoMuted },
          grid: { color: c.lineaGrid },
        },
      },
    },
  });
}

// =============================================================================
// SECCIÓN 5: RESULTADOS Y COMPARATIVA DE ESTRATEGIAS
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

  // Filtrar registros según periodo y época seleccionados
  const registrosFiltrados = metData.metricas.filter(
    (m) => m.periodo === periodo && m.epoca === epoca
  );

  if (registrosFiltrados.length === 0) {
    mostrarError("resultados-error", `No hay datos para periodo '${periodo}' y época '${epoca}'.`);
    return;
  }

  // Orden estándar de visualización de estrategias
  const ordenEstrategias = ["Voraz", "Umbral SoC", "Horaria", "Q-Learning (RL)", "Oráculo (DP)"];
  const registrosOrdenados = [...registrosFiltrados].sort((a, b) => {
    return ordenEstrategias.indexOf(a.estrategia) - ordenEstrategias.indexOf(b.estrategia);
  });

  // 1. Renderizar Tabla
  renderizarTablaResultados(registrosOrdenados);

  // 2. Renderizar / Actualizar Gráfico de Barras
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

    // Insignia o estilo de nombre de estrategia
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

  // Diccionario de metadatos por métrica
  const metaMetricas = {
    pct_critica_cubierta: {
      titulo: "Demanda Crítica Cubierta (%)",
      unidad: "%",
      formato: (v) => `${v.toFixed(2)}%`,
    },
    pct_total_cubierta: {
      titulo: "Demanda Total Cubierta (%)",
      unidad: "%",
      formato: (v) => `${v.toFixed(2)}%`,
    },
    nosrv_crit_kwh: {
      titulo: "Energía Crítica No Servida (kWh)",
      unidad: "kWh",
      formato: (v) => `${v.toFixed(2)} kWh`,
    },
    ciclos_bateria: {
      titulo: "Ciclos Equivalentes de Batería",
      unidad: "ciclos",
      formato: (v) => `${v.toFixed(1)} ciclos`,
    },
    vertido_fv_kwh: {
      titulo: "Energía Solar Vertida / Desperdiciada (kWh)",
      unidad: "kWh",
      formato: (v) => `${v.toFixed(2)} kWh`,
    },
    recompensa_total: {
      titulo: "Recompensa Total Acumulada",
      unidad: "puntos",
      formato: (v) => `${v.toFixed(1)}`,
    },
  };

  const meta = metaMetricas[claveMetrica] || {
    titulo: claveMetrica,
    unidad: "",
    formato: (v) => v.toString(),
  };

  // Actualizar título de la tarjeta
  const elTitulo = document.getElementById("titulo-grafico-resultados");
  if (elTitulo) elTitulo.textContent = `Comparativa: ${meta.titulo}`;

  const etiquetas = registros.map((r) => r.estrategia);
  const valores = registros.map((r) => r[claveMetrica]);

  // Asignar colores distintivos: Agente RL en ámbar solar (#f59e0b) destacado
  const coloresFondo = registros.map((r) => {
    if (r.estrategia.includes("Q-Learning")) return c.solarAmbar;
    if (r.estrategia.includes("Oráculo")) return c.verdeEsmeralda;
    if (r.estrategia === "Voraz") return c.rojoVoraz;
    if (r.estrategia.includes("Umbral")) return c.indigoUmbral;
    if (r.estrategia.includes("Horaria")) return c.purpuraHoraria;
    return "#64748b";
  });

  const bordesFondo = coloresFondo.map((col) => col);

  if (AppState.graficos.resultados) {
    // Si ya existe, actualizar datasets
    AppState.graficos.resultados.data.labels = etiquetas;
    AppState.graficos.resultados.data.datasets[0].label = meta.titulo;
    AppState.graficos.resultados.data.datasets[0].data = valores;
    AppState.graficos.resultados.data.datasets[0].backgroundColor = coloresFondo;
    AppState.graficos.resultados.data.datasets[0].borderColor = bordesFondo;
    AppState.graficos.resultados.options.scales.y.title.text = meta.titulo;
    AppState.graficos.resultados.update();
  } else {
    // Crear gráfico nuevo
    AppState.graficos.resultados = new Chart(ctx, {
      type: "bar",
      data: {
        labels: etiquetas,
        datasets: [
          {
            label: meta.titulo,
            data: valores,
            backgroundColor: coloresFondo,
            borderColor: bordesFondo,
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
          x: {
            ticks: { color: c.textoPrincipal, font: { weight: "bold", size: 11 } },
            grid: { display: false },
          },
          y: {
            title: {
              display: true,
              text: meta.titulo,
              color: c.textoMuted,
              font: { size: 11 },
            },
            ticks: { color: c.textoMuted },
            grid: { color: c.lineaGrid },
          },
        },
      },
    });
  }
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
});
