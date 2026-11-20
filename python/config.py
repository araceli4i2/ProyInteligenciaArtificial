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
RUTA_DEMANDA_SIMULADA = DIR_PROCESADOS / "demanda_simulada.csv"
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

# ==============================================================================
# SISTEMA FOTOVOLTAICO (FV)
# ==============================================================================
# Valores iniciales según especificación:
POTENCIA_PICO_FV_INICIAL = 1.2   # kWp

# Valor calibrado para que con "siempre CONSUMIR" (2015-2021) la energía no servida
# se ubique en [5%, 15%] de la demanda total (resultando ~8.30% con batería de 2.4 kWh):
POTENCIA_PICO_FV = 0.75          # kWp (ajuste calibrado)

RENDIMIENTO_SISTEMA_FV = 0.80    # Performance Ratio (PR: pérdidas en inversor, cables, suciedad)
COEF_TEMPERATURA_FV = -0.004     # Variación de potencia por °C respecto a 25 °C (-0.4 %/°C)
TEMP_REF_STC = 25.0              # Temperatura de referencia de panel (°C)
TEMP_NOCT = 45.0                 # Temperatura de operación nominal de célula (°C)
TEMP_AMB_NOCT = 20.0             # Temperatura ambiente en NOCT (°C)
IRRAD_NOCT = 800.0               # Radiación en NOCT (W/m²)
FACTOR_TEMP_CELDA = (TEMP_NOCT - TEMP_AMB_NOCT) / IRRAD_NOCT  # (45 - 20) / 800 = 0.03125

# ==============================================================================
# SISTEMA DE BATERÍA DE ALMACENAMIENTO
# ==============================================================================
# Valores iniciales según especificación:
CAPACIDAD_BATERIA_INICIAL = 4.8  # kWh nominales

# Capacidad calibrada para el tamaño rural de micro-red (módulo estándar 24V 100Ah):
CAPACIDAD_BATERIA_NOMINAL = 2.4  # kWh nominales (ajuste calibrado)

SOC_MIN = 0.20                   # Estado de carga mínimo admisible (20 %)
SOC_MAX = 1.00                   # Estado de carga máximo admisible (100 %)
SOC_INICIAL_DEFAULT = 0.50       # SoC inicial por defecto al reiniciar episodio (50 %)
EFICIENCIA_CARGA = 0.95          # Rendimiento culómbico / energético de carga
EFICIENCIA_DESCARGA = 0.95       # Rendimiento culómbico / energético de descarga
POTENCIA_MAX_BATERIA = 2.0       # Potencia máxima de carga/descarga (kW)
DELTA_T_HORAS = 1.0              # Paso de tiempo de simulación (1 hora)

# ==============================================================================
# SIMULACIÓN DE DEMANDA ELÉCTRICA
# ==============================================================================
# Demandas diarias objetivo:
DEMANDA_CRITICA_DIARIA_OBJETIVO = 1.6     # kWh/día (refrigeración, iluminación, comunicaciones)
DEMANDA_NO_CRITICA_DIARIA_OBJETIVO = 1.8  # kWh/día (bomba de agua, artefactos domésticos)

# Factor de incremento para fines de semana (sábado y domingo):
FACTOR_FIN_DE_SEMANA = 1.15               # +15 % los fines de semana
SIGMA_RUIDO_DEMANDA = 0.10                # Desviación estándar del ruido log-normal (~10 %)

# Perfil horario base (24 horas) para cargas críticas (kW por hora):
# Refrigeración continua baja de 0.04 kW + picos 6-8 h (+0.08 kW) y 18-22 h (+0.12 kW)
PERFIL_BASE_CRITICO = [
    0.04, 0.04, 0.04, 0.04, 0.04, 0.04,  # 00:00 - 05:00
    0.12, 0.12,                          # 06:00 - 07:00 (pico matutino)
    0.04, 0.04, 0.04, 0.04, 0.04, 0.04,  # 08:00 - 13:00
    0.04, 0.04, 0.04, 0.04,              # 14:00 - 17:00
    0.16, 0.16, 0.16, 0.16,              # 18:00 - 21:00 (pico nocturno)
    0.04, 0.04                           # 22:00 - 23:00
]  # Suma base = 1.60 kWh/día

# Perfil horario base (24 horas) para cargas no críticas (kW por hora):
# Artefactos mínimos de noche (0.01 kW), bomba/artefactos de 09-17 h (0.13 kW) y 18-21 h (0.13 kW)
PERFIL_BASE_NO_CRITICO = [
    0.01, 0.01, 0.01, 0.01, 0.01, 0.01,  # 00:00 - 05:00
    0.01, 0.01, 0.01,                    # 06:00 - 08:00
    0.13, 0.13, 0.13, 0.13, 0.13, 0.13,  # 09:00 - 14:00 (bomba y artefactos)
    0.13, 0.13, 0.13,                    # 15:00 - 17:00
    0.13, 0.13, 0.13, 0.13,              # 18:00 - 21:00 (artefactos nocturnos)
    0.01, 0.01                           # 22:00 - 23:00
]  # Suma base = 1.80 kWh/día

# ==============================================================================
# FUNCIÓN DE RECOMPENSA (RL)
# ==============================================================================
# Recompensa = -(PESO_NO_SRV_CRIT * nosrv_crit + PESO_NO_SRV_NC * nosrv_nc + PESO_BATERIA * kwh_bateria)
PESO_NO_SRV_CRIT = 10.0   # Penalización severa por kWh crítico no suministrado
PESO_NO_SRV_NC = 1.0     # Penalización moderada por kWh no crítico no suministrado
PESO_BATERIA = 0.1       # Penalización por degradación/ciclado por cada kWh que pasa por la batería

# ==============================================================================
# DIVISIÓN TEMPORAL DEL DATASET
# ==============================================================================
ANIOS_ENTRENAMIENTO = list(range(2015, 2022))  # 2015 a 2021 (7 años)
ANIOS_VALIDACION = [2022]                     # 2022 (1 año)
ANIOS_PRUEBA = [2023, 2024]                   # 2023 a 2024 (2 años)

# ==============================================================================
# ACCIONES DEL ENTORNO
# ==============================================================================
ACCION_ALMACENAR = 0   # Modo conservación: atiende solo crítico, no crítico no servido
ACCION_EQUILIBRAR = 1  # Modo balanceado: crítico con FV+bat; no crítico solo con FV
ACCION_CONSUMIR = 2    # Modo consumo total: crítico y no crítico con FV y batería
NUM_ACCIONES = 3
NOMBRES_ACCIONES = {
    0: "ALMACENAR",
    1: "EQUILIBRAR",
    2: "CONSUMIR"
}

# ==============================================================================
# DISCRETIZACIÓN DEL ESPACIO DE ESTADOS
# Estado = (hora, SoC, GHI actual, GHI total del día anterior)
# ==============================================================================
HORAS_POR_EPISODIO = 168   # 7 días * 24 horas por episodio

NUM_INTERVALOS_HORA = 24   # 0 a 23
NUM_INTERVALOS_SOC = 10    # 10 tramos en [SOC_MIN, SOC_MAX] -> paso de 0.08
NUM_NIVELES_GHI = 4        # 4 niveles: Noche/nula (<=5 W/m²) + 3 terciles diurnos
NUM_NIVELES_GHI_AYER = 3   # 3 niveles por terciles de radiación diaria previa

# Umbrales calculados exclusivamente sobre el periodo de entrenamiento (2015-2021):
UMBRAL_GHI_NOCHE = 5.0                # Wh/m² (por debajo se clasifica como noche/nula)
UMBRALES_GHI_DIURNO = [322.40, 675.27] # Terciles diurnos (Wh/m²): nivel 1, 2, 3
UMBRALES_GHI_AYER = [5528.48, 6333.31] # Terciles diarios (Wh/m²/día): nivel 0, 1, 2

# Espacio discreto total: 24 * 10 * 4 * 3 = 2880 estados posibles
TOTAL_ESTADOS_DISCRETOS = (
    NUM_INTERVALOS_HORA * NUM_INTERVALOS_SOC * NUM_NIVELES_GHI * NUM_NIVELES_GHI_AYER
)
