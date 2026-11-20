"""
Módulo del Oráculo por Programación Dinámica (Cota Superior con Información Perfecta):
Resuelve el problema de gestión de la batería conociendo de antemano el clima y la demanda
a lo largo de todo el horizonte temporal.

Implementa:
- Discretización del SoC en 33 niveles en [20 %, 100 %].
- Inducción hacia atrás (Backward Induction) sobre el año completo vectorizada con NumPy.
- Interpolación lineal del valor futuro V(t+1, SoC_siguiente).
- Simulación hacia adelante para extraer la trayectoria óptima y trazas horarias.
- Única implementación de la física: utiliza paso_fisico de env.py.
"""

import time
from typing import Tuple, Optional, Dict, Any
import numpy as np
import pandas as pd

from config import (
    SOC_MIN,
    SOC_MAX,
    SOC_INICIAL_DEFAULT,
    POTENCIA_PICO_FV,
    CAPACIDAD_BATERIA_NOMINAL,
    NUM_ACCIONES,
    ACCION_ALMACENAR,
    ACCION_EQUILIBRAR,
    ACCION_CONSUMIR,
)
from env import paso_fisico
from baselines import cargar_datos_evaluacion
from metricas import metricas, imprimir_tabla_metricas


def resolver_oraculo_dp(
    df_clima: pd.DataFrame,
    df_demanda: pd.DataFrame,
    num_niveles_soc: int = 33,
    p_pico: Optional[float] = None,
    c_nom: Optional[float] = None,
    soc_inicial: float = SOC_INICIAL_DEFAULT,
) -> Tuple[float, np.ndarray, pd.DataFrame, float]:
    """
    Resuelve el control óptimo mediante Programación Dinámica con información perfecta.

    Parámetros:
      - df_clima: DataFrame climático (con 'ghi_wh_m2', 't2m_c', 'hora', 'epoca').
      - df_demanda: DataFrame de demanda horaria.
      - num_niveles_soc: Cantidad de puntos de la grilla de SoC (por defecto 33).
      - p_pico, c_nom: Parámetros físicos.
      - soc_inicial: Estado de carga al inicio del horizonte (default 0.50).

    Retorna:
      (valor_optimo, secuencia_acciones, trazas_oracle, tiempo_segundos)
    """
    if p_pico is None:
        p_pico = POTENCIA_PICO_FV
    if c_nom is None:
        c_nom = CAPACIDAD_BATERIA_NOMINAL

    # Alinear índices
    indices_comunes = df_clima.index.intersection(df_demanda.index)
    clima = df_clima.loc[indices_comunes]
    dem = df_demanda.loc[indices_comunes]

    T = len(clima)
    ghis = clima["ghi_wh_m2"].values
    t2ms = clima["t2m_c"].values
    horas = clima["hora"].values
    epocas = clima["epoca"].values if "epoca" in clima.columns else ["anual"] * T

    col_dem_c = "dem_crit" if "dem_crit" in dem.columns else "demanda_critica_kw"
    col_dem_nc = "dem_nc" if "dem_nc" in dem.columns else "demanda_no_critica_kw"
    dem_crit = dem[col_dem_c].values
    dem_nc = dem[col_dem_nc].values

    # 1. Grilla de discretización del SoC
    grid_soc = np.linspace(SOC_MIN, SOC_MAX, num_niveles_soc)

    # 2. Inducción Hacia Atrás (Backward Induction)
    # Matriz de valor V[t, k]: horizonte T + 1
    # Condición terminal V[T, :] = 0.0
    V = np.zeros((T + 1, num_niveles_soc), dtype=float)

    print(f"Iniciando Inducción Hacia Atrás para T = {T} horas con {num_niveles_soc} niveles de SoC...")
    tiempo_inicio = time.time()

    # Iterar hacia atrás desde T-1 hasta 0
    for t in range(T - 1, -1, -1):
        g = ghis[t]
        temp = t2ms[t]
        dc = dem_crit[t]
        dnc = dem_nc[t]

        V_siguiente = V[t + 1, :]

        # Evaluar las 3 acciones para toda la grilla de SoC simultáneamente usando paso_fisico vectorizado
        # Acción 0: ALMACENAR
        s_next_0, info_0 = paso_fisico(grid_soc, g, temp, dc, dnc, ACCION_ALMACENAR, p_pico, c_nom)
        v_cont_0 = np.interp(s_next_0, grid_soc, V_siguiente)
        q_0 = info_0["recompensa"] + v_cont_0

        # Acción 1: EQUILIBRAR
        s_next_1, info_1 = paso_fisico(grid_soc, g, temp, dc, dnc, ACCION_EQUILIBRAR, p_pico, c_nom)
        v_cont_1 = np.interp(s_next_1, grid_soc, V_siguiente)
        q_1 = info_1["recompensa"] + v_cont_1

        # Acción 2: CONSUMIR
        s_next_2, info_2 = paso_fisico(grid_soc, g, temp, dc, dnc, ACCION_CONSUMIR, p_pico, c_nom)
        v_cont_2 = np.interp(s_next_2, grid_soc, V_siguiente)
        q_2 = info_2["recompensa"] + v_cont_2

        # V[t] = max_a Q(s, a)
        V[t, :] = np.maximum(q_0, np.maximum(q_1, q_2))

    tiempo_induccion = time.time() - tiempo_inicio
    print(f"Inducción hacia atrás completada en {tiempo_induccion:.3f} segundos.")

    # 3. Trayectoria Óptima Hacia Adelante (Forward Rollout)
    # Partiendo del SoC inicial continuo exacto, seleccionamos en cada paso la acción
    # que maximiza Q(soc_actual, a) = R(soc_actual, a) + interp(soc_siguiente, V[t+1])
    secuencia_acciones = np.empty(T, dtype=int)
    soc_arr = np.empty(T, dtype=float)
    fv_kw_arr = np.empty(T, dtype=float)
    fv_dir_arr = np.empty(T, dtype=float)
    serv_c_arr = np.empty(T, dtype=float)
    serv_nc_arr = np.empty(T, dtype=float)
    nosrv_c_arr = np.empty(T, dtype=float)
    nosrv_nc_arr = np.empty(T, dtype=float)
    a_bat_arr = np.empty(T, dtype=float)
    de_bat_arr = np.empty(T, dtype=float)
    vert_arr = np.empty(T, dtype=float)
    rec_arr = np.empty(T, dtype=float)

    soc_actual = float(soc_inicial)

    for t in range(T):
        g = ghis[t]
        temp = t2ms[t]
        dc = dem_crit[t]
        dnc = dem_nc[t]
        V_siguiente = V[t + 1, :]

        # Evaluar las 3 opciones desde el SoC continuo actual
        q_candidatos = np.empty(NUM_ACCIONES, dtype=float)
        infos_candidatos = []
        soc_siguientes = []

        for a in range(NUM_ACCIONES):
            s_sig, inf = paso_fisico(soc_actual, g, temp, dc, dnc, a, p_pico, c_nom)
            v_futuro = float(np.interp(s_sig, grid_soc, V_siguiente))
            q_val = inf["recompensa"] + v_futuro
            q_candidatos[a] = q_val
            infos_candidatos.append(inf)
            soc_siguientes.append(s_sig)

        # Elegir la acción óptima (si hay empates exactos, preferir conservar energía: 0 o 1)
        mejor_accion = int(np.argmax(q_candidatos))
        mejor_info = infos_candidatos[mejor_accion]
        mejor_soc_sig = soc_siguientes[mejor_accion]

        # Guardar en trazas
        secuencia_acciones[t] = mejor_accion
        soc_arr[t] = soc_actual
        fv_kw_arr[t] = mejor_info["fv_kw"]
        fv_dir_arr[t] = mejor_info.get("fv_servido_directo", mejor_info["fv_kw"] - mejor_info["a_bateria"] - mejor_info["vertido"])
        serv_c_arr[t] = mejor_info["servido_crit"]
        serv_nc_arr[t] = mejor_info["servido_nc"]
        nosrv_c_arr[t] = mejor_info["nosrv_crit"]
        nosrv_nc_arr[t] = mejor_info["nosrv_nc"]
        a_bat_arr[t] = mejor_info["a_bateria"]
        de_bat_arr[t] = mejor_info["de_bateria"]
        vert_arr[t] = mejor_info["vertido"]
        rec_arr[t] = mejor_info["recompensa"]

        soc_actual = mejor_soc_sig

    trazas_oracle = pd.DataFrame(
        {
            "hora": horas,
            "soc": soc_arr,
            "accion": secuencia_acciones,
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
    trazas_oracle.index.name = "datetime_local"

    valor_optimo = float(rec_arr.sum())
    return valor_optimo, secuencia_acciones, trazas_oracle, tiempo_induccion


def evaluar_ano_validacion(anio: int = 2022):
    """
    Evalúa y compara exhaustivamente las 3 políticas de línea base frente al Oráculo DP
    sobre el conjunto de datos de validación (2022).
    """
    from baselines import (
        simular_politica_voraz,
        simular_politica_umbral,
        simular_politica_horaria,
    )

    print("=" * 115)
    print(f"EVALUACIÓN COMPARATIVA EN EL AÑO DE VALIDACIÓN ({anio})")
    print("=" * 115)

    df_clima, df_demanda = cargar_datos_evaluacion(anio=anio)
    print(f"Datos cargados para el año {anio}: {len(df_clima)} horas.\n")

    # 1. Simular Voraz
    print("Simulando política 'Voraz' (siempre acción 2)...")
    trazas_voraz = simular_politica_voraz(df_clima, df_demanda)
    m_voraz = metricas(trazas_voraz)

    # 2. Simular Umbral SoC
    print("Simulando política 'Umbral SoC' (regla por tramos de SoC)...")
    trazas_umbral = simular_politica_umbral(df_clima, df_demanda)
    m_umbral = metricas(trazas_umbral)

    # 3. Simular Horaria
    print("Simulando política 'Horaria' (reloj 9-16h, 17-21h, noche)...")
    trazas_horaria = simular_politica_horaria(df_clima, df_demanda)
    m_horaria = metricas(trazas_horaria)

    # 4. Resolver Oráculo DP
    print("\nResolviendo Oráculo DP (Programación Dinámica)...")
    val_opt, acciones_opt, trazas_oracle, t_dp = resolver_oraculo_dp(
        df_clima, df_demanda, num_niveles_soc=33
    )
    m_oracle = metricas(trazas_oracle)

    resumenes = {
        "Voraz": m_voraz,
        "Umbral SoC": m_umbral,
        "Horaria": m_horaria,
        "Oráculo (DP)": m_oracle,
    }

    # Imprimir tabla comparativa global
    imprimir_tabla_metricas(resumenes, titulo=f"COMPARATIVA SOBRE AÑO DE VALIDACIÓN {anio} (HORIZONTE COMPLETO)")

    # Comprobación de que el Oráculo supera o iguala a todas las demás
    r_oracle = m_oracle["recompensa_total"]
    r_voraz = m_voraz["recompensa_total"]
    r_umbral = m_umbral["recompensa_total"]
    r_horaria = m_horaria["recompensa_total"]

    print("VERIFICACIÓN DE CONSISTENCIA DE COTA SUPERIOR:")
    print(f"  * Recompensa Oráculo:   {r_oracle:10.2f}")
    print(f"  * Recompensa Voraz:     {r_voraz:10.2f}  (Diferencia: {r_oracle - r_voraz:+10.2f})")
    print(f"  * Recompensa Umbral:    {r_umbral:10.2f}  (Diferencia: {r_oracle - r_umbral:+10.2f})")
    print(f"  * Recompensa Horaria:   {r_horaria:10.2f}  (Diferencia: {r_oracle - r_horaria:+10.2f})")

    assert r_oracle >= r_voraz - 1e-4, f"ERROR: Oráculo ({r_oracle}) < Voraz ({r_voraz})"
    assert r_oracle >= r_umbral - 1e-4, f"ERROR: Oráculo ({r_oracle}) < Umbral ({r_umbral})"
    assert r_oracle >= r_horaria - 1e-4, f"ERROR: Oráculo ({r_oracle}) < Horaria ({r_horaria})"

    print("\n[OK] El Oráculo DP supera a todas las heurísticas de línea base (cota superior confirmada).")

    # Desglose por épocas climáticas (seca, lluviosa, transicion)
    print("\n" + "=" * 115)
    print(f"{'DESGLOSE POR ÉPOCA CLIMÁTICA EN ' + str(anio):^115}")
    print("=" * 115)
    for epoca_nombre in ["lluviosa", "seca", "transicion"]:
        res_epoca = {
            "Voraz": metricas(trazas_voraz, epoca=epoca_nombre),
            "Umbral SoC": metricas(trazas_umbral, epoca=epoca_nombre),
            "Horaria": metricas(trazas_horaria, epoca=epoca_nombre),
            "Oráculo (DP)": metricas(trazas_oracle, epoca=epoca_nombre),
        }
        imprimir_tabla_metricas(res_epoca, titulo=f"Época: {epoca_nombre.upper()} ({anio})")

    return resumenes


if __name__ == "__main__":
    evaluar_ano_validacion(anio=2022)
