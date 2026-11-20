"""
Módulo de Políticas de Línea Base (Baselines Heurísticos):
Implementa las tres estrategias de control tradicionales para la microrred:
1. Voraz (Greedy): Siempre acción 2 (CONSUMIR).
2. Umbral de SoC: Regla basada en reservas de batería (CONSUMIR si SoC > 60 %,
   EQUILIBRAR si 40-60 %, ALMACENAR si < 40 %).
3. Horaria (Time-of-day): Control por reloj (CONSUMIR 9-16 h, EQUILIBRAR 17-21 h,
   ALMACENAR resto del día).

Todas las políticas utilizan estrictamente paso_fisico de env.py.
"""

from typing import Callable, Optional, Dict, Tuple
import pandas as pd
import numpy as np

from config import (
    RUTA_DATOS_PROCESADOS,
    RUTA_DEMANDA_SIMULADA,
    ACCION_ALMACENAR,
    ACCION_EQUILIBRAR,
    ACCION_CONSUMIR,
    SOC_INICIAL_DEFAULT,
    POTENCIA_PICO_FV,
    CAPACIDAD_BATERIA_NOMINAL,
)
from env import paso_fisico, generar_o_cargar_demanda


def simular_politica(
    df_clima: pd.DataFrame,
    df_demanda: pd.DataFrame,
    regla_accion: Callable[[float, int, float, float, float, float], int],
    nombre_politica: str = "politica",
    p_pico: Optional[float] = None,
    c_nom: Optional[float] = None,
    soc_inicial: float = SOC_INICIAL_DEFAULT,
) -> pd.DataFrame:
    """
    Simula una política horaria paso a paso sobre el dataset climático y de demanda proporcionado.
    Utiliza paso_fisico de env.py en cada hora.

    Parámetros:
      - df_clima: DataFrame climático (debe contener 'ghi_wh_m2', 't2m_c', 'hora', 'epoca').
      - df_demanda: DataFrame con 'demanda_critica_kw' y 'demanda_no_critica_kw'.
      - regla_accion: Función (soc, hora, ghi, t2m, dem_crit, dem_nc) -> accion (0, 1 o 2).
      - p_pico, c_nom: Parámetros físicos opcionales (por defecto usa config.py).
      - soc_inicial: Estado de carga inicial (default 0.50).

    Retorna:
      DataFrame de trazas horarias con todas las variables de simulación.
    """
    if p_pico is None:
        p_pico = POTENCIA_PICO_FV
    if c_nom is None:
        c_nom = CAPACIDAD_BATERIA_NOMINAL

    # Asegurar alineación temporal
    indices_comunes = df_clima.index.intersection(df_demanda.index)
    clima = df_clima.loc[indices_comunes]
    dem = df_demanda.loc[indices_comunes]

    n = len(clima)
    ghis = clima["ghi_wh_m2"].values
    t2ms = clima["t2m_c"].values
    horas = clima["hora"].values
    epocas = clima["epoca"].values if "epoca" in clima.columns else ["anual"] * n

    col_dem_c = "dem_crit" if "dem_crit" in dem.columns else "demanda_critica_kw"
    col_dem_nc = "dem_nc" if "dem_nc" in dem.columns else "demanda_no_critica_kw"
    dem_crit = dem[col_dem_c].values
    dem_nc = dem[col_dem_nc].values

    # Listas para almacenar trazas horarias
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
        g = ghis[t]
        temp = t2ms[t]
        h = int(horas[t])
        dc = dem_crit[t]
        dnc = dem_nc[t]

        # 1. Determinar acción según la política
        accion = int(regla_accion(soc_actual, h, g, temp, dc, dnc))

        # 2. Ejecutar física pura
        soc_nuevo, info = paso_fisico(
            soc=soc_actual,
            ghi=g,
            t2m=temp,
            dem_crit=dc,
            dem_nc=dnc,
            accion=accion,
            p_pico=p_pico,
            c_nom=c_nom,
        )

        # 3. Guardar registro horario
        soc_arr[t] = soc_actual
        accion_arr[t] = accion
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


# ------------------------------------------------------------------------------
# 1. POLÍTICA VORAZ (GREEDY)
# ------------------------------------------------------------------------------
def simular_politica_voraz(
    df_clima: pd.DataFrame,
    df_demanda: pd.DataFrame,
    p_pico: Optional[float] = None,
    c_nom: Optional[float] = None,
    soc_inicial: float = SOC_INICIAL_DEFAULT,
) -> pd.DataFrame:
    """Política Voraz: siempre utiliza la acción 2 (CONSUMIR)."""
    return simular_politica(
        df_clima=df_clima,
        df_demanda=df_demanda,
        regla_accion=lambda soc, h, g, temp, dc, dnc: ACCION_CONSUMIR,
        nombre_politica="Voraz",
        p_pico=p_pico,
        c_nom=c_nom,
        soc_inicial=soc_inicial,
    )


# ------------------------------------------------------------------------------
# 2. POLÍTICA UMBRAL DE SOC
# ------------------------------------------------------------------------------
def simular_politica_umbral(
    df_clima: pd.DataFrame,
    df_demanda: pd.DataFrame,
    p_pico: Optional[float] = None,
    c_nom: Optional[float] = None,
    soc_inicial: float = SOC_INICIAL_DEFAULT,
    umbral_alto: float = 0.60,
    umbral_bajo: float = 0.40,
) -> pd.DataFrame:
    """
    Política Umbral SoC:
      - CONSUMIR (2) si SoC > 60 %
      - EQUILIBRAR (1) si 40 % <= SoC <= 60 %
      - ALMACENAR (0) si SoC < 40 %
    """
    def regla(soc, h, g, temp, dc, dnc):
        if soc > umbral_alto:
            return ACCION_CONSUMIR
        elif soc >= umbral_bajo:
            return ACCION_EQUILIBRAR
        else:
            return ACCION_ALMACENAR

    return simular_politica(
        df_clima=df_clima,
        df_demanda=df_demanda,
        regla_accion=regla,
        nombre_politica="Umbral SoC",
        p_pico=p_pico,
        c_nom=c_nom,
        soc_inicial=soc_inicial,
    )


# ------------------------------------------------------------------------------
# 3. POLÍTICA HORARIA (TIME-OF-DAY)
# ------------------------------------------------------------------------------
def simular_politica_horaria(
    df_clima: pd.DataFrame,
    df_demanda: pd.DataFrame,
    p_pico: Optional[float] = None,
    c_nom: Optional[float] = None,
    soc_inicial: float = SOC_INICIAL_DEFAULT,
) -> pd.DataFrame:
    """
    Política Horaria:
      - CONSUMIR (2) de 9 a 16 h (horas 9 a 16 inclusive)
      - EQUILIBRAR (1) de 17 a 21 h (horas 17 a 21 inclusive)
      - ALMACENAR (0) el resto del día (22 a 08 h)
    """
    def regla(soc, h, g, temp, dc, dnc):
        if 9 <= h <= 16:
            return ACCION_CONSUMIR
        elif 17 <= h <= 21:
            return ACCION_EQUILIBRAR
        else:
            return ACCION_ALMACENAR

    return simular_politica(
        df_clima=df_clima,
        df_demanda=df_demanda,
        regla_accion=regla,
        nombre_politica="Horaria",
        p_pico=p_pico,
        c_nom=c_nom,
        soc_inicial=soc_inicial,
    )


def cargar_datos_evaluacion(anio: int = 2022) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Carga y filtra el clima y demanda para un año específico (por defecto 2022)."""
    df_clima = pd.read_csv(RUTA_DATOS_PROCESADOS, index_col=0, parse_dates=True)
    df_demanda = generar_o_cargar_demanda()

    mask = df_clima["anio"] == anio
    return df_clima[mask].copy(), df_demanda[mask].copy()
