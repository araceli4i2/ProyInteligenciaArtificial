"""
Módulo de Preparación y Validación de Datos Climáticos:
Procesa las series temporales horarias de radiación solar (GHI) y temperatura (T2M)
descargadas desde NASA POWER para La Paz, Bolivia (2015-2024).
"""

import sys
from pathlib import Path
import pandas as pd
import numpy as np

# Importar configuración y parámetros físicos
from config import (
    RUTA_DATOS_BRUTOS,
    DIR_PROCESADOS,
    RUTA_DATOS_PROCESADOS,
    RUTA_RESUMEN_CALIDAD,
    TOTAL_HORAS_ESPERADAS,
    MAX_HORAS_HUECO_INTERPOLAR,
    GHI_MIN_FISICO,
    GHI_MAX_FISICO,
    TEMP_MIN_FISICA,
    TEMP_MAX_FISICA,
    HORAS_NOCHE_LOCAL,
    MESES_SECA,
    MESES_LLUVIOSA,
    MESES_TRANSICION,
)

NOMBRES_MESES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre"
}


def detectar_y_tratar_huecos(serie: pd.Series, max_hueco: int = 3):
    """
    Detecta bloques continuos de valores nulos (NaN).
    Rellena mediante interpolación lineal únicamente los huecos de longitud <= max_hueco.
    Los huecos de longitud mayor se reportan y se mantienen como NaN.
    """
    is_na = serie.isna()
    huecos = []
    
    en_hueco = False
    inicio = None
    conteo = 0
    
    for idx, valor_es_na in is_na.items():
        if valor_es_na:
            if not en_hueco:
                en_hueco = True
                inicio = idx
                conteo = 1
            else:
                conteo += 1
        else:
            if en_hueco:
                huecos.append({"inicio": inicio, "longitud": conteo})
                en_hueco = False
                conteo = 0
    if en_hueco:
        huecos.append({"inicio": inicio, "longitud": conteo})
        
    huecos_cortos = [h for h in huecos if h["longitud"] <= max_hueco]
    huecos_largos = [h for h in huecos if h["longitud"] > max_hueco]
    
    # Si no hay huecos, retornar la serie sin cambios
    if not huecos:
        return serie.copy(), huecos_cortos, huecos_largos
    
    # Realizar interpolación lineal
    serie_interp = serie.interpolate(method="linear")
    
    # Restaurar a NaN los huecos largos (> max_hueco)
    for h in huecos_largos:
        # Encontrar las posiciones de este hueco largo y forzar NaN
        loc_inicio = serie.index.get_loc(h["inicio"])
        loc_fin = loc_inicio + h["longitud"]
        serie_interp.iloc[loc_inicio:loc_fin] = np.nan
        
    return serie_interp, huecos_cortos, huecos_largos


def clasificar_epoca(mes: int) -> str:
    """Clasifica el mes en época climática de La Paz."""
    if mes in MESES_SECA:
        return "seca"
    elif mes in MESES_LLUVIOSA:
        return "lluviosa"
    elif mes in MESES_TRANSICION:
        return "transicion"
    return "desconocida"


def procesar_datos():
    """Función principal de procesamiento y validación de datos."""
    print("=" * 70)
    print("PROCESAMIENTO Y VALIDACIÓN DE DATOS - LA PAZ (NASA POWER 2015-2024)")
    print("=" * 70)
    
    if not RUTA_DATOS_BRUTOS.exists():
        raise FileNotFoundError(f"No se encontró el archivo de datos: {RUTA_DATOS_BRUTOS}")
        
    # 1. Leer CSV y establecer datetime_local como índice horario
    print(f"\n1. Leyendo {RUTA_DATOS_BRUTOS}...")
    df = pd.read_csv(RUTA_DATOS_BRUTOS)
    
    # Convertir a datetime y ordenar
    df["datetime_local"] = pd.to_datetime(df["datetime_local"])
    df.set_index("datetime_local", inplace=True)
    df.sort_index(inplace=True)
    
    # Asegurar tipos numéricos en columnas de datos
    df["ghi_wh_m2"] = pd.to_numeric(df["ghi_wh_m2"], errors="coerce")
    df["t2m_c"] = pd.to_numeric(df["t2m_c"], errors="coerce")
    
    lineas_resumen = []
    lineas_resumen.append("=" * 70)
    lineas_resumen.append("REPORTE DE CALIDAD E INTEGRIDAD DE DATOS - LA PAZ (NASA POWER)")
    lineas_resumen.append("=" * 70)
    lineas_resumen.append(f"Archivo de origen: {RUTA_DATOS_BRUTOS}")
    lineas_resumen.append(f"Rango temporal local: {df.index.min()} a {df.index.max()}")
    
    # 2. Verificación de Integridad
    print("\n2. Verificando integridad del dataset...")
    total_filas = len(df)
    duplicados = df.index.duplicated().sum()
    nulos_ghi_inicial = df["ghi_wh_m2"].isna().sum()
    nulos_t2m_inicial = df["t2m_c"].isna().sum()
    
    print(f"   - Filas totales: {total_filas} (Esperadas: {TOTAL_HORAS_ESPERADAS})")
    print(f"   - Horas duplicadas en índice: {duplicados}")
    print(f"   - Celdas vacías en ghi_wh_m2: {nulos_ghi_inicial}")
    print(f"   - Celdas vacías en t2m_c: {nulos_t2m_inicial}")
    
    lineas_resumen.append(f"Filas totales: {total_filas} (Esperadas: {TOTAL_HORAS_ESPERADAS})")
    lineas_resumen.append(f"Horas duplicadas: {duplicados}")
    lineas_resumen.append(f"Valores faltantes iniciales GHI: {nulos_ghi_inicial}")
    lineas_resumen.append(f"Valores faltantes iniciales T2M: {nulos_t2m_inicial}")
    
    if total_filas != TOTAL_HORAS_ESPERADAS:
        print(f"   [ADVERTENCIA] El número de filas ({total_filas}) difiere de {TOTAL_HORAS_ESPERADAS}.")
    if duplicados > 0:
        print(f"   [ADVERTENCIA] Se encontraron {duplicados} horas duplicadas.")
        
    # Tratamiento de huecos en GHI
    df["ghi_wh_m2"], huecos_c_ghi, huecos_l_ghi = detectar_y_tratar_huecos(
        df["ghi_wh_m2"], max_hueco=MAX_HORAS_HUECO_INTERPOLAR
    )
    # Tratamiento de huecos en T2M
    df["t2m_c"], huecos_c_t2m, huecos_l_t2m = detectar_y_tratar_huecos(
        df["t2m_c"], max_hueco=MAX_HORAS_HUECO_INTERPOLAR
    )
    
    print(f"   - Huecos en GHI interpolados (<= {MAX_HORAS_HUECO_INTERPOLAR}h): {len(huecos_c_ghi)} bloques ({sum(h['longitud'] for h in huecos_c_ghi)} horas)")
    print(f"   - Huecos en GHI no interpolados (> {MAX_HORAS_HUECO_INTERPOLAR}h): {len(huecos_l_ghi)} bloques ({sum(h['longitud'] for h in huecos_l_ghi)} horas)")
    print(f"   - Huecos en T2M interpolados (<= {MAX_HORAS_HUECO_INTERPOLAR}h): {len(huecos_c_t2m)} bloques ({sum(h['longitud'] for h in huecos_c_t2m)} horas)")
    print(f"   - Huecos en T2M no interpolados (> {MAX_HORAS_HUECO_INTERPOLAR}h): {len(huecos_l_t2m)} bloques ({sum(h['longitud'] for h in huecos_l_t2m)} horas)")
    
    lineas_resumen.append(f"Huecos GHI interpolados (<=3h): {len(huecos_c_ghi)} bloques")
    lineas_resumen.append(f"Huecos GHI no interpolados (>3h): {len(huecos_l_ghi)} bloques")
    lineas_resumen.append(f"Huecos T2M interpolados (<=3h): {len(huecos_c_t2m)} bloques")
    lineas_resumen.append(f"Huecos T2M no interpolados (>3h): {len(huecos_l_t2m)} bloques")
    
    if huecos_l_ghi:
        for h in huecos_l_ghi:
            lineas_resumen.append(f"  [GHI HUECO LARGO] Inicio: {h['inicio']} - Duración: {h['longitud']} h")
    if huecos_l_t2m:
        for h in huecos_l_t2m:
            lineas_resumen.append(f"  [T2M HUECO LARGO] Inicio: {h['inicio']} - Duración: {h['longitud']} h")
            
    # 3. Validación Física
    print("\n3. Validando coherencia física de variables...")
    anomalias = []
    
    # 3a. GHI nocturno = 0 (horas 20..23 y 0..5 local)
    noche_mask = df.index.hour.isin(HORAS_NOCHE_LOCAL)
    ghi_noche_anomala = df.loc[noche_mask & (df["ghi_wh_m2"] > 0), "ghi_wh_m2"]
    if len(ghi_noche_anomala) > 0:
        anomalias.append(f"Radiación solar detectada durante la noche (20:00 a 05:00): {len(ghi_noche_anomala)} registros (máx: {ghi_noche_anomala.max()} Wh/m²)")
    else:
        print("   [OK] Radiación estrictamente 0 Wh/m² durante horas nocturnas (20:00-05:00).")
        
    # 3b. GHI negativo
    ghi_negativo = df.loc[df["ghi_wh_m2"] < GHI_MIN_FISICO, "ghi_wh_m2"]
    if len(ghi_negativo) > 0:
        anomalias.append(f"Radiación solar negativa: {len(ghi_negativo)} registros.")
    else:
        print("   [OK] Sin valores negativos de radiación solar.")
        
    # 3c. GHI máximo físico <= 1400 Wh/m²
    ghi_excesivo = df.loc[df["ghi_wh_m2"] > GHI_MAX_FISICO, "ghi_wh_m2"]
    if len(ghi_excesivo) > 0:
        anomalias.append(f"Radiación solar superior al límite físico ({GHI_MAX_FISICO} Wh/m²): {len(ghi_excesivo)} registros.")
    else:
        max_ghi_val = df["ghi_wh_m2"].max()
        print(f"   [OK] Radiación solar máxima registrada: {max_ghi_val:.2f} Wh/m² (<= {GHI_MAX_FISICO} Wh/m²).")
        
    # 3d. Temperatura entre -15 °C y 30 °C
    t_fuera_rango = df.loc[(df["t2m_c"] < TEMP_MIN_FISICA) | (df["t2m_c"] > TEMP_MAX_FISICA), "t2m_c"]
    if len(t_fuera_rango) > 0:
        anomalias.append(f"Temperatura fuera de rango [{TEMP_MIN_FISICA}, {TEMP_MAX_FISICA}] °C: {len(t_fuera_rango)} registros.")
    else:
        t_min = df["t2m_c"].min()
        t_max = df["t2m_c"].max()
        print(f"   [OK] Temperaturas dentro de rango físico: Mínima = {t_min:.2f} °C, Máxima = {t_max:.2f} °C.")
        
    # 3e. Hora del pico solar diario (máximo de radiación por día)
    df_dia = df.groupby(df.index.date)["ghi_wh_m2"].idxmax()
    # idxmax da el timestamp del pico
    horas_pico = pd.Series([ts.hour for ts in df_dia if pd.notna(ts)])
    pico_mediana = horas_pico.median()
    pico_media = horas_pico.mean()
    picos_fuera = horas_pico[(horas_pico < 10) | (horas_pico > 15)]
    print(f"   [OK] Hora del pico solar diario: Mediana = {pico_mediana:.1f}h, Media = {pico_media:.2f}h local.")
    if len(picos_fuera) > 0:
        anomalias.append(f"Días con pico solar antes de las 10:00 o después de las 15:00: {len(picos_fuera)} días (posibles días muy nublados o tormentas vespertinas).")
        
    if anomalias:
        print("\n   --- ANOMALÍAS FÍSICAS REPORTADAS ---")
        for a in anomalias:
            print(f"   * {a}")
            lineas_resumen.append(f"ANOMALIA: {a}")
    else:
        print("   [OK] Todas las validaciones físicas pasaron sin anomalías.")
        lineas_resumen.append("Validaciones físicas: 100% conformes con límites atmosféricos y astronómicos.")
        
    # 4. Agregar columnas de calendario y época
    print("\n4. Agregando columnas temporales y climáticas...")
    df["hora"] = df.index.hour
    df["mes"] = df.index.month
    df["anio"] = df.index.year
    df["dia_del_anio"] = df.index.dayofyear
    df["epoca"] = df["mes"].map(clasificar_epoca)
    print("   Columnas añadidas: hora, mes, anio, dia_del_anio, epoca.")
    
    # 5. Guardar archivos procesados
    print("\n5. Guardando archivos procesados...")
    DIR_PROCESADOS.mkdir(parents=True, exist_ok=True)
    
    # Guardar CSV
    df.to_csv(RUTA_DATOS_PROCESADOS)
    print(f"   -> Dataset procesado guardado en: {RUTA_DATOS_PROCESADOS}")
    
    # 6. Calcular tablas mensuales e irradiación diaria media
    print("\n6. Cálculo de métricas mensuales agregadas:")
    # Irradiación diaria acumulada por día (kWh/m²/día)
    # Se filtran días a partir de 2015 (evitando el día parcial 2014-12-31 que solo contiene 4 horas nocturnas)
    df_dias = df[df["anio"] >= 2015]
    radiacion_diaria = df_dias.groupby([df_dias["anio"], df_dias["mes"], df_dias.index.date])["ghi_wh_m2"].sum() / 1000.0
    radiacion_diaria = radiacion_diaria.reset_index()
    radiacion_diaria.columns = ["anio", "mes", "fecha", "irradiacion_kwh_m2_dia"]
    
    # Promedio por mes calendario
    irrad_mes = radiacion_diaria.groupby("mes")["irradiacion_kwh_m2_dia"].mean()
    temp_mes = df.groupby("mes")["t2m_c"].mean()
    temp_min_mes = df.groupby("mes")["t2m_c"].min()
    temp_max_mes = df.groupby("mes")["t2m_c"].max()
    
    tabla_mensual = pd.DataFrame({
        "Mes": [NOMBRES_MESES[m] for m in range(1, 13)],
        "Epoca": [clasificar_epoca(m) for m in range(1, 13)],
        "Irradiacion_Diaria_kWh_m2_dia": irrad_mes.values,
        "Temp_Media_C": temp_mes.values,
        "Temp_Min_C": temp_min_mes.values,
        "Temp_Max_C": temp_max_mes.values
    }, index=range(1, 13))
    
    # Mostrar tabla formateada
    print("\n" + "=" * 80)
    print("TABLA MENSUAL: IRRADIACIÓN DIARIA MEDIA Y TEMPERATURA MEDIA (LA PAZ)")
    print("=" * 80)
    print(f"{'Mes':<12} {'Época':<12} {'Irradiación (kWh/m²/día)':<26} {'T. Media (°C)':<15} {'T. Mín (°C)':<12} {'T. Máx (°C)':<12}")
    print("-" * 80)
    for idx, row in tabla_mensual.iterrows():
        print(f"{row['Mes']:<12} {row['Epoca']:<12} {row['Irradiacion_Diaria_kWh_m2_dia']:<26.3f} {row['Temp_Media_C']:<15.2f} {row['Temp_Min_C']:<12.2f} {row['Temp_Max_C']:<12.2f}")
    print("-" * 80)
    
    # Irradiación media anual
    irrad_anual_media = irrad_mes.mean()
    temp_anual_media = temp_mes.mean()
    print(f"PROMEDIO ANUAL: {irrad_anual_media:.3f} kWh/m²/día | Temperatura media anual: {temp_anual_media:.2f} °C")
    print("=" * 80)
    
    # Anexar tabla al reporte de calidad
    lineas_resumen.append("\n" + "=" * 70)
    lineas_resumen.append("TABLA DE PROMEDIOS MENSUALES CLIMÁTICOS (2015-2024)")
    lineas_resumen.append("=" * 70)
    lineas_resumen.append(f"{'Mes':<12} {'Época':<12} {'Irradiación (kWh/m²/d)':<22} {'T. Media (°C)':<14} {'T. Mín':<10} {'T. Máx':<10}")
    lineas_resumen.append("-" * 70)
    for idx, row in tabla_mensual.iterrows():
        lineas_resumen.append(
            f"{row['Mes']:<12} {row['Epoca']:<12} {row['Irradiacion_Diaria_kWh_m2_dia']:<22.3f} {row['Temp_Media_C']:<14.2f} {row['Temp_Min_C']:<10.2f} {row['Temp_Max_C']:<10.2f}"
        )
    lineas_resumen.append("-" * 70)
    lineas_resumen.append(f"Promedio anual: {irrad_anual_media:.3f} kWh/m²/día | Temp anual: {temp_anual_media:.2f} °C\n")
    
    with open(RUTA_RESUMEN_CALIDAD, "w", encoding="utf-8") as f:
        f.write("\n".join(lineas_resumen) + "\n")
        
    print(f"\n-> Reporte de calidad guardado en: {RUTA_RESUMEN_CALIDAD}")
    print("\nProcesamiento finalizado con éxito.")
    return df, tabla_mensual


if __name__ == "__main__":
    procesar_datos()
