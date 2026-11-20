#!/usr/bin/env python3
"""
Descarga radiación solar horaria y temperatura de NASA POWER para La Paz
y las guarda en data/nasa_power_lapaz_hourly.csv

Solo usa la biblioteca estándar de Python (no requiere pip install).

Uso:
    python download_nasa_power.py
    python download_nasa_power.py --lat -16.5 --lon -68.15 --start 2015 --end 2024
"""
import argparse
import csv
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://power.larc.nasa.gov/api/temporal/hourly/point"
PARAMS = "ALLSKY_SFC_SW_DWN,T2M"   # radiación (Wh/m²) y temperatura a 2 m (°C)
FILL = -999.0                       # valor de dato faltante en NASA POWER
LOCAL_TZ = timezone(timedelta(hours=-4))  # La Paz = UTC-4 (sin horario de verano)


def fetch_year(lat, lon, year, retries=4):
    url = (
        f"{API}?parameters={PARAMS}&community=RE"
        f"&longitude={lon}&latitude={lat}"
        f"&start={year}0101&end={year}1231"
        f"&format=JSON&time-standard=UTC"
    )
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r)["properties"]["parameter"]
        except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
            wait = 5 * attempt
            print(f"  [{year}] intento {attempt}/{retries} falló: {e}. Reintentando en {wait}s...")
            time.sleep(wait)
    raise RuntimeError(f"No se pudo descargar el año {year}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, default=-16.5)
    ap.add_argument("--lon", type=float, default=-68.15)
    ap.add_argument("--start", type=int, default=2015)
    ap.add_argument("--end", type=int, default=2024)
    ap.add_argument("--out", default="data/nasa_power_lapaz_hourly.csv")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    rows, missing = [], 0

    for year in range(args.start, args.end + 1):
        print(f"Descargando {year}...")
        data = fetch_year(args.lat, args.lon, year)
        ghi, t2m = data["ALLSKY_SFC_SW_DWN"], data["T2M"]
        for key in sorted(ghi):  # key = YYYYMMDDHH (UTC)
            g, t = ghi[key], t2m.get(key, FILL)
            if g == FILL or t == FILL:
                missing += 1
                g = t = ""
            utc = datetime.strptime(key, "%Y%m%d%H").replace(tzinfo=timezone.utc)
            loc = utc.astimezone(LOCAL_TZ)
            rows.append([
                utc.strftime("%Y-%m-%d %H:%M"),
                loc.strftime("%Y-%m-%d %H:%M"),
                g, t,
            ])
        time.sleep(1)  # cortesía con el servidor

    with open(args.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["datetime_utc", "datetime_local", "ghi_wh_m2", "t2m_c"])
        w.writerows(rows)

    print(f"\nListo: {len(rows)} filas -> {args.out}")
    print(f"Horas con datos faltantes (-999): {missing}")


if __name__ == "__main__":
    main()
