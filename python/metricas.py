"""
Módulo de Métricas de Evaluación Energética y Económica:
Calcula indicadores de desempeño de la microrred solar a partir de las trazas horarias
de simulación (coberturas de demanda, energía no servida, ciclado de batería, vertidos y recompensas).
"""

from typing import Dict, Optional, Any
import pandas as pd
import numpy as np

from config import (
    SOC_MIN,
    SOC_MAX,
    CAPACIDAD_BATERIA_NOMINAL,
)


def metricas(
    trazas: pd.DataFrame,
    epoca: Optional[str] = None,
    capacidad_util: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Calcula el resumen de métricas energéticas y de recompensa sobre las trazas horarias.

    Parámetros:
      - trazas: DataFrame con columnas horarias:
          'dem_crit' (o 'demanda_critica_kw'), 'dem_nc' (o 'demanda_no_critica_kw'),
          'servido_crit', 'servido_nc', 'nosrv_crit', 'nosrv_nc',
          'a_bateria', 'de_bateria', 'vertido', 'recompensa', y opcionalmente 'epoca'.
      - epoca: Filtro opcional ('seca', 'lluviosa', 'transicion').
      - capacidad_util: Capacidad útil de la batería en kWh para el cálculo de ciclos
                        equivalentes. Por defecto usa (SOC_MAX - SOC_MIN) * CAPACIDAD_BATERIA_NOMINAL.

    Retorna:
      Diccionario con las métricas calculadas.
    """
    df = trazas.copy()

    # Filtrar por época si se solicita
    if epoca is not None:
        if "epoca" not in df.columns:
            # Si no está en columnas pero el índice es DatetimeIndex, intentar deducir época
            meses = df.index.month
            from config import MESES_SECA, MESES_LLUVIOSA, MESES_TRANSICION
            def clasif(m):
                if m in MESES_SECA: return "seca"
                if m in MESES_LLUVIOSA: return "lluviosa"
                if m in MESES_TRANSICION: return "transicion"
                return "desconocida"
            df["epoca"] = [clasif(m) for m in meses]
            
        df = df[df["epoca"] == epoca].copy()
        if len(df) == 0:
            raise ValueError(f"No se encontraron registros para la época '{epoca}'.")

    # Identificar nombres de columnas compatibles
    col_dem_c = "dem_crit" if "dem_crit" in df.columns else "demanda_critica_kw"
    col_dem_nc = "dem_nc" if "dem_nc" in df.columns else "demanda_no_critica_kw"

    dem_crit_tot = float(df[col_dem_c].sum())
    dem_nc_tot = float(df[col_dem_nc].sum())
    dem_total = dem_crit_tot + dem_nc_tot

    nosrv_crit_tot = float(df["nosrv_crit"].sum())
    nosrv_nc_tot = float(df["nosrv_nc"].sum())
    nosrv_total = nosrv_crit_tot + nosrv_nc_tot

    # Coberturas porcentuales de demanda
    pct_crit_cubierta = (1.0 - (nosrv_crit_tot / dem_crit_tot)) * 100.0 if dem_crit_tot > 0 else 100.0
    pct_nc_cubierta = (1.0 - (nosrv_nc_tot / dem_nc_tot)) * 100.0 if dem_nc_tot > 0 else 100.0
    pct_total_cubierta = (1.0 - (nosrv_total / dem_total)) * 100.0 if dem_total > 0 else 100.0

    # Batería y ciclos equivalentes
    # kWh descargados totales de la batería
    kwh_descargados = float(df["de_bateria"].sum())
    
    # Capacidad útil: si no se especifica, se calcula desde config (ej. (1.0 - 0.2) * 2.4 = 1.92 kWh)
    # También se calcula con la referencia nominal de 3.84 kWh útiles (especificada en el enunciado)
    if capacidad_util is None:
        capacidad_util = (SOC_MAX - SOC_MIN) * CAPACIDAD_BATERIA_NOMINAL

    ciclos_equivalentes = kwh_descargados / capacidad_util if capacidad_util > 0 else 0.0
    ciclos_equivalentes_384 = kwh_descargados / 3.84  # Referencia exacta de la consigna

    # Vertido FV
    vertido_tot = float(df["vertido"].sum())

    # Recompensa acumulada
    recompensa_tot = float(df["recompensa"].sum())

    # Generación FV y flujo a batería (métricas de soporte adicionales)
    fv_tot = float(df["fv_kw"].sum()) if "fv_kw" in df.columns else 0.0
    kwh_a_bateria = float(df["a_bateria"].sum())

    resumen = {
        "epoca": epoca if epoca is not None else "anual",
        "horas_evaluadas": len(df),
        "demanda_total_kwh": dem_total,
        "demanda_critica_kwh": dem_crit_tot,
        "demanda_no_critica_kwh": dem_nc_tot,
        # Indicadores principales solicitados:
        "pct_critica_cubierta": pct_crit_cubierta,
        "pct_no_critica_cubierta": pct_nc_cubierta,
        "pct_total_cubierta": pct_total_cubierta,
        "nosrv_crit_kwh": nosrv_crit_tot,
        "nosrv_nc_kwh": nosrv_nc_tot,
        "nosrv_total_kwh": nosrv_total,
        "ciclos_equivalentes": ciclos_equivalentes,
        "ciclos_equivalentes_384": ciclos_equivalentes_384,
        "kwh_descargados_bateria": kwh_descargados,
        "kwh_cargados_bateria": kwh_a_bateria,
        "vertido_fv_kwh": vertido_tot,
        "fv_total_kwh": fv_tot,
        "recompensa_total": recompensa_tot,
    }

    return resumen


def imprimir_tabla_metricas(resumenes: Dict[str, Dict[str, Any]], titulo: str = "COMPARATIVA DE POLÍTICAS"):
    """
    Imprime una tabla comparativa formateada en consola con las métricas de varias políticas.
    """
    print("\n" + "=" * 115)
    print(f"{titulo:^115}")
    print("=" * 115)
    header = (
        f"{'Política':<16} "
        f"{'Cob. Tot (%)':<14} "
        f"{'Cob. Crit (%)':<14} "
        f"{'Cob. NC (%)':<13} "
        f"{'No Serv (kWh)':<15} "
        f"{'Ciclos Bat':<12} "
        f"{'Vertido (kWh)':<15} "
        f"{'Recompensa':<14}"
    )
    print(header)
    print("-" * 115)
    for nombre, m in resumenes.items():
        fila = (
            f"{nombre:<16} "
            f"{m['pct_total_cubierta']:<14.2f} "
            f"{m['pct_critica_cubierta']:<14.2f} "
            f"{m['pct_no_critica_cubierta']:<13.2f} "
            f"{m['nosrv_total_kwh']:<15.2f} "
            f"{m['ciclos_equivalentes']:<12.1f} "
            f"{m['vertido_fv_kwh']:<15.2f} "
            f"{m['recompensa_total']:<14.2f}"
        )
        print(fila)
    print("=" * 115 + "\n")
