import math
import time

import requests


API_URL = "http://localhost:5023/api/ubicaciones"
DEVICE_ID = "Moto-01"
CENTRO_LATITUD = 10.3910
CENTRO_LONGITUD = -75.4794
RADIO = 0.003


def main():
    paso = 0
    print(f"Enviando ubicaciones de {DEVICE_ID} a {API_URL} cada 5 segundos.", flush=True)

    while True:
        angulo = paso * 0.12
        ubicacion = {
            "dispositivoId": DEVICE_ID,
            "latitud": CENTRO_LATITUD + RADIO * math.cos(angulo),
            "longitud": CENTRO_LONGITUD + RADIO * math.sin(angulo),
            "velocidad": 35 + 8 * math.sin(angulo),
        }

        try:
            response = requests.post(API_URL, json=ubicacion, timeout=10)
            response.raise_for_status()
            print(
                f"Ubicación enviada: {ubicacion['latitud']:.6f}, "
                f"{ubicacion['longitud']:.6f}",
                flush=True,
            )
        except requests.RequestException as error:
            print(f"No se pudo enviar la ubicación; se reintentará: {error}", flush=True)

        paso += 1
        time.sleep(5)


if __name__ == "__main__":
    main()
