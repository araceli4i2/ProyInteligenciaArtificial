"""
Módulo de Entrenamiento de Aprendizaje por Refuerzo:
Implementa Q-Learning tabular (desde cero con NumPy) para el control inteligente
de la microrred solar con batería.

Especificación:
- Tabla Q con forma (24, 10, 4, 3, 3) = (hora, SoC, radiación actual, radiación día anterior, acción).
- Episodios = semanas de 168 h elegidas al azar entre 2015 y 2021 (entrenamiento).
- 60 000 episodios, alfa = 0.1, gamma = 0.99.
- Epsilon decayendo linealmente de 1.0 a 0.05 durante el primer 70 % de los episodios.
- Validación cada 500 episodios sobre 2022 completo sin exploración.
- Guarda results/q_table.npy y results/curva_aprendizaje.csv.
"""

import time
from pathlib import Path
from typing import Tuple, Dict, Any, List
import numpy as np
import pandas as pd

from config import (
    SEMILLA_ALEATORIA,
    RUTA_DATOS_PROCESADOS,
    DIR_RESULTADOS,
    HORAS_POR_EPISODIO,
    NUM_ACCIONES,
    NUM_INTERVALOS_HORA,
    NUM_INTERVALOS_SOC,
    NUM_NIVELES_GHI,
    NUM_NIVELES_GHI_AYER,
    SOC_MIN,
    SOC_MAX,
    SOC_INICIAL_DEFAULT,
    POTENCIA_PICO_FV,
    CAPACIDAD_BATERIA_NOMINAL,
    ANIOS_ENTRENAMIENTO,
    ANIOS_VALIDACION,
)
from env import paso_fisico, generar_o_cargar_demanda, EntornoBateria


def discretizar_componentes_estaticos(
    ghis: np.ndarray,
    ghi_ayer: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Precalcula los índices discretos de GHI actual (0..3) y GHI del día anterior (0..2)
    para acelerar el bucle de entrenamiento.
    """
    from config import UMBRAL_GHI_NOCHE, UMBRALES_GHI_DIURNO, UMBRALES_GHI_AYER

    # GHI actual: 4 niveles
    ghi_idx = np.zeros(len(ghis), dtype=np.int32)
    ghi_idx[ghis > UMBRAL_GHI_NOCHE] = 1
    ghi_idx[ghis > UMBRALES_GHI_DIURNO[0]] = 2
    ghi_idx[ghis > UMBRALES_GHI_DIURNO[1]] = 3

    # GHI ayer: 3 niveles
    ghi_ayer_idx = np.zeros(len(ghi_ayer), dtype=np.int32)
    ghi_ayer_idx[ghi_ayer >= UMBRALES_GHI_AYER[0]] = 1
    ghi_ayer_idx[ghi_ayer >= UMBRALES_GHI_AYER[1]] = 2

    return ghi_idx, ghi_ayer_idx


def evaluar_politica_greedy(
    Q: np.ndarray,
    horas_val: np.ndarray,
    ghis_val: np.ndarray,
    t2ms_val: np.ndarray,
    dem_c_val: np.ndarray,
    dem_nc_val: np.ndarray,
    ghi_idx_val: np.ndarray,
    ghi_ayer_idx_val: np.ndarray,
    p_pico: float = POTENCIA_PICO_FV,
    c_nom: float = CAPACIDAD_BATERIA_NOMINAL,
    soc_inicial: float = SOC_INICIAL_DEFAULT,
) -> Tuple[float, float, float]:
    """
    Evalúa la política greedy (sin exploración) sobre el conjunto de validación completo (2022).
    Retorna: (recompensa_total, pct_demanda_critica_cubierta, pct_demanda_total_cubierta)
    """
    n = len(horas_val)
    soc = float(soc_inicial)
    rec_total = 0.0
    nosrv_c_total = 0.0
    nosrv_nc_total = 0.0
    dem_c_total = float(dem_c_val.sum())
    dem_total = dem_c_total + float(dem_nc_val.sum())

    paso_soc_inv = NUM_INTERVALOS_SOC / (SOC_MAX - SOC_MIN)  # 10 / 0.8 = 12.5

    for t in range(n):
        h = horas_val[t]
        # Discretizar SoC
        s_idx = int((soc - SOC_MIN) * paso_soc_inv)
        if s_idx < 0:
            s_idx = 0
        elif s_idx >= NUM_INTERVALOS_SOC:
            s_idx = NUM_INTERVALOS_SOC - 1

        g_idx = ghi_idx_val[t]
        ga_idx = ghi_ayer_idx_val[t]

        # Acción greedy (argmax Q)
        q_acciones = Q[h, s_idx, g_idx, ga_idx]
        mejor_a = int(np.argmax(q_acciones))

        # Paso físico
        soc_nuevo, info = paso_fisico(
            soc=soc,
            ghi=ghis_val[t],
            t2m=t2ms_val[t],
            dem_crit=dem_c_val[t],
            dem_nc=dem_nc_val[t],
            accion=mejor_a,
            p_pico=p_pico,
            c_nom=c_nom,
            retornar_info=True,
        )

        rec_total += info["recompensa"]
        nosrv_c_total += info["nosrv_crit"]
        nosrv_nc_total += info["nosrv_nc"]
        soc = soc_nuevo

    cob_crit = (1.0 - (nosrv_c_total / dem_c_total)) * 100.0 if dem_c_total > 0 else 100.0
    cob_tot = (1.0 - ((nosrv_c_total + nosrv_nc_total) / dem_total)) * 100.0 if dem_total > 0 else 100.0

    return rec_total, cob_crit, cob_tot


def entrenar_q_learning(
    num_episodios: int = 60000,
    alfa: float = 0.1,
    gamma: float = 0.99,
    eps_inicial: float = 1.0,
    eps_final: float = 0.05,
    fraccion_decay: float = 0.70,
    intervalo_evaluacion: int = 500,
    semilla: int = SEMILLA_ALEATORIA,
    p_pico: float = POTENCIA_PICO_FV,
    c_nom: float = CAPACIDAD_BATERIA_NOMINAL,
) -> Tuple[np.ndarray, pd.DataFrame]:
    """
    Entrena el agente Q-learning tabular sobre 2015-2021 y valida periódicamente sobre 2022.
    """
    print("=" * 80)
    print("ENTRENAMIENTO Q-LEARNING TABULAR (GESTIÓN DE MICRORRED SOLAR)")
    print("=" * 80)
    print(f"Semilla aleatoria fija:       {semilla}")
    print(f"Número total de episodios:   {num_episodios:,} (semanas de {HORAS_POR_EPISODIO} h)")
    print(f"Tasa de aprendizaje (alfa):  {alfa}")
    print(f"Factor de descuento (gamma): {gamma}")
    print(f"Epsilon decay:               {eps_inicial} -> {eps_final} en el primer {fraccion_decay*100:.0f} %")
    print(f"Forma de la tabla Q:         ({NUM_INTERVALOS_HORA}, {NUM_INTERVALOS_SOC}, {NUM_NIVELES_GHI}, {NUM_NIVELES_GHI_AYER}, {NUM_ACCIONES})")
    print(f"Total estados discretos:     {NUM_INTERVALOS_HORA * NUM_INTERVALOS_SOC * NUM_NIVELES_GHI * NUM_NIVELES_GHI_AYER} estados")
    print(f"Frecuencia de validación:    Cada {intervalo_evaluacion} episodios sobre 2022 completo")
    print("=" * 80)

    # 1. Cargar datos y precalcular
    df_clima = pd.read_csv(RUTA_DATOS_PROCESADOS, index_col=0, parse_dates=True)
    df_demanda = generar_o_cargar_demanda(semilla=semilla)

    # Calcular GHI total del día anterior
    irrad_diaria = df_clima.groupby(df_clima.index.date)["ghi_wh_m2"].sum().to_dict()
    fechas_ayer = [d - pd.Timedelta(days=1) for d in df_clima.index.date]
    media_diaria = 6012.0
    df_clima["ghi_ayer_wh"] = [irrad_diaria.get(d, media_diaria) for d in fechas_ayer]

    # Separar datos de entrenamiento (2015-2021) y validación (2022)
    mask_train = df_clima["anio"].isin(ANIOS_ENTRENAMIENTO)
    mask_val = df_clima["anio"].isin(ANIOS_VALIDACION)

    clima_train = df_clima[mask_train]
    dem_train = df_demanda[mask_train]
    clima_val = df_clima[mask_val]
    dem_val = df_demanda[mask_val]

    # Arreglos contiguos de entrenamiento
    horas_tr = clima_train["hora"].values.astype(np.int32)
    ghis_tr = clima_train["ghi_wh_m2"].values.astype(np.float64)
    t2ms_tr = clima_train["t2m_c"].values.astype(np.float64)
    ghi_ayer_tr = clima_train["ghi_ayer_wh"].values.astype(np.float64)
    dem_c_tr = dem_train["demanda_critica_kw"].values.astype(np.float64)
    dem_nc_tr = dem_train["demanda_no_critica_kw"].values.astype(np.float64)
    ghi_idx_tr, ghi_ayer_idx_tr = discretizar_componentes_estaticos(ghis_tr, ghi_ayer_tr)

    # Arreglos contiguos de validación (2022)
    horas_val = clima_val["hora"].values.astype(np.int32)
    ghis_val = clima_val["ghi_wh_m2"].values.astype(np.float64)
    t2ms_val = clima_val["t2m_c"].values.astype(np.float64)
    ghi_ayer_val = clima_val["ghi_ayer_wh"].values.astype(np.float64)
    dem_c_val = dem_val["demanda_critica_kw"].values.astype(np.float64)
    dem_nc_val = dem_val["demanda_no_critica_kw"].values.astype(np.float64)
    ghi_idx_val, ghi_ayer_idx_val = discretizar_componentes_estaticos(ghis_val, ghi_ayer_val)

    # Inicializar Tabla Q en ceros: (24, 10, 4, 3, 3)
    Q = np.zeros(
        (NUM_INTERVALOS_HORA, NUM_INTERVALOS_SOC, NUM_NIVELES_GHI, NUM_NIVELES_GHI_AYER, NUM_ACCIONES),
        dtype=np.float64,
    )
    mejor_Q = Q.copy()
    mejor_rec_val = -float("inf")
    mejor_ep = 0

    rng = np.random.default_rng(semilla)
    n_train = len(horas_tr)
    max_inicio_tr = n_train - HORAS_POR_EPISODIO
    paso_soc_inv = NUM_INTERVALOS_SOC / (SOC_MAX - SOC_MIN)  # 12.5

    ep_decay_limite = int(num_episodios * fraccion_decay)

    historial_val: List[Dict[str, Any]] = []

    # Medir tiempo global
    t_inicio = time.time()

    print(f"\nIniciando entrenamiento de {num_episodios:,} episodios...")
    print(f"{'Episodio':<10} {'Epsilon':<9} {'Rec. Val':<12} {'Cob. Crit (%)':<15} {'Cob. Tot (%)':<14} {'Mejor Rec':<12} {'Tiempo (s)':<10}")
    print("-" * 85)

    for ep in range(1, num_episodios + 1):
        # 1. Calcular Epsilon según schedule lineal
        if ep <= ep_decay_limite:
            eps = eps_inicial - (eps_inicial - eps_final) * (ep / ep_decay_limite)
        else:
            eps = eps_final

        # 2. Seleccionar semana aleatoria de 168 h
        idx_inicio = rng.integers(0, max_inicio_tr + 1)
        soc = SOC_INICIAL_DEFAULT

        # Discretizar SoC inicial
        s_idx = int((soc - SOC_MIN) * paso_soc_inv)
        if s_idx < 0:
            s_idx = 0
        elif s_idx >= NUM_INTERVALOS_SOC:
            s_idx = NUM_INTERVALOS_SOC - 1

        # 3. Bucle de 168 horas del episodio
        for paso in range(HORAS_POR_EPISODIO):
            t_curr = idx_inicio + paso
            h = horas_tr[t_curr]
            gi = ghi_idx_tr[t_curr]
            ga = ghi_ayer_idx_tr[t_curr]

            # Selección de acción epsilon-greedy
            if rng.random() < eps:
                a = rng.integers(0, NUM_ACCIONES)
            else:
                q_vals = Q[h, s_idx, gi, ga]
                mejor_a = 0
                max_q = q_vals[0]
                if q_vals[1] > max_q:
                    mejor_a = 1
                    max_q = q_vals[1]
                if q_vals[2] > max_q:
                    mejor_a = 2
                a = mejor_a

            # Ejecutar paso físico puro (retornar_info=False para máxima velocidad)
            soc_sig, r = paso_fisico(
                soc=soc,
                ghi=ghis_tr[t_curr],
                t2m=t2ms_tr[t_curr],
                dem_crit=dem_c_tr[t_curr],
                dem_nc=dem_nc_tr[t_curr],
                accion=a,
                p_pico=p_pico,
                c_nom=c_nom,
                retornar_info=False,
            )

            # Siguiente estado discretizado
            s_next_idx = int((soc_sig - SOC_MIN) * paso_soc_inv)
            if s_next_idx < 0:
                s_next_idx = 0
            elif s_next_idx >= NUM_INTERVALOS_SOC:
                s_next_idx = NUM_INTERVALOS_SOC - 1

            t_next = t_curr + 1
            h_next = horas_tr[t_next]
            gi_next = ghi_idx_tr[t_next]
            ga_next = ghi_ayer_idx_tr[t_next]

            # Actualización Q-Learning: Q(s, a) <- Q(s, a) + alfa * [r + gamma * max_a' Q(s', a') - Q(s, a)]
            q_next_vals = Q[h_next, s_next_idx, gi_next, ga_next]
            # max manual más rápido que np.max
            max_q_next = q_next_vals[0]
            if q_next_vals[1] > max_q_next:
                max_q_next = q_next_vals[1]
            if q_next_vals[2] > max_q_next:
                max_q_next = q_next_vals[2]

            td_target = r + gamma * max_q_next
            td_error = td_target - Q[h, s_idx, gi, ga, a]
            Q[h, s_idx, gi, ga, a] += alfa * td_error

            soc = soc_sig
            s_idx = s_next_idx

        # 4. Evaluación de validación periódica cada 500 episodios
        if ep % intervalo_evaluacion == 0:
            rec_val, cob_crit_val, cob_tot_val = evaluar_politica_greedy(
                Q=Q,
                horas_val=horas_val,
                ghis_val=ghis_val,
                t2ms_val=t2ms_val,
                dem_c_val=dem_c_val,
                dem_nc_val=dem_nc_val,
                ghi_idx_val=ghi_idx_val,
                ghi_ayer_idx_val=ghi_ayer_idx_val,
                p_pico=p_pico,
                c_nom=c_nom,
            )

            # Comprobar si es el mejor modelo hasta el momento
            es_nuevo_mejor = rec_val > mejor_rec_val
            if es_nuevo_mejor:
                mejor_rec_val = rec_val
                mejor_Q = Q.copy()
                mejor_ep = ep

            t_transcurrido = time.time() - t_inicio
            historial_val.append(
                {
                    "episodio": ep,
                    "epsilon": eps,
                    "recompensa_val": rec_val,
                    "cob_critica_val": cob_crit_val,
                    "cob_total_val": cob_tot_val,
                    "tiempo_acumulado_s": t_transcurrido,
                }
            )

            # Imprimir progreso cada 5000 episodios o si es el primer intervalo
            if ep % 5000 == 0 or ep == intervalo_evaluacion:
                estrella = " *" if es_nuevo_mejor else ""
                print(
                    f"{ep:<10} "
                    f"{eps:<9.3f} "
                    f"{rec_val:<12.2f} "
                    f"{cob_crit_val:<15.2f} "
                    f"{cob_tot_val:<14.2f} "
                    f"{mejor_rec_val:<12.2f} "
                    f"{t_transcurrido:<10.1f}{estrella}"
                )

    tiempo_total = time.time() - t_inicio
    print("-" * 85)
    print(f"Entrenamiento completado en {tiempo_total:.2f} s ({tiempo_total/60:.2f} min).")
    print(f"Mejor Recompensa en Validación: {mejor_rec_val:.2f} (obtenida en el episodio {mejor_ep}).")

    # 5. Guardar artefactos
    DIR_RESULTADOS.mkdir(parents=True, exist_ok=True)
    ruta_q_table = DIR_RESULTADOS / "q_table.npy"
    ruta_curva = DIR_RESULTADOS / "curva_aprendizaje.csv"

    np.save(ruta_q_table, mejor_Q)
    df_curva = pd.DataFrame(historial_val)
    df_curva.to_csv(ruta_curva, index=False)

    print(f"[OK] Mejor tabla Q guardada en: {ruta_q_table}")
    print(f"[OK] Curva de aprendizaje guardada en: {ruta_curva}")

    return mejor_Q, df_curva


if __name__ == "__main__":
    entrenar_q_learning()
