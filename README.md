# Gestión Inteligente de Baterías Solares con Aprendizaje por Refuerzo (RL)
### Microrred Fotovoltaica Aislada en el Altiplano de La Paz, Bolivia

Este proyecto implementa y evalúa un sistema autónomo de gestión energética para una microrred solar aislada en el Altiplano boliviano (La Paz, -16.50°S, -68.15°W, ~3,600 msnm) mediante **Aprendizaje por Refuerzo Tabular (Q-Learning)**, comparándolo rigurosamente frente a baselines heurísticos operativos y a la cota teórica superior de **Programación Dinámica (Oráculo con información perfecta)**.

El proyecto incluye la formulación física completa, entrenamiento, validación cruzada temporal (10 años de datos horarios de radiación y temperatura NASA POWER 2015–2024), scripts de evaluación y un **dashboard estático interactivo** para visualización web accesible.

---

> [!NOTE]
> **Pregunta de Investigación:**  
> *«¿Puede un agente de RL gestionar la batería de una microrred rural en La Paz cubriendo más demanda crítica que las reglas fijas, sin aumentar el desgaste de la batería?»*

> [!IMPORTANT]
> **Nota sobre la Demanda Eléctrica:**  
> Los perfiles de demanda horaria utilizados en este proyecto corresponden a **demanda simulada**, generada sintéticamente con variabilidad estocástica log-normal (~10%) y factor de incremento de fin de semana (+15%), dividida en **cargas críticas** (~1.6 kWh/día: refrigeración básica continua, iluminación y comunicaciones) y **cargas no críticas** (~1.8 kWh/día: bombeo de agua, artefactos y talleres). Todos los métodos se evalúan exactamente sobre la misma serie temporal reproducida con semilla fija (42).

---

## 📁 Estructura del Repositorio

```text
.
├── .github/
│   └── workflows/
│       └── pages.yml                  # Flujo de GitHub Actions para despliegue automático en Pages
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
├── web/                               # Aplicación web estática tipo Dashboard (lista para GitHub Pages)
│   ├── index.html                     # Interfaz profesional en 4 pestañas con Tailwind, Chart.js y Leaflet
│   ├── app.js                         # Lógica cliente, simulador horario y mapa solar departamental
│   ├── img/                           # Recursos gráficos (fotografía real de paneles en La Paz)
│   └── data/                          # Datos estáticos serializados en formato JSON y JS embebido
│       ├── datos_embebidos.js         # Bundle empaquetado para soporte directo file:// sin servidor
│       ├── aprendizaje.json
│       ├── clima.json
│       ├── config.json
│       ├── metricas.json
│       ├── politica.json
│       └── semanas.json
├── index.html                         # Punto de entrada raíz (redirección automática al dashboard)
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

## 🌐 Cómo Abrir y Desplegar la Aplicación Web

El dashboard está completamente optimizado tanto para **abrirse directamente con doble clic** en tu computadora como para **publicarse en GitHub / GitHub Pages**:

### Opción 1: Apertura Directa con `index.html` (Recomendada / Sin Servidor)

¡No requiere instalar ni ejecutar ningún servidor local!
1. Haz **doble clic en `index.html`** (en la raíz del repositorio o dentro de `web/index.html`).
2. Se abrirá en tu navegador predeterminado (Chrome, Edge, Firefox, Brave, Safari) con todas las funcionalidades activas: mapa solar interactivo, fórmulas KaTeX, simulador horario y gráficos de métricas.
> *Nota técnica:* Los datos estáticos están empaquetados en `web/data/datos_embebidos.js`, lo que elimina los bloqueos de CORS que los navegadores imponen al protocolo `file://`.

### Opción 2: Publicación en GitHub y GitHub Pages

Para subir el proyecto a GitHub y tener el dashboard activo en la web:

1. **Subir cambios a GitHub:**
   ```bash
   git add .
   git commit -m "Soporte de apertura directa con index.html y despliegue GitHub Pages"
   git push origin master
   ```

2. **Habilitar GitHub Pages:**
   - En tu repositorio de GitHub, ve a **Settings** > **Pages** (en el menú lateral izquierdo).
   - En **Build and deployment** > **Source**, selecciona **GitHub Actions**.
   - El flujo automatizado [`.github/workflows/pages.yml`](.github/workflows/pages.yml) construirá y publicará automáticamente el sitio en:
     `https://<tu-usuario>.github.io/<tu-repositorio>/`

*(Alternativamente, si usas la opción "Deploy from a branch -> master", el archivo `index.html` de la raíz redirige de inmediato a `web/index.html`).*

### Opción 3: Servidor Local Opcional (Para desarrollo)

Si prefieres servirlo mediante un servidor HTTP local:
```bash
python -m http.server 8000 --directory web
```
Luego abre en tu navegador: **[http://localhost:8000](http://localhost:8000)**

### 🖥️ Organización del Dashboard Web (4 Pestañas)

1. **📊 Visión General & Mapa Solar:** Hero interactivo con la fotografía real de la instalación en La Paz, pregunta de investigación, 3 KPIs clave en prueba (2023–2024) y el **Mapa de Radiación Solar Departamental** (base blanca ESRI sin claves API, interpolación continua `Leaflet.heat` y 11 estaciones provinciales).
2. **🤖 Modelo RL & Resultados:** Formulación completa del MDP (2,880 estados, 3 acciones y recompensa multiobjetivo), parámetros de microrred, hiperparámetros de Q-Learning, curva de aprendizaje y comparativa de las 5 estrategias con filtros de año y época.
3. **⚡ Simulador Horario & Política:** Gemelo digital con simulación hora a hora de 12 semanas típicas de 2024 (168 h con áreas de demanda vs generación, curva de SoC y franja de acciones) y el mapa de calor interactivo de la política óptima aprendida.
4. **📋 Conclusiones:** Hallazgos principales respaldados por métricas dinámicas, análisis explícito del desgaste/ciclado, limitaciones metodológicas y cita formal del proyecto NASA POWER.

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
3. **Comportamiento del Desgaste y Ciclado:** Los ciclos de batería del agente (611.0 ciclos) son similares a los del voraz (611.8 ciclos) y mayores que los de la regla horaria (456.5 ciclos). La regla horaria ahorra ciclos únicamente porque deja solo un 60.51% de cobertura no crítica al apagar el uso de batería a las 21:00 h, mientras que el agente distribuye el ciclado con alta inteligencia para garantizar las cargas críticas sin incrementar el desgaste respecto al baseline voraz.

---

## 📜 Cita de Datos Climáticos

Los datos de irradiación solar (GHI) y temperatura a 2 m (T2M) se obtuvieron de:

> **NASA Langley Research Center (LaRC) POWER Project**, financiado a través del programa Earth Science / Applied Sciences de la NASA.  
> Portal oficial: [https://power.larc.nasa.gov/](https://power.larc.nasa.gov/)
