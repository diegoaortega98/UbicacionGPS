import math
import os
import time

import requests


API_URL = os.getenv("GPS_API_URL", "http://localhost:10000/api/ubicaciones")
DEVICE_ID = os.getenv("GPS_DEVICE_ID", "vehiculo-demo-01")
CENTRO_LATITUD = 10.3910
CENTRO_LONGITUD = -75.4794
RADIO = 0.003


def main():
    paso = 0
    print(f"Enviando ubicaciones de {DEVICE_ID} a {API_URL} cada 5 segundos. Ctrl+C para detener.")
    while True:
        angulo = paso * 0.12
        payload = {
            "dispositivoId": DEVICE_ID,
            "latitud": CENTRO_LATITUD + RADIO * math.cos(angulo),
            "longitud": CENTRO_LONGITUD + RADIO * math.sin(angulo),
            "velocidad": 35 + 8 * math.sin(angulo),
        }

        try:
            response = requests.post(API_URL, json=payload, timeout=10)
            response.raise_for_status()
            print(f"Ubicación enviada: {payload['latitud']:.6f}, {payload['longitud']:.6f}")
        except requests.RequestException as error:
            print(f"No se pudo enviar la ubicación: {error}")

        paso += 1
        time.sleep(5)


if __name__ == "__main__":
    main()
