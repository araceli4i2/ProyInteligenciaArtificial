"""
Módulo de Configuración Global del Proyecto:
Gestión inteligente de baterías solares (microrred) con Aprendizaje por Refuerzo.
Ubicación de referencia: La Paz, Bolivia (~3600 msnm, latitud -16.5, longitud -68.15, UTC-4).
"""

from pathlib import Path

# ==============================================================================
# REPRODUCIBILIDAD
# ==============================================================================
SEMILLA_ALEATORIA = 42

# ==============================================================================
# RUTAS DE ARCHIVOS Y CARPETAS
# ==============================================================================
DIR_BASE = Path(__file__).resolve().parent.parent

RUTA_DATOS_BRUTOS = DIR_BASE / "data" / "nasa_power_lapaz_hourly.csv"
DIR_PROCESADOS = DIR_BASE / "data" / "processed"
RUTA_DATOS_PROCESADOS = DIR_PROCESADOS / "clima_horario.csv"
RUTA_RESUMEN_CALIDAD = DIR_PROCESADOS / "resumen_calidad.txt"

DIR_RESULTADOS = DIR_BASE / "results"
DIR_WEB_DATOS = DIR_BASE / "web" / "data"

# ==============================================================================
# PARÁMETROS DE VALIDACIÓN E INTEGRIDAD DE DATOS (NASA POWER)
# ==============================================================================
TOTAL_HORAS_ESPERADAS = 87672  # 10 años (2015-2024 en UTC): 3653 días * 24 h
MAX_HORAS_HUECO_INTERPOLAR = 3  # Huecos <= 3 h se interpolan linealmente

# Umbrales físicos de radiación y temperatura para La Paz
GHI_MIN_FISICO = 0.0      # Wh/m²
GHI_MAX_FISICO = 1400.0   # Wh/m² (constante solar ~1361 W/m² con efecto de altitud y nubes)
TEMP_MIN_FISICA = -15.0   # °C
TEMP_MAX_FISICA = 30.0    # °C

# Horas nocturnas locales en La Paz donde la radiación debe ser estrictamente 0
HORAS_NOCHE_LOCAL = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5]

# Definición de épocas climáticas según el calendario estacional de La Paz
MESES_SECA = {5, 6, 7, 8, 9}       # Mayo a septiembre (invierno seco y despejado)
MESES_LLUVIOSA = {11, 12, 1, 2, 3} # Noviembre a marzo (verano lluvioso y nublado)
MESES_TRANSICION = {4, 10}         # Abril y octubre
