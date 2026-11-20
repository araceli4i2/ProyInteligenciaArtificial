# Gestión Inteligente de Baterías Solares con Aprendizaje por Refuerzo (RL)
### Microrred Fotovoltaica Aislada en el Altiplano de La Paz, Bolivia

Este proyecto implementa y evalúa un sistema autónomo de gestión energética para una microrred solar aislada en el Altiplano boliviano (La Paz, -16.50°S, -68.15°W, ~3,600 msnm) mediante **Aprendizaje por Refuerzo Tabular (Q-Learning)**, comparándolo rigurosamente frente a baselines heurísticos operativos y a la cota teórica superior de **Programación Dinámica (Oráculo con información perfecta)**.

El proyecto incluye la formulación física completa, entrenamiento, validación cruzada temporal (10 años de datos horarios de radiación y temperatura NASA POWER 2015–2024), scripts de evaluación y un **dashboard estático interactivo** para visualización web accesible.

---

> [!IMPORTANT]
> **Nota sobre la Demanda Eléctrica:**
> Los perfiles de demanda horaria utilizados en este proyecto corresponden a **demanda simulada**, generada sintéticamente con variabilidad estocástica log-normal (~10%) y factor de incremento de fin de semana (+15%), dividida en **cargas críticas** (~1.6 kWh/día: refrigeración básica continua, iluminación y comunicaciones) y **cargas no críticas** (~1.8 kWh/día: bombeo de agua, artefactos y talleres). Todos los métodos se evalúan exactamente sobre la misma serie temporal reproducida con semilla fija (42).

---

## 📁 Estructura del Repositorio

```text
.
├── data/
│   ├── nasa_power_lapaz_hourly.csv    # Serie histórica cruda NASA POWER (2015–2024, 87,672 h)
│   └── processed/
│       ├── clima_horario.csv          # Serie horaria curada, validada físicamente y con época
│       ├── demanda_simulada.csv       # Demanda horaria sintética reproducible (semilla 42)
│       └── resumen_calidad.txt        # Métricas de calidad y balance de datos procesados
├── python/
│   ├── config.py                      # Parámetros físicos, económicos, discretización y tiempos
│   ├── data_preparation.py           # Paso 1: Limpieza, validación física y etiquetado estacional
│   ├── env.py                         # Paso 2: Física pura (paso_fisico) y entorno Gym
│   ├── metricas.py                    # Paso 3: Funciones de evaluación energética y multiobjetivo
│   ├── baselines.py                   # Paso 3: Heurísticas (Voraz, Umbral SoC, Horaria)
│   ├── oracle_dp.py                   # Paso 3: Inducción hacia atrás vectorizada (Programación Dinámica)
│   ├── train_q.py                     # Paso 4: Entrenamiento tabular Q-Learning (60,000 ep.)
│   ├── evaluate.py                    # Paso 4: Evaluación en conjunto de prueba ciego (2023–2024)
│   └── export_web_data.py             # Paso 5: Serialización de resultados a JSON limpios (<1 MB)
├── results/
│   ├── q_table.npy                    # Tabla Q óptima entrenada (24 × 10 × 4 × 3 × 3 floats)
│   ├── curva_aprendizaje.csv          # Evolución de recompensa en validación (año 2022)
│   └── metricas.csv                   # Resultados tabulares de prueba por estrategia y época
├── web/                               # Aplicación web estática autónoma (lista para GitHub Pages)
│   ├── index.html                     # Interfaz single-page con Tailwind y Chart.js
│   ├── app.js                         # Lógica cliente, heatmap interactivo y simulador horario
│   └── data/                          # Datos estáticos serializados en formato JSON
│       ├── aprendizaje.json
│       ├── clima.json
│       ├── config.json
│       ├── metricas.json
│       ├── politica.json
│       └── semanas.json
├── requirements.txt                   # Dependencias de Python mínimas y fijas
└── README.md
```

---

## 🚀 Cómo Reproducir el Proyecto (Paso a Paso)

Todos los scripts de `python/` son deterministas y utilizan rutas relativas a la raíz del repositorio. El flujo de ejecución secuencial es el siguiente:

### 1. Instalación de Dependencias

```bash
pip install -r requirements.txt
```

### 2. Preparación y Validación de Datos Climáticos

Lee el archivo histórico de NASA POWER, valida cotas físicas, imputa valores faltantes si los hubiera y clasifica cada hora en su época climática andina (seca, lluviosa o transición):

```bash
python python/data_preparation.py
```

### 3. Generación de Demanda y Calibración del Entorno

Genera la demanda sintética reproducible (`demanda_simulada.csv`) y verifica el balance de energía de la función `paso_fisico` y la calibración del sistema:

```bash
python python/env.py
```

### 4. Evaluación de Baselines y Oráculo de Programación Dinámica

Verifica la coherencia de las políticas heurísticas y resuelve el año 2022 con inducción hacia atrás con información perfecta (oráculo DP):

```bash
python python/metricas.py
```

### 5. Entrenamiento del Agente Q-Learning

Ejecuta 60,000 episodios de entrenamiento sobre semanas aleatorias (2015–2021), validando cada 500 episodios en el año 2022 para conservar la mejor política:

```bash
python python/train_q.py
```

*Tiempo de ejecución aproximado: 3 a 4 minutos en CPU estándar.*

### 6. Evaluación Ciega en Años de Prueba (2023–2024)

Evalúa las 5 estrategias en datos nunca antes vistos por el agente (17,540 horas consecutivas) y genera `results/metricas.csv`:

```bash
python python/evaluate.py
```

### 7. Exportación de Datos para la Web

Genera los 6 archivos JSON optimizados (< 1 MB) en `web/data/`:

```bash
python python/export_web_data.py
```

---

## 🌐 Cómo Servir la Aplicación Web

Dado que la aplicación realiza peticiones `fetch()` a archivos JSON locales, debe ejecutarse a través de un servidor HTTP local (abrir con doble clic directamente en el explorador de archivos es bloqueado por políticas de CORS del navegador):

### Opción 1: Servidor Python integrado (Recomendada)

Desde la raíz del repositorio:

```bash
python -m http.server 8000 --directory web
```

O desde la carpeta `web/`:

```bash
cd web
python -m http.server 8000
```

Luego abre en tu navegador web:
👉 **[http://localhost:8000](http://localhost:8000)**

### Opción 2: Publicación en GitHub Pages

La carpeta `web/` está diseñada de forma **100% autónoma y relativa**:
- No contiene ninguna ruta absoluta a disco.
- Utiliza CDNs fijas para Tailwind CSS y Chart.js 4.4.x.
- Para publicar en GitHub Pages:
  1. Configura GitHub Pages en los ajustes del repositorio apuntando a la rama `master` y la carpeta `/web` (o usa una acción para desplegar la carpeta `web`).

---

## 📊 Resumen de Resultados Principales (Prueba 2023–2024)

Evaluación sobre **17,540 horas** (años 2023 y 2024 completos):

| Estrategia | Cob. Crítica (%) | Cob. Total (%) | No Servida Crítica (kWh) | Ciclos Batería | Recompensa Total | % del Óptimo Alcanzado |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Voraz (Baseline)** | 83.84 % | 89.84 % | 196.85 kWh | 611.8 | -2276.08 | 0.00 % |
| **Umbral SoC** | 97.37 % | 86.21 % | 32.07 kWh | 630.0 | -894.54 | 78.49 % |
| **Horaria** | 98.90 % | 78.55 % | 13.42 kWh | 456.5 | -856.85 | 80.63 % |
| **Q-Learning (RL)** | **99.59 %** | **87.59 %** | **4.94 kWh** | **611.0** | **-607.09** | **94.83 %** |
| **Oráculo (DP Óptimo)** | 99.99 % | 89.49 % | 0.14 kWh | 614.9 | -516.01 | 100.00 % |

### Conclusiones Clave:
1. **Reducción del 97.5% en Déficit Crítico:** El agente RL prácticamente elimina los cortes en servicios esenciales (refrigeración médica/alimentaria, comunicaciones), reduciendo el déficit de 196.85 kWh a solo 4.94 kWh en dos años.
2. **94.83% de la Cota Teórica Óptima:** Supera a todas las heurísticas fijas y se acerca estrechamente al oráculo de programación dinámica que dispone de información futura perfecta.
3. **Mismo Desgaste, Mayor Utilidad:** El agente realiza prácticamente el mismo número de ciclos de batería que el voraz (611 vs 612 ciclos), pero sincroniza las descargas con los momentos de alto valor social en lugar de agotar la reserva en consumos no críticos diurnos.

---

## 📜 Cita de Datos Climáticos

Los datos de irradiación solar (GHI) y temperatura a 2 m (T2M) se obtuvieron de:

> **NASA Langley Research Center (LaRC) POWER Project**, financiado a través del programa Earth Science / Applied Sciences de la NASA.
> Portal oficial: [https://power.larc.nasa.gov/](https://power.larc.nasa.gov/)
