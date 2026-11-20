"""
Módulo de Exportación de Datos para la Web Estática:
Lee los datasets climáticos, de demanda, resultados de simulación, curva de aprendizaje
y tabla Q entrenada, y genera los 6 archivos JSON requeridos en web/data/:
1. clima.json
2. config.json
3. aprendizaje.json
4. metricas.json
5. semanas.json
6. politica.json

Todos los valores numéricos de punto flotante están redondeados a 3 decimales,
codificados en UTF-8 y libres de valores NaN.
"""

import json
from pathlib import Path
from typing import Dict, Any, List
import numpy as np
import pandas as pd

from config import (
    DIR_BASE,
    DIR_WEB_DATOS,
    DIR_RESULTADOS,
    RUTA_DATOS_PROCESADOS,
    POTENCIA_PICO_FV,
    POTENCIA_PICO_FV_INICIAL,
    RENDIMIENTO_SISTEMA_FV,
    COEF_TEMPERATURA_FV,
    TEMP_REF_STC,
    TEMP_NOCT,
    TEMP_AMB_NOCT,
    IRRAD_NOCT,
    CAPACIDAD_BATERIA_NOMINAL,
    CAPACIDAD_BATERIA_INICIAL,
    SOC_MIN,
    SOC_MAX,
    SOC_INICIAL_DEFAULT,
    EFICIENCIA_CARGA,
    EFICIENCIA_DESCARGA,
    POTENCIA_MAX_BATERIA,
    DEMANDA_CRITICA_DIARIA_OBJETIVO,
    DEMANDA_NO_CRITICA_DIARIA_OBJETIVO,
    FACTOR_FIN_DE_SEMANA,
    SIGMA_RUIDO_DEMANDA,
    PESO_NO_SRV_CRIT,
    PESO_NO_SRV_NC,
    PESO_BATERIA,
    NUM_INTERVALOS_HORA,
    NUM_INTERVALOS_SOC,
    NUM_NIVELES_GHI,
    NUM_NIVELES_GHI_AYER,
    TOTAL_ESTADOS_DISCRETOS,
    UMBRAL_GHI_NOCHE,
    UMBRALES_GHI_DIURNO,
    UMBRALES_GHI_AYER,
    ANIOS_ENTRENAMIENTO,
    ANIOS_VALIDACION,
    ANIOS_PRUEBA,
    SEMILLA_ALEATORIA,
    MESES_SECA,
    MESES_LLUVIOSA,
    MESES_TRANSICION,
)
from env import generar_o_cargar_demanda

def clasificar_epoca(mes: int) -> str:
    """Clasifica el mes en época climática de La Paz."""
    if mes in MESES_SECA:
        return "seca"
    elif mes in MESES_LLUVIOSA:
        return "lluviosa"
    elif mes in MESES_TRANSICION:
        return "transicion"
    return "desconocida"
from baselines import (
    simular_politica_voraz,
    simular_politica_umbral,
    simular_politica_horaria,
)
from oracle_dp import resolver_oraculo_dp
from evaluate import simular_agente_q

NOMBRES_MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
]


def limpiar_y_redondear(obj: Any, decimales: int = 3) -> Any:
    """
    Recorre recursivamente estructuras de datos (dict, list, float, etc.)
    redondeando flotantes a 'decimales' y reemplazando NaN/Infs por 0.0.
    """
    if isinstance(obj, float) or isinstance(obj, np.floating):
        if np.isnan(obj) or np.isinf(obj):
            return 0.0
        return round(float(obj), decimales)
    elif isinstance(obj, int) or isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, dict):
        return {k: limpiar_y_redondear(v, decimales) for k, v in obj.items()}
    elif isinstance(obj, list) or isinstance(obj, tuple):
        return [limpiar_y_redondear(x, decimales) for x in obj]
    elif isinstance(obj, np.ndarray):
        return limpiar_y_redondear(obj.tolist(), decimales)
    return obj


def guardar_json(datos: Any, ruta_archivo: Path):
    """Guarda una estructura de datos en formato JSON con UTF-8 y sin NaN."""
    ruta_archivo.parent.mkdir(parents=True, exist_ok=True)
    datos_limpios = limpiar_y_redondear(datos, decimales=3)
    with open(ruta_archivo, "w", encoding="utf-8") as f:
        json.dump(datos_limpios, f, ensure_ascii=False, indent=2)


# ==============================================================================
# 1. CLIMA.JSON
# ==============================================================================
def exportar_clima(df_clima: pd.DataFrame, ruta_salida: Path):
    """
    Genera clima.json:
    - Matriz 24x12 de GHI media (Wh/m²) por hora local y mes.
    - Temperatura media por mes.
    - Irradiación diaria por mes (kWh/m²/día) con media, P10 y P90.
    """
    print("Exportando clima.json...")
    # Matriz 24 horas x 12 meses de GHI medio
    matriz_ghi = []
    for h in range(24):
        fila_hora = []
        for m in range(1, 13):
            sub = df_clima[(df_clima["hora"] == h) & (df_clima["mes"] == m)]
            val = sub["ghi_wh_m2"].mean() if len(sub) > 0 else 0.0
            fila_hora.append(round(float(val), 3))
        matriz_ghi.append(fila_hora)

    # Temperatura media mensual
    temp_media_mes = []
    for m in range(1, 13):
        val_t = df_clima[df_clima["mes"] == m]["t2m_c"].mean()
        temp_media_mes.append(round(float(val_t), 3))

    # Irradiación diaria por mes (kWh/m²/día): media, P10, P90
    # Filtrar días completos a partir de 2015
    df_dias = df_clima[df_clima["anio"] >= 2015]
    radiacion_diaria = df_dias.groupby([df_dias["mes"], df_dias.index.date])["ghi_wh_m2"].sum() / 1000.0

    irrad_media = []
    irrad_p10 = []
    irrad_p90 = []

    for m in range(1, 13):
        serie_m = radiacion_diaria.loc[m]
        irrad_media.append(round(float(serie_m.mean()), 3))
        irrad_p10.append(round(float(np.percentile(serie_m, 10)), 3))
        irrad_p90.append(round(float(np.percentile(serie_m, 90)), 3))

    data_clima = {
        "nombres_meses": NOMBRES_MESES,
        "epocas_meses": [clasificar_epoca(m) for m in range(1, 13)],
        "matriz_ghi_hora_mes": matriz_ghi,
        "temperatura_media_mes": temp_media_mes,
        "irradiacion_diaria_mes": {
            "media": irrad_media,
            "p10": irrad_p10,
            "p90": irrad_p90,
        },
    }
    guardar_json(data_clima, ruta_salida)
    print(f"  -> Guardado: {ruta_salida}")


# ==============================================================================
# 2. CONFIG.JSON
# ==============================================================================
def exportar_config(ruta_salida: Path):
    """
    Genera config.json:
    Parámetros de FV, batería, demanda, recompensa, discretización, división temporal
    e hiperparámetros de Q-learning.
    """
    print("Exportando config.json...")
    capacidad_util = (SOC_MAX - SOC_MIN) * CAPACIDAD_BATERIA_NOMINAL

    data_config = {
        "fotovoltaico": {
            "potencia_pico_kw": round(POTENCIA_PICO_FV, 3),
            "potencia_pico_inicial_kw": round(POTENCIA_PICO_FV_INICIAL, 3),
            "rendimiento_pr": round(RENDIMIENTO_SISTEMA_FV, 3),
            "coef_temperatura_por_c": round(COEF_TEMPERATURA_FV, 4),
            "temp_ref_stc_c": round(TEMP_REF_STC, 1),
            "temp_noct_c": round(TEMP_NOCT, 1),
            "temp_amb_noct_c": round(TEMP_AMB_NOCT, 1),
            "irrad_noct_w_m2": round(IRRAD_NOCT, 1),
        },
        "bateria": {
            "capacidad_nominal_kwh": round(CAPACIDAD_BATERIA_NOMINAL, 3),
            "capacidad_inicial_kwh": round(CAPACIDAD_BATERIA_INICIAL, 3),
            "capacidad_util_kwh": round(capacidad_util, 3),
            "soc_min": round(SOC_MIN, 2),
            "soc_max": round(SOC_MAX, 2),
            "soc_inicial": round(SOC_INICIAL_DEFAULT, 2),
            "eficiencia_carga": round(EFICIENCIA_CARGA, 2),
            "eficiencia_descarga": round(EFICIENCIA_DESCARGA, 2),
            "potencia_max_kw": round(POTENCIA_MAX_BATERIA, 2),
        },
        "demanda": {
            "critica_diaria_kwh": round(DEMANDA_CRITICA_DIARIA_OBJETIVO, 2),
            "no_critica_diaria_kwh": round(DEMANDA_NO_CRITICA_DIARIA_OBJETIVO, 2),
            "total_diaria_kwh": round(DEMANDA_CRITICA_DIARIA_OBJETIVO + DEMANDA_NO_CRITICA_DIARIA_OBJETIVO, 2),
            "factor_fin_de_semana": round(FACTOR_FIN_DE_SEMANA, 2),
            "sigma_ruido": round(SIGMA_RUIDO_DEMANDA, 2),
        },
        "recompensa": {
            "peso_no_srv_crit": round(PESO_NO_SRV_CRIT, 1),
            "peso_no_srv_nc": round(PESO_NO_SRV_NC, 1),
            "peso_bateria": round(PESO_BATERIA, 2),
        },
        "discretizacion": {
            "num_horas": NUM_INTERVALOS_HORA,
            "num_soc": NUM_INTERVALOS_SOC,
            "num_ghi": NUM_NIVELES_GHI,
            "num_ghi_ayer": NUM_NIVELES_GHI_AYER,
            "total_estados": TOTAL_ESTADOS_DISCRETOS,
            "umbral_noche_ghi_w_m2": round(UMBRAL_GHI_NOCHE, 1),
            "umbrales_ghi_diurno_w_m2": [round(x, 2) for x in UMBRALES_GHI_DIURNO],
            "umbrales_ghi_ayer_wh_m2": [round(x, 2) for x in UMBRALES_GHI_AYER],
        },
        "division_temporal": {
            "entrenamiento": ANIOS_ENTRENAMIENTO,
            "validacion": ANIOS_VALIDACION,
            "prueba": ANIOS_PRUEBA,
        },
        "q_learning": {
            "episodios": 60000,
            "horas_por_episodio": 168,
            "alfa": 0.1,
            "gamma": 0.99,
            "epsilon_inicial": 1.0,
            "epsilon_final": 0.05,
            "fraccion_decay": 0.70,
            "intervalo_evaluacion": 500,
            "semilla": SEMILLA_ALEATORIA,
        },
    }
    guardar_json(data_config, ruta_salida)
    print(f"  -> Guardado: {ruta_salida}")


# ==============================================================================
# 3. APRENDIZAJE.JSON
# ==============================================================================
def exportar_aprendizaje(ruta_curva: Path, ruta_salida: Path):
    """
    Genera aprendizaje.json:
    Curva de aprendizaje (episodio, recompensa_val, cob_critica_val, cob_total_val, epsilon).
    """
    print("Exportando aprendizaje.json...")
    df_curva = pd.read_csv(ruta_curva)
    data_ap = {
        "episodios": df_curva["episodio"].astype(int).tolist(),
        "epsilon": [round(float(x), 3) for x in df_curva["epsilon"]],
        "recompensa_val": [round(float(x), 2) for x in df_curva["recompensa_val"]],
        "cob_critica_val": [round(float(x), 2) for x in df_curva["cob_critica_val"]],
        "cob_total_val": [round(float(x), 2) for x in df_curva["cob_total_val"]],
        "tiempo_acumulado_s": [round(float(x), 1) for x in df_curva["tiempo_acumulado_s"]],
    }
    guardar_json(data_ap, ruta_salida)
    print(f"  -> Guardado: {ruta_salida}")


# ==============================================================================
# 4. METRICAS.JSON
# ==============================================================================
def exportar_metricas(ruta_metricas_csv: Path, ruta_salida: Path):
    """
    Genera metricas.json:
    Métricas por estrategia, año y época estructuradas para visualización web.
    """
    print("Exportando metricas.json...")
    df_m = pd.read_csv(ruta_metricas_csv)

    registros = []
    for _, fila in df_m.iterrows():
        reg = {
            "periodo": fila["periodo"],
            "epoca": fila["epoca"],
            "estrategia": fila["estrategia"],
            "horas_evaluadas": int(fila["horas_evaluadas"]),
            "demanda_total_kwh": round(float(fila["demanda_total_kwh"]), 2),
            "demanda_critica_kwh": round(float(fila["demanda_critica_kwh"]), 2),
            "demanda_no_critica_kwh": round(float(fila["demanda_no_critica_kwh"]), 2),
            "pct_total_cubierta": round(float(fila["pct_total_cubierta"]), 2),
            "pct_critica_cubierta": round(float(fila["pct_critica_cubierta"]), 2),
            "pct_no_critica_cubierta": round(float(fila["pct_no_critica_cubierta"]), 2),
            "nosrv_total_kwh": round(float(fila["nosrv_total_kwh"]), 2),
            "nosrv_crit_kwh": round(float(fila["nosrv_crit_kwh"]), 2),
            "nosrv_nc_kwh": round(float(fila["nosrv_nc_kwh"]), 2),
            "ciclos_bateria": round(float(fila["ciclos_equivalentes"]), 1),
            "ciclos_bateria_384": round(float(fila["ciclos_equivalentes_384"]), 1),
            "vertido_fv_kwh": round(float(fila["vertido_fv_kwh"]), 2),
            "fv_total_kwh": round(float(fila["fv_total_kwh"]), 2),
            "recompensa_total": round(float(fila["recompensa_total"]), 2),
            "pct_optimo_alcanzado": round(float(fila["pct_optimo_alcanzado"]), 2),
        }
        registros.append(reg)

    data_met = {
        "metricas": registros
    }
    guardar_json(data_met, ruta_salida)
    print(f"  -> Guardado: {ruta_salida}")


# ==============================================================================
# 5. SEMANAS.JSON
# ==============================================================================
def exportar_semanas(
    df_clima: pd.DataFrame,
    df_demanda: pd.DataFrame,
    ruta_salida: Path,
):
    """
    Genera semanas.json:
    12 semanas de 2024 (la primera semana de 168 h de cada mes: días 1 al 7),
    con formato orientado a columnas para minimizar el tamaño del archivo.
    """
    print("Exportando semanas.json (12 semanas de 2024)...")
    # Cargar tabla Q y preparar simulaciones para el año 2024
    mask_2024 = df_clima["anio"] == 2024
    clima_2024 = df_clima[mask_2024].copy()
    dem_2024 = df_demanda[mask_2024].copy()

    ruta_q = DIR_RESULTADOS / "q_table.npy"
    Q = np.load(ruta_q)

    # Simular año 2024 completo para cada estrategia
    print("  Simulando año 2024 para extraer semanas realistas...")
    trazas_voraz = simular_politica_voraz(clima_2024, dem_2024)
    trazas_umbral = simular_politica_umbral(clima_2024, dem_2024)
    trazas_horaria = simular_politica_horaria(clima_2024, dem_2024)
    trazas_agente = simular_agente_q(Q, clima_2024, dem_2024)
    _, _, trazas_oracle, _ = resolver_oraculo_dp(clima_2024, dem_2024)

    semanas_lista = []

    for m in range(1, 13):
        # Primera semana completa de cada mes: día 1 a día 7 (168 h)
        fecha_inicio_str = f"2024-{m:02d}-01 00:00:00"
        ts_inicio = pd.to_datetime(fecha_inicio_str)
        ts_fin = ts_inicio + pd.Timedelta(hours=167)

        sub_clima = clima_2024.loc[ts_inicio:ts_fin]
        sub_dem = dem_2024.loc[ts_inicio:ts_fin]

        sub_vor = trazas_voraz.loc[ts_inicio:ts_fin]
        sub_umb = trazas_umbral.loc[ts_inicio:ts_fin]
        sub_hor = trazas_horaria.loc[ts_inicio:ts_fin]
        sub_age = trazas_agente.loc[ts_inicio:ts_fin]
        sub_ora = trazas_oracle.loc[ts_inicio:ts_fin]

        semana_dict = {
            "mes": m,
            "nombre_mes": NOMBRES_MESES[m - 1],
            "epoca": clasificar_epoca(m),
            "fecha_inicio": ts_inicio.strftime("%Y-%m-%d %H:%M"),
            "fecha_fin": ts_fin.strftime("%Y-%m-%d %H:%M"),
            "horas": sub_clima["hora"].astype(int).tolist(),
            "ghi": [round(float(x), 3) for x in sub_clima["ghi_wh_m2"]],
            "t2m": [round(float(x), 3) for x in sub_clima["t2m_c"]],
            "pv_kw": [round(float(x), 3) for x in sub_vor["fv_kw"]],
            "dem_crit": [round(float(x), 3) for x in sub_dem["demanda_critica_kw"]],
            "dem_nc": [round(float(x), 3) for x in sub_dem["demanda_no_critica_kw"]],
            "estrategias": {
                "agente": {
                    "soc": [round(float(x), 3) for x in sub_age["soc"]],
                    "accion": sub_age["accion"].astype(int).tolist(),
                    "nosrv_crit": [round(float(x), 3) for x in sub_age["nosrv_crit"]],
                    "nosrv_nc": [round(float(x), 3) for x in sub_age["nosrv_nc"]],
                },
                "voraz": {
                    "soc": [round(float(x), 3) for x in sub_vor["soc"]],
                    "accion": sub_vor["accion"].astype(int).tolist(),
                    "nosrv_crit": [round(float(x), 3) for x in sub_vor["nosrv_crit"]],
                    "nosrv_nc": [round(float(x), 3) for x in sub_vor["nosrv_nc"]],
                },
                "umbral": {
                    "soc": [round(float(x), 3) for x in sub_umb["soc"]],
                    "accion": sub_umb["accion"].astype(int).tolist(),
                    "nosrv_crit": [round(float(x), 3) for x in sub_umb["nosrv_crit"]],
                    "nosrv_nc": [round(float(x), 3) for x in sub_umb["nosrv_nc"]],
                },
                "horaria": {
                    "soc": [round(float(x), 3) for x in sub_hor["soc"]],
                    "accion": sub_hor["accion"].astype(int).tolist(),
                    "nosrv_crit": [round(float(x), 3) for x in sub_hor["nosrv_crit"]],
                    "nosrv_nc": [round(float(x), 3) for x in sub_hor["nosrv_nc"]],
                },
                "oraculo": {
                    "soc": [round(float(x), 3) for x in sub_ora["soc"]],
                    "accion": sub_ora["accion"].astype(int).tolist(),
                    "nosrv_crit": [round(float(x), 3) for x in sub_ora["nosrv_crit"]],
                    "nosrv_nc": [round(float(x), 3) for x in sub_ora["nosrv_nc"]],
                },
            },
        }
        semanas_lista.append(semana_dict)

    data_semanas = {"semanas": semanas_lista}
    guardar_json(data_semanas, ruta_salida)
    print(f"  -> Guardado: {ruta_salida}")


# ==============================================================================
# 6. POLITICA.JSON
# ==============================================================================
def exportar_politica(ruta_q: Path, ruta_salida: Path):
    """
    Genera politica.json:
    Política greedy [hora][soc][rad][rad_prev] con acción elegida,
    más los umbrales de discretización y etiquetas para gráficos interactivos.
    """
    print("Exportando politica.json...")
    Q = np.load(ruta_q)
    # Extraer la mejor acción: argmax sobre la última dimensión (acciones)
    politica_greedy = np.argmax(Q, axis=-1).astype(int).tolist()

    etiquetas_soc = [
        f"{int(SOC_MIN*100 + i*8)}-{int(SOC_MIN*100 + (i+1)*8)} %"
        for i in range(NUM_INTERVALOS_SOC)
    ]
    etiquetas_rad = [
        f"Noche (≤ {UMBRAL_GHI_NOCHE:.0f} W/m²)",
        f"Baja (≤ {UMBRALES_GHI_DIURNO[0]:.0f} W/m²)",
        f"Media (≤ {UMBRALES_GHI_DIURNO[1]:.0f} W/m²)",
        f"Alta (> {UMBRALES_GHI_DIURNO[1]:.0f} W/m²)",
    ]
    etiquetas_rad_prev = [
        f"Ayer Nublado (< {UMBRALES_GHI_AYER[0]/1000:.1f} kWh/m²)",
        f"Ayer Medio ({UMBRALES_GHI_AYER[0]/1000:.1f}-{UMBRALES_GHI_AYER[1]/1000:.1f} kWh/m²)",
        f"Ayer Despejado (≥ {UMBRALES_GHI_AYER[1]/1000:.1f} kWh/m²)",
    ]

    data_pol = {
        "dimensiones": ["hora", "soc", "radiacion", "radiacion_dia_anterior"],
        "forma": [NUM_INTERVALOS_HORA, NUM_INTERVALOS_SOC, NUM_NIVELES_GHI, NUM_NIVELES_GHI_AYER],
        "acciones": {
            0: "ALMACENAR",
            1: "EQUILIBRAR",
            2: "CONSUMIR",
        },
        "etiquetas": {
            "hora": [f"{h:02d}:00" for h in range(NUM_INTERVALOS_HORA)],
            "soc": etiquetas_soc,
            "radiacion": etiquetas_rad,
            "radiacion_dia_anterior": etiquetas_rad_prev,
        },
        "umbrales": {
            "soc_min": SOC_MIN,
            "soc_max": SOC_MAX,
            "paso_soc": round((SOC_MAX - SOC_MIN) / NUM_INTERVALOS_SOC, 3),
            "ghi_noche": UMBRAL_GHI_NOCHE,
            "ghi_diurno": UMBRALES_GHI_DIURNO,
            "ghi_ayer": UMBRALES_GHI_AYER,
        },
        "politica": politica_greedy,
    }
    guardar_json(data_pol, ruta_salida)
    print(f"  -> Guardado: {ruta_salida}")


# ==============================================================================
# FUNCIÓN PRINCIPAL DE EXPORTACIÓN
# ==============================================================================
def exportar_todo():
    """Ejecuta la exportación de los 6 archivos JSON a web/data/."""
    print("=" * 80)
    print("EXPORTACIÓN DE DATOS ESTÁTICOS PARA WEB (web/data/)")
    print("=" * 80)

    DIR_WEB_DATOS.mkdir(parents=True, exist_ok=True)

    df_clima = pd.read_csv(RUTA_DATOS_PROCESADOS, index_col=0, parse_dates=True)
    df_demanda = generar_o_cargar_demanda()

    # Asegurar columna ghi_dia_anterior
    irrad_diaria = df_clima.groupby(df_clima.index.date)["ghi_wh_m2"].sum().to_dict()
    fechas_ayer = [d - pd.Timedelta(days=1) for d in df_clima.index.date]
    media_diaria = 6012.0
    df_clima["ghi_ayer_wh"] = [irrad_diaria.get(d, media_diaria) for d in fechas_ayer]

    ruta_clima = DIR_WEB_DATOS / "clima.json"
    ruta_config = DIR_WEB_DATOS / "config.json"
    ruta_aprendizaje = DIR_WEB_DATOS / "aprendizaje.json"
    ruta_metricas = DIR_WEB_DATOS / "metricas.json"
    ruta_semanas = DIR_WEB_DATOS / "semanas.json"
    ruta_politica = DIR_WEB_DATOS / "politica.json"

    exportar_clima(df_clima, ruta_clima)
    exportar_config(ruta_config)
    exportar_aprendizaje(DIR_RESULTADOS / "curva_aprendizaje.csv", ruta_aprendizaje)
    exportar_metricas(DIR_RESULTADOS / "metricas.csv", ruta_metricas)
    exportar_semanas(df_clima, df_demanda, ruta_semanas)
    exportar_politica(DIR_RESULTADOS / "q_table.npy", ruta_politica)

    print("\n" + "=" * 80)
    print("VERIFICACIÓN DE INTEGRIDAD Y TAMAÑOS DE ARCHIVOS JSON")
    print("=" * 80)

    archivos = [
        ("clima.json", ruta_clima),
        ("config.json", ruta_config),
        ("aprendizaje.json", ruta_aprendizaje),
        ("metricas.json", ruta_metricas),
        ("semanas.json", ruta_semanas),
        ("politica.json", ruta_politica),
    ]

    for nombre, ruta in archivos:
        tam_bytes = ruta.stat().st_size
        tam_kb = tam_bytes / 1024.0
        assert tam_bytes < 1024 * 1024, f"ERROR: {nombre} excede 1 MB ({tam_kb:.2f} KB)"

        # Comprobar apertura con json.load
        with open(ruta, "r", encoding="utf-8") as f:
            obj = json.load(f)

        print(f"\nArchivo: {nombre}  |  Tamaño: {tam_kb:6.2f} KB (< 1024 KB)  |  Carga JSON: [OK]")

        # Imprimir 3 valores o claves de ejemplo
        if isinstance(obj, dict):
            claves = list(obj.keys())[:3]
            print(f"  Claves principales: {claves}")
            for k in claves:
                val = obj[k]
                if isinstance(val, list):
                    muestra = val[:3] if len(val) >= 3 else val
                    print(f"    * '{k}': lista de {len(val)} elementos. Muestra: {muestra}")
                elif isinstance(val, dict):
                    print(f"    * '{k}': diccionario con claves {list(val.keys())[:3]}")
                else:
                    print(f"    * '{k}': {val}")
        elif isinstance(obj, list):
            print(f"  Lista con {len(obj)} elementos. Primeros 3:")
            for item in obj[:3]:
                print(f"    * {item}")

    print("\n" + "=" * 80)
    print("EXPORTACIÓN COMPLETADA CON ÉXITO")
    print("=" * 80)


if __name__ == "__main__":
    exportar_todo()
