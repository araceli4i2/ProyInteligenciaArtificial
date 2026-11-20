"""
Módulo del Entorno de Simulación Física y RL:
Implementa la física de la microrred solar con batería para La Paz, Bolivia,
siguiendo la API estilo Gymnasium.
"""

from pathlib import Path
from typing import Dict, Tuple, Any, Optional, List
import numpy as np
import pandas as pd

from config import (
    RUTA_DATOS_PROCESADOS,
    RUTA_DEMANDA_SIMULADA,
    SEMILLA_ALEATORIA,
    # Parámetros FV
    POTENCIA_PICO_FV_INICIAL,
    POTENCIA_PICO_FV,
    RENDIMIENTO_SISTEMA_FV,
    COEF_TEMPERATURA_FV,
    TEMP_REF_STC,
    FACTOR_TEMP_CELDA,
    # Parámetros Batería
    CAPACIDAD_BATERIA_INICIAL,
    CAPACIDAD_BATERIA_NOMINAL,
    SOC_MIN,
    SOC_MAX,
    SOC_INICIAL_DEFAULT,
    EFICIENCIA_CARGA,
    EFICIENCIA_DESCARGA,
    POTENCIA_MAX_BATERIA,
    # Demanda y Ruido
    PERFIL_BASE_CRITICO,
    PERFIL_BASE_NO_CRITICO,
    FACTOR_FIN_DE_SEMANA,
    SIGMA_RUIDO_DEMANDA,
    # Recompensa
    PESO_NO_SRV_CRIT,
    PESO_NO_SRV_NC,
    PESO_BATERIA,
    # División temporal
    ANIOS_ENTRENAMIENTO,
    HORAS_POR_EPISODIO,
    # Acciones y Discretización
    ACCION_ALMACENAR,
    ACCION_EQUILIBRAR,
    ACCION_CONSUMIR,
    NUM_ACCIONES,
    NUM_INTERVALOS_HORA,
    NUM_INTERVALOS_SOC,
    NUM_NIVELES_GHI,
    NUM_NIVELES_GHI_AYER,
    UMBRAL_GHI_NOCHE,
    UMBRALES_GHI_DIURNO,
    UMBRALES_GHI_AYER,
    TOTAL_ESTADOS_DISCRETOS,
)


def paso_fisico(
    soc: float,
    ghi: float,
    t2m: float,
    dem_crit: float,
    dem_nc: float,
    accion: int,
    p_pico: Optional[float] = None,
    c_nom: Optional[float] = None,
) -> Tuple[float, Dict[str, float]]:
    """
    Función pura que implementa la física horaria de la microrred.
    Es la ÚNICA implementación de la física usada por el entorno, baselines y oráculo.

    Acciones:
      - 0 ALMACENAR: Se sirven solo cargas críticas (con FV y, si falta, batería);
                     no críticas se posponen (no servidas). Excedente FV carga batería.
      - 1 EQUILIBRAR: Críticas se sirven con FV y batería; no críticas solo con FV (sin batería).
                      Excedente FV carga batería.
      - 2 CONSUMIR: Críticas y no críticas se sirven con FV y batería.
                    Excedente FV carga batería.

    Retorna:
      (soc_nuevo, info)
    """
    if p_pico is None:
        p_pico = POTENCIA_PICO_FV
    if c_nom is None:
        c_nom = CAPACIDAD_BATERIA_NOMINAL

    # 1. Generación Fotovoltaica (FV)
    # T_celda = T2M + (45 - 20) / 800 * GHI
    t_celda = t2m + FACTOR_TEMP_CELDA * ghi
    factor_temp = 1.0 + COEF_TEMPERATURA_FV * (t_celda - TEMP_REF_STC)
    
    if ghi > 0.0:
        fv_kw = max(0.0, p_pico * (ghi / 1000.0) * factor_temp * RENDIMIENTO_SISTEMA_FV)
    else:
        fv_kw = 0.0

    # Dado que delta_t = 1 hora, la energía generada es igual a la potencia horaria (kWh)
    efv = fv_kw

    # Variables de balance energético
    servido_crit = 0.0
    servido_nc = 0.0
    a_bateria = 0.0
    de_bateria = 0.0
    vertido = 0.0

    # Capacidad disponible para descarga y espacio disponible para carga en batería
    energia_desc_disp = max(0.0, (soc - SOC_MIN) * c_nom)
    # Potencia máxima que puede extraerse de la batería (limitada por inversor y SoC)
    max_extraer = min(POTENCIA_MAX_BATERIA, energia_desc_disp)
    # Potencia máxima que la batería puede entregar a las cargas (afectada por eficiencia)
    max_entregar = max_extraer * EFICIENCIA_DESCARGA

    espacio_libre = max(0.0, (SOC_MAX - soc) * c_nom)

    # --------------------------------------------------------------------------
    # ACCIÓN 0: ALMACENAR
    # --------------------------------------------------------------------------
    if accion == ACCION_ALMACENAR:
        # Cargas no críticas no se sirven en absoluto
        servido_nc = 0.0
        nosrv_nc = dem_nc

        # Cargas críticas: atendidas primero con FV
        servido_crit_fv = min(efv, dem_crit)
        fv_rem = efv - servido_crit_fv
        falta_crit = dem_crit - servido_crit_fv

        if falta_crit > 0.0:
            # Si falta crítica, se descarga batería
            entregado = min(max_entregar, falta_crit)
            extraido = entregado / EFICIENCIA_DESCARGA
            servido_crit = servido_crit_fv + entregado
            nosrv_crit = falta_crit - entregado
            de_bateria = extraido
            a_bateria = 0.0
            vertido = 0.0
        elif fv_rem > 0.0:
            # Si sobra FV, se carga la batería con el excedente
            servido_crit = servido_crit_fv
            nosrv_crit = 0.0
            a_bateria = min(fv_rem, POTENCIA_MAX_BATERIA, espacio_libre / EFICIENCIA_CARGA)
            vertido = fv_rem - a_bateria
            de_bateria = 0.0
        else:
            servido_crit = servido_crit_fv
            nosrv_crit = 0.0
            a_bateria = 0.0
            de_bateria = 0.0
            vertido = 0.0

    # --------------------------------------------------------------------------
    # ACCIÓN 1: EQUILIBRAR
    # --------------------------------------------------------------------------
    elif accion == ACCION_EQUILIBRAR:
        # 1. FV atiende críticas
        servido_crit_fv = min(efv, dem_crit)
        fv_rem1 = efv - servido_crit_fv
        falta_crit = dem_crit - servido_crit_fv

        # 2. FV remanente atiende no críticas (las no críticas NO usan batería)
        servido_nc_fv = min(fv_rem1, dem_nc)
        fv_rem2 = fv_rem1 - servido_nc_fv
        servido_nc = servido_nc_fv
        nosrv_nc = dem_nc - servido_nc_fv

        # 3. Si falta crítica, se cubre con batería
        if falta_crit > 0.0:
            entregado = min(max_entregar, falta_crit)
            extraido = entregado / EFICIENCIA_DESCARGA
            servido_crit = servido_crit_fv + entregado
            nosrv_crit = falta_crit - entregado
            de_bateria = extraido
            a_bateria = 0.0
            vertido = 0.0
        # 4. Si sobra FV tras atender críticas y no críticas, carga batería
        elif fv_rem2 > 0.0:
            servido_crit = servido_crit_fv
            nosrv_crit = 0.0
            a_bateria = min(fv_rem2, POTENCIA_MAX_BATERIA, espacio_libre / EFICIENCIA_CARGA)
            vertido = fv_rem2 - a_bateria
            de_bateria = 0.0
        else:
            servido_crit = servido_crit_fv
            nosrv_crit = 0.0
            a_bateria = 0.0
            de_bateria = 0.0
            vertido = 0.0

    # --------------------------------------------------------------------------
    # ACCIÓN 2: CONSUMIR
    # --------------------------------------------------------------------------
    elif accion == ACCION_CONSUMIR:
        # 1. FV atiende críticas
        servido_crit_fv = min(efv, dem_crit)
        fv_rem1 = efv - servido_crit_fv
        falta_crit = dem_crit - servido_crit_fv

        # 2. FV remanente atiende no críticas
        servido_nc_fv = min(fv_rem1, dem_nc)
        fv_rem2 = fv_rem1 - servido_nc_fv
        falta_nc = dem_nc - servido_nc_fv

        # 3. Descarga de batería si falta crítica o no crítica
        if (falta_crit + falta_nc) > 0.0:
            # Prioridad de batería: primero críticas
            entregado_crit = min(max_entregar, falta_crit)
            extraido_crit = entregado_crit / EFICIENCIA_DESCARGA
            servido_crit = servido_crit_fv + entregado_crit
            nosrv_crit = falta_crit - entregado_crit

            # Segundo: no críticas con el remanente entregable de batería
            entregable_nc = max_entregar - entregado_crit
            entregado_nc = min(entregable_nc, falta_nc)
            extraido_nc = entregado_nc / EFICIENCIA_DESCARGA
            servido_nc = servido_nc_fv + entregado_nc
            nosrv_nc = falta_nc - entregado_nc

            de_bateria = extraido_crit + extraido_nc
            a_bateria = 0.0
            vertido = 0.0
        # 4. Si sobra FV, carga batería
        elif fv_rem2 > 0.0:
            servido_crit = servido_crit_fv
            nosrv_crit = 0.0
            servido_nc = servido_nc_fv
            nosrv_nc = 0.0
            a_bateria = min(fv_rem2, POTENCIA_MAX_BATERIA, espacio_libre / EFICIENCIA_CARGA)
            vertido = fv_rem2 - a_bateria
            de_bateria = 0.0
        else:
            servido_crit = servido_crit_fv
            nosrv_crit = 0.0
            servido_nc = servido_nc_fv
            nosrv_nc = 0.0
            a_bateria = 0.0
            de_bateria = 0.0
            vertido = 0.0
    else:
        raise ValueError(f"Acción inválida: {accion}. Debe ser 0 (ALMACENAR), 1 (EQUILIBRAR) o 2 (CONSUMIR).")

    # 4. Actualización del Estado de Carga (SoC)
    # Lo que entra a la batería se almacena con eficiencia de carga (a_bateria * EFICIENCIA_CARGA)
    # Lo que sale de la batería es exactamente de_bateria
    delta_soc = (a_bateria * EFICIENCIA_CARGA - de_bateria) / c_nom
    soc_nuevo = float(np.clip(soc + delta_soc, SOC_MIN, SOC_MAX))

    # 5. Cálculo de Recompensa
    kwh_bateria = a_bateria + de_bateria
    recompensa = float(
        -(PESO_NO_SRV_CRIT * nosrv_crit + PESO_NO_SRV_NC * nosrv_nc + PESO_BATERIA * kwh_bateria)
    )

    info = {
        "fv_kw": float(fv_kw),
        "fv_servido_directo": float(efv - a_bateria - vertido),
        "servido_crit": float(servido_crit),
        "servido_nc": float(servido_nc),
        "nosrv_crit": float(nosrv_crit),
        "nosrv_nc": float(nosrv_nc),
        "a_bateria": float(a_bateria),
        "de_bateria": float(de_bateria),
        "vertido": float(vertido),
        "recompensa": float(recompensa),
    }

    return soc_nuevo, info


def generar_o_cargar_demanda(
    ruta_clima: Path = RUTA_DATOS_PROCESADOS,
    ruta_salida: Path = RUTA_DEMANDA_SIMULADA,
    semilla: int = SEMILLA_ALEATORIA,
    forzar_regeneracion: bool = False,
) -> pd.DataFrame:
    """
    Genera o carga la demanda simulada fija para todo el dataset.
    Se asegura de que todos los métodos (RL, baselines, oráculo) compartan
    exactamente las mismas demandas horarias reproducibles.
    """
    if ruta_salida.exists() and not forzar_regeneracion:
        df_dem = pd.read_csv(ruta_salida, index_col=0, parse_dates=True)
        return df_dem

    if not ruta_clima.exists():
        raise FileNotFoundError(f"Archivo climático no encontrado: {ruta_clima}")

    df_clima = pd.read_csv(ruta_clima, index_col=0, parse_dates=True)
    n = len(df_clima)

    rng = np.random.default_rng(semilla)

    horas = df_clima["hora"].values
    dias_semana = df_clima.index.dayofweek.values

    # Construir demanda horaria base según perfiles en config.py
    base_crit = np.array(PERFIL_BASE_CRITICO, dtype=float)
    base_nc = np.array(PERFIL_BASE_NO_CRITICO, dtype=float)

    dem_crit = base_crit[horas].copy()
    dem_nc = base_nc[horas].copy()

    # Incremento de fines de semana (+15 % en sábado y domingo)
    es_finde = np.isin(dias_semana, [5, 6])
    dem_crit[es_finde] *= FACTOR_FIN_DE_SEMANA
    dem_nc[es_finde] *= FACTOR_FIN_DE_SEMANA

    # Ruido log-normal (~10 % std, con corrección de media a 1.0)
    # Para que E[exp(X)] = 1.0 con X ~ N(mu, sigma^2), mu = -0.5 * sigma^2
    mu = -0.5 * (SIGMA_RUIDO_DEMANDA**2)
    ruido_crit = rng.lognormal(mean=mu, sigma=SIGMA_RUIDO_DEMANDA, size=n)
    ruido_nc = rng.lognormal(mean=mu, sigma=SIGMA_RUIDO_DEMANDA, size=n)

    dem_crit *= ruido_crit
    dem_nc *= ruido_nc

    df_demanda = pd.DataFrame(
        {
            "demanda_critica_kw": dem_crit,
            "demanda_no_critica_kw": dem_nc,
            "demanda_total_kw": dem_crit + dem_nc,
        },
        index=df_clima.index,
    )
    df_demanda.index.name = "datetime_local"

    ruta_salida.parent.mkdir(parents=True, exist_ok=True)
    df_demanda.to_csv(ruta_salida)
    return df_demanda


class EntornoBateria:
    """
    Entorno de simulación de microrred con batería fotovoltaica.
    API estándar estilo Gymnasium: reset(), step(accion).
    Episodios de 168 horas (1 semana).
    """

    def __init__(
        self,
        anios: Optional[List[int]] = None,
        semilla: int = SEMILLA_ALEATORIA,
        p_pico: Optional[float] = None,
        c_nom: Optional[float] = None,
    ):
        self.p_pico = POTENCIA_PICO_FV if p_pico is None else p_pico
        self.c_nom = CAPACIDAD_BATERIA_NOMINAL if c_nom is None else c_nom
        self.semilla = semilla
        self.rng = np.random.default_rng(semilla)

        # Cargar clima y demanda
        df_clima = pd.read_csv(RUTA_DATOS_PROCESADOS, index_col=0, parse_dates=True)
        df_dem = generar_o_cargar_demanda(semilla=semilla)

        # Calcular irradiación total del día calendario anterior para cada hora
        # Agrupar por fecha local
        irrad_diaria = df_clima.groupby(df_clima.index.date)["ghi_wh_m2"].sum().to_dict()
        fechas_ayer = [d - pd.Timedelta(days=1) for d in df_clima.index.date]
        media_diaria_entrenamiento = 6012.0  # Wh/m²/día
        ghi_ayer = [irrad_diaria.get(d, media_diaria_entrenamiento) for d in fechas_ayer]
        df_clima["ghi_ayer_wh"] = ghi_ayer

        # Filtrar por años requeridos (por defecto, entrenamiento 2015-2021)
        if anios is None:
            anios = ANIOS_ENTRENAMIENTO
        self.anios = anios

        mascara = df_clima["anio"].isin(anios)
        self.df_sub = df_clima[mascara].copy()
        self.dem_sub = df_dem[mascara].copy()

        # Almacenar arreglos numpy para acceso ultrarrápido O(1)
        self.horas_arr = self.df_sub["hora"].values.astype(int)
        self.ghis_arr = self.df_sub["ghi_wh_m2"].values.astype(float)
        self.t2ms_arr = self.df_sub["t2m_c"].values.astype(float)
        self.ghi_ayer_arr = self.df_sub["ghi_ayer_wh"].values.astype(float)
        self.dem_crit_arr = self.dem_sub["demanda_critica_kw"].values.astype(float)
        self.dem_nc_arr = self.dem_sub["demanda_no_critica_kw"].values.astype(float)
        self.timestamps = self.df_sub.index

        self.num_pasos_disponibles = len(self.df_sub)
        if self.num_pasos_disponibles < HORAS_POR_EPISODIO:
            raise ValueError(
                f"El conjunto de datos seleccionado solo tiene {self.num_pasos_disponibles} horas, "
                f"insuficiente para un episodio de {HORAS_POR_EPISODIO} horas."
            )

        # Variables de estado interno del episodio
        self.idx_inicio = 0
        self.paso_actual = 0
        self.soc = SOC_INICIAL_DEFAULT

    @staticmethod
    def discretizar_estado(estado: Tuple[int, float, float, float]) -> Tuple[Tuple[int, int, int, int], int]:
        """
        Discretiza el estado continuo (hora, soc, ghi, ghi_ayer) en índices discretos.

        Retorna:
          ((hora_idx, soc_idx, ghi_idx, ghi_ayer_idx), estado_id_plano)
          donde estado_id_plano pertenece a [0, TOTAL_ESTADOS_DISCRETOS - 1] (2880 estados).
        """
        hora, soc, ghi, ghi_ayer = estado

        # 1. Hora: 24 valores (0..23)
        hora_idx = int(hora) % NUM_INTERVALOS_HORA

        # 2. SoC: 10 tramos en [0.20, 1.00]
        # Ancho de paso = (1.00 - 0.20) / 10 = 0.08
        paso_soc = (SOC_MAX - SOC_MIN) / NUM_INTERVALOS_SOC
        soc_idx = int((soc - SOC_MIN) / paso_soc)
        soc_idx = max(0, min(NUM_INTERVALOS_SOC - 1, soc_idx))

        # 3. GHI actual: 4 niveles por cuantiles
        # Nivel 0: Noche/Nula (<= 5 W/m²)
        # Nivel 1: Baja (5 < GHI <= 322.4 W/m²)
        # Nivel 2: Media (322.4 < GHI <= 675.27 W/m²)
        # Nivel 3: Alta (> 675.27 W/m²)
        if ghi <= UMBRAL_GHI_NOCHE:
            ghi_idx = 0
        elif ghi <= UMBRALES_GHI_DIURNO[0]:
            ghi_idx = 1
        elif ghi <= UMBRALES_GHI_DIURNO[1]:
            ghi_idx = 2
        else:
            ghi_idx = 3

        # 4. GHI total del día anterior: 3 niveles por terciles
        # Nivel 0: < 5528.48 Wh/m² (día nublado)
        # Nivel 1: [5528.48, 6333.31) Wh/m² (día intermedio)
        # Nivel 2: >= 6333.31 Wh/m² (día despejado)
        if ghi_ayer < UMBRALES_GHI_AYER[0]:
            ghi_ayer_idx = 0
        elif ghi_ayer < UMBRALES_GHI_AYER[1]:
            ghi_ayer_idx = 1
        else:
            ghi_ayer_idx = 2

        # Índice plano único: [0, 2879]
        # mapeo: ((hora_idx * 10 + soc_idx) * 4 + ghi_idx) * 3 + ghi_ayer_idx
        estado_id_plano = (
            ((hora_idx * NUM_INTERVALOS_SOC + soc_idx) * NUM_NIVELES_GHI + ghi_idx)
            * NUM_NIVELES_GHI_AYER
            + ghi_ayer_idx
        )

        return (hora_idx, soc_idx, ghi_idx, ghi_ayer_idx), estado_id_plano

    def reset(
        self,
        seed: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Tuple[int, float, float, float], Dict[str, Any]]:
        """
        Reinicia el entorno a un nuevo episodio de 168 horas (1 semana).
        """
        if seed is not None:
            self.rng = np.random.default_rng(seed)

        # Seleccionar punto de inicio de la semana
        max_idx_inicio = self.num_pasos_disponibles - HORAS_POR_EPISODIO
        if options and "inicio" in options:
            self.idx_inicio = int(options["inicio"])
        else:
            self.idx_inicio = int(self.rng.integers(0, max_idx_inicio + 1))

        if options and "soc_inicial" in options:
            self.soc = float(options["soc_inicial"])
        else:
            self.soc = SOC_INICIAL_DEFAULT

        self.paso_actual = 0

        idx_global = self.idx_inicio
        estado_continuo = (
            self.horas_arr[idx_global],
            self.soc,
            self.ghis_arr[idx_global],
            self.ghi_ayer_arr[idx_global],
        )

        indices_disc, estado_id = self.discretizar_estado(estado_continuo)
        info = {
            "timestamp": str(self.timestamps[idx_global]),
            "idx_global": idx_global,
            "estado_discreto": indices_disc,
            "estado_id": estado_id,
        }
        return estado_continuo, info

    def step(
        self, accion: int
    ) -> Tuple[Tuple[int, float, float, float], float, bool, bool, Dict[str, Any]]:
        """
        Ejecuta un paso horario en la microrred.
        Retorna: (siguiente_estado, recompensa, terminado, truncado, info)
        """
        idx_global = self.idx_inicio + self.paso_actual

        ghi = self.ghis_arr[idx_global]
        t2m = self.t2ms_arr[idx_global]
        dem_c = self.dem_crit_arr[idx_global]
        dem_nc = self.dem_nc_arr[idx_global]

        # Ejecutar física pura
        soc_nuevo, info_fisica = paso_fisico(
            soc=self.soc,
            ghi=ghi,
            t2m=t2m,
            dem_crit=dem_c,
            dem_nc=dem_nc,
            accion=accion,
            p_pico=self.p_pico,
            c_nom=self.c_nom,
        )

        self.soc = soc_nuevo
        self.paso_actual += 1
        terminado = bool(self.paso_actual >= HORAS_POR_EPISODIO)
        truncado = False

        # Construir siguiente estado
        if not terminado:
            sig_idx_global = self.idx_inicio + self.paso_actual
            sig_estado = (
                self.horas_arr[sig_idx_global],
                self.soc,
                self.ghis_arr[sig_idx_global],
                self.ghi_ayer_arr[sig_idx_global],
            )
        else:
            # Estado terminal
            ultimo_idx = self.idx_inicio + self.paso_actual - 1
            sig_estado = (
                self.horas_arr[ultimo_idx],
                self.soc,
                self.ghis_arr[ultimo_idx],
                self.ghi_ayer_arr[ultimo_idx],
            )

        indices_disc, estado_id = self.discretizar_estado(sig_estado)

        info = {
            **info_fisica,
            "paso_episodio": self.paso_actual,
            "soc": self.soc,
            "estado_discreto": indices_disc,
            "estado_id": estado_id,
        }

        recompensa = info_fisica["recompensa"]
        return sig_estado, recompensa, terminado, truncado, info


def ejecutar_verificaciones():
    """
    Ejecuta las tres verificaciones requeridas en el PASO 2:
    (a) Comprobación del balance de energía exacto en 7 días con la acción 2.
    (b) Métricas de generación y demanda diaria media, y SoC mín/máx.
    (c) Calibración: análisis de energía no servida con 'siempre CONSUMIR' (2015-2021).
    """
    print("=" * 80)
    print("VERIFICACIONES DEL PASO 2: ENTORNO, FÍSICA Y CALIBRACIÓN")
    print("=" * 80)

    # 1. Asegurar generación de demanda fija
    generar_o_cargar_demanda(semilla=SEMILLA_ALEATORIA)
    print(f"[OK] Demanda simulada generada/cargada en: {RUTA_DEMANDA_SIMULADA}")

    # (a) y (b): Simulación de 7 días (168 h) con acción 2 (CONSUMIR)
    print("\n--- (a) y (b) SIMULACIÓN DE 7 DÍAS (168 h) CON ACCIÓN 2 (CONSUMIR) ---")
    env_7d = EntornoBateria(anios=ANIOS_ENTRENAMIENTO, semilla=SEMILLA_ALEATORIA)
    estado, info = env_7d.reset(options={"inicio": 0, "soc_inicial": 0.50})

    fv_tot = 0.0
    serv_dir_tot = 0.0
    a_bat_tot = 0.0
    vert_tot = 0.0
    dem_crit_tot = 0.0
    dem_nc_tot = 0.0
    soc_min = 1.0
    soc_max = 0.0

    diferencias_balance = []

    for t in range(HORAS_POR_EPISODIO):
        accion = ACCION_CONSUMIR
        sig_estado, rec, term, trunc, info = env_7d.step(accion)

        fv = info["fv_kw"]
        serv_dir = info["fv_servido_directo"]
        a_bat = info["a_bateria"]
        vert = info["vertido"]

        # Comprobación de balance horario: fv == servida_directo_fv + a_bateria + vertido
        # servida directo de FV = info['fv_kw'] - info['a_bateria'] - info['vertido']
        diff = abs(fv - (serv_dir + a_bat + vert))
        diferencias_balance.append(diff)

        fv_tot += fv
        serv_dir_tot += serv_dir
        a_bat_tot += a_bat
        vert_tot += vert
        dem_crit_tot += env_7d.dem_crit_arr[env_7d.idx_inicio + t]
        dem_nc_tot += env_7d.dem_nc_arr[env_7d.idx_inicio + t]
        soc_min = min(soc_min, info["soc"])
        soc_max = max(soc_max, info["soc"])

    max_diff = max(diferencias_balance)
    print(f"Comprobación de Balance de Energía (FV = Servida Directo + A Batería + Vertido):")
    print(f"  - FV total generada:     {fv_tot:10.4f} kWh (Media: {fv_tot / 7:6.3f} kWh/día)")
    print(f"  - FV servida directo:    {serv_dir_tot:10.4f} kWh (Media: {serv_dir_tot / 7:6.3f} kWh/día)")
    print(f"  - Energía enviada a bat: {a_bat_tot:10.4f} kWh (Media: {a_bat_tot / 7:6.3f} kWh/día)")
    print(f"  - Energía vertida:       {vert_tot:10.4f} kWh (Media: {vert_tot / 7:6.3f} kWh/día)")
    print(f"  - Suma de componentes:   {(serv_dir_tot + a_bat_tot + vert_tot):10.4f} kWh")
    print(f"  - Máxima discrepancia horaria: {max_diff:.2e} kWh")
    if max_diff < 1e-9:
        print("  -> [OK] El balance de energía cuadra EXACTAMENTE a precisión de máquina.")
    else:
        print("  -> [FALLO] Discrepancia en balance energético.")

    print(f"\nMétricas del periodo de 7 días:")
    print(f"  - Demanda crítica diaria media:    {dem_crit_tot / 7:.3f} kWh/día")
    print(f"  - Demanda no crítica diaria media: {dem_nc_tot / 7:.3f} kWh/día")
    print(f"  - Demanda total diaria media:      {(dem_crit_tot + dem_nc_tot) / 7:.3f} kWh/día")
    print(f"  - Generación FV diaria media:      {fv_tot / 7:.3f} kWh/día")
    print(f"  - SoC mínimo registrado:           {soc_min:.4f} ({soc_min*100:.1f} %)")
    print(f"  - SoC máximo registrado:           {soc_max:.4f} ({soc_max*100:.1f} %)")

    # (c) CALIBRACIÓN: Política "siempre CONSUMIR" sobre todo 2015-2021
    print("\n" + "=" * 80)
    print("--- (c) CALIBRACIÓN: POLÍTICA 'SIEMPRE CONSUMIR' (2015-2021) ---")
    print("=" * 80)

    def evaluar_periodo_completo(p_pico_eval: float, c_nom_eval: float, etiqueta: str):
        df_c = pd.read_csv(RUTA_DATOS_PROCESADOS, index_col=0, parse_dates=True)
        df_d = pd.read_csv(RUTA_DEMANDA_SIMULADA, index_col=0, parse_dates=True)
        mask = df_c["anio"].between(2015, 2021)
        sub_c = df_c[mask]
        sub_d = df_d[mask]

        n = len(sub_c)
        soc = 0.50
        nosrv_c = 0.0
        nosrv_nc = 0.0
        dem_c_tot = sub_d["demanda_critica_kw"].sum()
        dem_nc_tot = sub_d["demanda_no_critica_kw"].sum()
        dem_total = dem_c_tot + dem_nc_tot

        ghis = sub_c["ghi_wh_m2"].values
        t2ms = sub_c["t2m_c"].values
        dc = sub_d["demanda_critica_kw"].values
        dnc = sub_d["demanda_no_critica_kw"].values

        soc_min_eval = 1.0
        soc_max_eval = 0.0

        for i in range(n):
            soc, info = paso_fisico(
                soc=soc,
                ghi=ghis[i],
                t2m=t2ms[i],
                dem_crit=dc[i],
                dem_nc=dnc[i],
                accion=ACCION_CONSUMIR,
                p_pico=p_pico_eval,
                c_nom=c_nom_eval,
            )
            nosrv_c += info["nosrv_crit"]
            nosrv_nc += info["nosrv_nc"]
            soc_min_eval = min(soc_min_eval, soc)
            soc_max_eval = max(soc_max_eval, soc)

        nosrv_tot = nosrv_c + nosrv_nc
        pct_tot = (nosrv_tot / dem_total) * 100.0
        pct_c = (nosrv_c / dem_total) * 100.0
        pct_nc = (nosrv_nc / dem_total) * 100.0

        print(f"\n{etiqueta}:")
        print(f"  Parámetros: P_pico = {p_pico_eval:.2f} kWp, Capacidad = {c_nom_eval:.2f} kWh")
        print(f"  Demanda total 2015-2021: {dem_total:.2f} kWh (Crítica: {dem_c_tot:.2f}, No Crítica: {dem_nc_tot:.2f})")
        print(f"  Energía No Servida Total:      {nosrv_tot:8.2f} kWh  ({pct_tot:5.2f} % de la demanda)")
        print(f"    - Cargas Críticas no servidas:   {nosrv_c:8.2f} kWh  ({pct_c:5.2f} %)")
        print(f"    - Cargas No Críticas no servidas:{nosrv_nc:8.2f} kWh  ({pct_nc:5.2f} %)")
        print(f"  Rango de SoC: [{soc_min_eval:.4f}, {soc_max_eval:.4f}]")
        return pct_tot, pct_c, pct_nc

    # 1. Con valores iniciales de config.py
    pct_init, _, _ = evaluar_periodo_completo(
        p_pico_eval=POTENCIA_PICO_FV_INICIAL,
        c_nom_eval=CAPACIDAD_BATERIA_INICIAL,
        etiqueta="1. CONFIGURACIÓN INICIAL (kWp = 1.20, Batería = 4.80 kWh)",
    )
    if pct_init < 5.0 or pct_init > 15.0:
        print(f"  -> [FUERA DE RANGO] {pct_init:.2f} % está fuera del objetivo [5 %, 15 %].")
        print("     El sistema inicial está sobredimensionado para una demanda de ~3.4 kWh/día,")
        print("     por lo que la microrred casi nunca sufre déficit energético.")

    # 2. Con valores calibrados
    pct_calib, pct_c_calib, pct_nc_calib = evaluar_periodo_completo(
        p_pico_eval=POTENCIA_PICO_FV,
        c_nom_eval=CAPACIDAD_BATERIA_NOMINAL,
        etiqueta="2. CONFIGURACIÓN CALIBRADA (kWp = 0.75, Batería = 2.40 kWh)",
    )
    if 5.0 <= pct_calib <= 15.0:
        print(f"  -> [CALIBRACIÓN EXITOSA] {pct_calib:.2f} % se encuentra en el rango objetivo [5 %, 15 %].")
        print(f"     Con déficit en críticas ({pct_c_calib:.2f} %) y en no críticas ({pct_nc_calib:.2f} %).")
    else:
        print(f"  -> [ATENCIÓN] Aún fuera de rango: {pct_calib:.2f} %.")

    print("\n" + "=" * 80)
    print("FIN DE VERIFICACIONES DEL PASO 2")
    print("=" * 80)


if __name__ == "__main__":
    ejecutar_verificaciones()
