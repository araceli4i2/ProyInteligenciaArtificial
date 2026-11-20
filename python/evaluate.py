"""
Módulo de Evaluación y Comparativa Final:
Evalúa el agente entrenado (Q-Learning), las 3 políticas de línea base (Voraz, Umbral SoC, Horaria)
y el Oráculo por Programación Dinámica sobre el conjunto de prueba independiente (2023-2024).

Genera:
- Métricas anuales y por época climática (seca, lluviosa, transición).
- Cálculo del '% del óptimo alcanzado' = (R - R_voraz) / (R_oraculo - R_voraz).
- Exportación estructurada a results/metricas.csv.
- Tablas comparativas impresas en consola.
"""

from pathlib import Path
from typing import Dict, Any, List, Optional
import numpy as np
import pandas as pd

from config import (
    RUTA_DATOS_PROCESADOS,
    DIR_RESULTADOS,
    ANIOS_PRUEBA,
    SOC_INICIAL_DEFAULT,
    SOC_MIN,
    SOC_MAX,
    NUM_INTERVALOS_SOC,
    POTENCIA_PICO_FV,
    CAPACIDAD_BATERIA_NOMINAL,
)
from env import paso_fisico, generar_o_cargar_demanda
from baselines import (
    simular_politica_voraz,
    simular_politica_umbral,
    simular_politica_horaria,
)
from oracle_dp import resolver_oraculo_dp
from metricas import metricas, imprimir_tabla_metricas
from train_q import discretizar_componentes_estaticos


def simular_agente_q(
    Q: np.ndarray,
    df_clima: pd.DataFrame,
    df_demanda: pd.DataFrame,
    p_pico: float = POTENCIA_PICO_FV,
    c_nom: float = CAPACIDAD_BATERIA_NOMINAL,
    soc_inicial: float = SOC_INICIAL_DEFAULT,
) -> pd.DataFrame:
    """
    Ejecuta el agente Q-learning greedy sobre el periodo especificado y retorna
    el DataFrame completo de trazas horarias.
    """
    indices_comunes = df_clima.index.intersection(df_demanda.index)
    clima = df_clima.loc[indices_comunes]
    dem = df_demanda.loc[indices_comunes]

    n = len(clima)
    horas = clima["hora"].values.astype(np.int32)
    ghis = clima["ghi_wh_m2"].values.astype(np.float64)
    t2ms = clima["t2m_c"].values.astype(np.float64)
    ghi_ayer = clima["ghi_ayer_wh"].values.astype(np.float64)
    epocas = clima["epoca"].values if "epoca" in clima.columns else ["anual"] * n

    col_dem_c = "dem_crit" if "dem_crit" in dem.columns else "demanda_critica_kw"
    col_dem_nc = "dem_nc" if "dem_nc" in dem.columns else "demanda_no_critica_kw"
    dem_crit = dem[col_dem_c].values.astype(np.float64)
    dem_nc = dem[col_dem_nc].values.astype(np.float64)

    ghi_idx, ghi_ayer_idx = discretizar_componentes_estaticos(ghis, ghi_ayer)
    paso_soc_inv = NUM_INTERVALOS_SOC / (SOC_MAX - SOC_MIN)

    soc_arr = np.empty(n, dtype=float)
    accion_arr = np.empty(n, dtype=int)
    fv_kw_arr = np.empty(n, dtype=float)
    fv_dir_arr = np.empty(n, dtype=float)
    serv_c_arr = np.empty(n, dtype=float)
    serv_nc_arr = np.empty(n, dtype=float)
    nosrv_c_arr = np.empty(n, dtype=float)
    nosrv_nc_arr = np.empty(n, dtype=float)
    a_bat_arr = np.empty(n, dtype=float)
    de_bat_arr = np.empty(n, dtype=float)
    vert_arr = np.empty(n, dtype=float)
    rec_arr = np.empty(n, dtype=float)

    soc_actual = float(soc_inicial)

    for t in range(n):
        h = horas[t]
        s_idx = int((soc_actual - SOC_MIN) * paso_soc_inv)
        if s_idx < 0:
            s_idx = 0
        elif s_idx >= NUM_INTERVALOS_SOC:
            s_idx = NUM_INTERVALOS_SOC - 1

        gi = ghi_idx[t]
        ga = ghi_ayer_idx[t]

        # Política greedy
        q_s = Q[h, s_idx, gi, ga]
        mejor_a = int(np.argmax(q_s))

        soc_nuevo, info = paso_fisico(
            soc=soc_actual,
            ghi=ghis[t],
            t2m=t2ms[t],
            dem_crit=dem_crit[t],
            dem_nc=dem_nc[t],
            accion=mejor_a,
            p_pico=p_pico,
            c_nom=c_nom,
            retornar_info=True,
        )

        soc_arr[t] = soc_actual
        accion_arr[t] = mejor_a
        fv_kw_arr[t] = info["fv_kw"]
        fv_dir_arr[t] = info.get("fv_servido_directo", info["fv_kw"] - info["a_bateria"] - info["vertido"])
        serv_c_arr[t] = info["servido_crit"]
        serv_nc_arr[t] = info["servido_nc"]
        nosrv_c_arr[t] = info["nosrv_crit"]
        nosrv_nc_arr[t] = info["nosrv_nc"]
        a_bat_arr[t] = info["a_bateria"]
        de_bat_arr[t] = info["de_bateria"]
        vert_arr[t] = info["vertido"]
        rec_arr[t] = info["recompensa"]

        soc_actual = soc_nuevo

    trazas = pd.DataFrame(
        {
            "hora": horas,
            "soc": soc_arr,
            "accion": accion_arr,
            "dem_crit": dem_crit,
            "dem_nc": dem_nc,
            "fv_kw": fv_kw_arr,
            "fv_servido_directo": fv_dir_arr,
            "servido_crit": serv_c_arr,
            "servido_nc": serv_nc_arr,
            "nosrv_crit": nosrv_c_arr,
            "nosrv_nc": nosrv_nc_arr,
            "a_bateria": a_bat_arr,
            "de_bateria": de_bat_arr,
            "vertido": vert_arr,
            "recompensa": rec_arr,
            "epoca": epocas,
        },
        index=indices_comunes,
    )
    trazas.index.name = "datetime_local"
    return trazas


def evaluar_periodo_completo(anios: List[int] = ANIOS_PRUEBA) -> pd.DataFrame:
    """
    Evalúa las 5 estrategias sobre los años de prueba (2023 y 2024),
    calculando indicadores globales, por año y por época climática.
    """
    print("=" * 115)
    print(f"EVALUACIÓN EN AÑOS DE PRUEBA {anios} (DATOS NUNCA VISTOS POR EL AGENTE)")
    print("=" * 115)

    # 1. Cargar datos climáticos y demanda
    df_clima = pd.read_csv(RUTA_DATOS_PROCESADOS, index_col=0, parse_dates=True)
    df_demanda = generar_o_cargar_demanda()

    # Asegurar columna ghi_ayer_wh
    irrad_diaria = df_clima.groupby(df_clima.index.date)["ghi_wh_m2"].sum().to_dict()
    fechas_ayer = [d - pd.Timedelta(days=1) for d in df_clima.index.date]
    media_diaria = 6012.0
    df_clima["ghi_ayer_wh"] = [irrad_diaria.get(d, media_diaria) for d in fechas_ayer]

    # Cargar mejor tabla Q entrenada
    ruta_q = DIR_RESULTADOS / "q_table.npy"
    if not ruta_q.exists():
        raise FileNotFoundError(f"No se encontró la tabla Q entrenada en {ruta_q}. Ejecuta train_q.py primero.")
    Q_agente = np.load(ruta_q)
    print(f"[OK] Tabla Q cargada exitosamente desde: {ruta_q}")

    filas_resultados: List[Dict[str, Any]] = []

    # Bloques de evaluación: [Periodo Completo, 2023, 2024]
    bloques = [
        ("Prueba 2023-2024", anios),
        ("Año 2023", [2023]),
        ("Año 2024", [2024]),
    ]

    for nombre_bloque, lista_anios in bloques:
        print(f"\n>>> Evaluando bloque: {nombre_bloque}...")
        mask = df_clima["anio"].isin(lista_anios)
        clima_sub = df_clima[mask]
        dem_sub = df_demanda[mask]

        # Simular las 5 estrategias
        trazas_voraz = simular_politica_voraz(clima_sub, dem_sub)
        trazas_umbral = simular_politica_umbral(clima_sub, dem_sub)
        trazas_horaria = simular_politica_horaria(clima_sub, dem_sub)
        trazas_agente = simular_agente_q(Q_agente, clima_sub, dem_sub)
        _, _, trazas_oracle, _ = resolver_oraculo_dp(clima_sub, dem_sub)

        dict_trazas = {
            "Voraz": trazas_voraz,
            "Umbral SoC": trazas_umbral,
            "Horaria": trazas_horaria,
            "Q-Learning (RL)": trazas_agente,
            "Oráculo (DP)": trazas_oracle,
        }

        # Métricas sobre todo el bloque
        m_bloque = {k: metricas(v) for k, v in dict_trazas.items()}
        r_voraz = m_bloque["Voraz"]["recompensa_total"]
        r_oraculo = m_bloque["Oráculo (DP)"]["recompensa_total"]
        denominador_optimo = r_oraculo - r_voraz if abs(r_oraculo - r_voraz) > 1e-6 else 1.0

        for est, m in m_bloque.items():
            r_act = m["recompensa_total"]
            pct_optimo = ((r_act - r_voraz) / denominador_optimo) * 100.0
            filas_resultados.append(
                {
                    "periodo": nombre_bloque,
                    "epoca": "anual",
                    "estrategia": est,
                    **m,
                    "pct_optimo_alcanzado": pct_optimo,
                }
            )

        # Imprimir tabla del bloque
        imprimir_tabla_metricas(m_bloque, titulo=f"EVALUACIÓN: {nombre_bloque.upper()}")

        # Desglose por época si es el periodo completo de prueba (2023-2024)
        if nombre_bloque == "Prueba 2023-2024":
            for ep_nombre in ["lluviosa", "seca", "transicion"]:
                m_ep = {k: metricas(v, epoca=ep_nombre) for k, v in dict_trazas.items()}
                r_v_ep = m_ep["Voraz"]["recompensa_total"]
                r_o_ep = m_ep["Oráculo (DP)"]["recompensa_total"]
                den_ep = r_o_ep - r_v_ep if abs(r_o_ep - r_v_ep) > 1e-6 else 1.0

                for est, m in m_ep.items():
                    r_act = m["recompensa_total"]
                    pct_optimo = ((r_act - r_v_ep) / den_ep) * 100.0
                    filas_resultados.append(
                        {
                            "periodo": nombre_bloque,
                            "epoca": ep_nombre,
                            "estrategia": est,
                            **m,
                            "pct_optimo_alcanzado": pct_optimo,
                        }
                    )
                imprimir_tabla_metricas(m_ep, titulo=f"ÉPOCA: {ep_nombre.upper()} (2023-2024)")

    # 4. Guardar archivo final de métricas
    df_metricas = pd.DataFrame(filas_resultados)
    ruta_metricas = DIR_RESULTADOS / "metricas.csv"
    df_metricas.to_csv(ruta_metricas, index=False)
    print(f"\n[OK] Tabla completa de métricas guardada en: {ruta_metricas}")

    return df_metricas


if __name__ == "__main__":
    evaluar_periodo_completo()
