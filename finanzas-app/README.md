# Mis Finanzas — Gestor financiero automático

Web + API + bot de Telegram + asistente con IA, todo conectado a un Atajo de
iPhone. Los gastos fijos/suscripciones se agregan solos cada mes.

## 1. Variables de entorno

```
TELEGRAM_BOT_TOKEN=tu_token_de_botfather   # opcional, para carga rápida por chat
TELEGRAM_CHAT_ID=tu_chat_id                # opcional
ANTHROPIC_API_KEY=tu_api_key               # console.anthropic.com
API_KEY=una_clave_larga_inventada          # protege el endpoint que usa el Atajo
```

## 2. Desplegar en Dokploy

1. Subí esta carpeta a un repo (o a tu Docker Registry de Dokploy).
2. Creá una app tipo **Docker Compose**, apuntá al repo, cargá las
   variables de entorno del paso 1.
3. Deploy. Por defecto queda en el puerto `3010` de tu PC1
   (`192.168.1.200:3010`).

## 3. Subdominio en tu dominio ya existente (storecofusion.com)

Como ya tenés `storecofusion.com` en Cloudflare con un túnel corriendo para
tu tienda EcoFusion, agregamos un subdominio nuevo al mismo túnel, sin
tocar nada de lo que ya funciona:

1. Entrá a **Cloudflare Zero Trust → Networks → Tunnels**.
2. Elegí el túnel que ya tenés corriendo (el mismo de tu tienda).
3. Andá a la pestaña **Public Hostname → Add a public hostname**.
4. Subdomain: `finanzas` — Domain: `storecofusion.com`.
5. Service: **HTTP**, y en la URL apuntá al servicio interno de esta app
   (según cómo lo desplegaste: `localhost:3010`, la IP de PC1:3010, o el
   nombre del servicio de Dokploy si están en la misma red de Docker).
6. Guardar. En un minuto, `https://finanzas.storecofusion.com` ya apunta a
   tu gestor financiero, siempre disponible, sin exponer nada más.

## 4. Uso por Telegram (carga rápida en efectivo)

Mandale al bot algo como `1500 asado con amigos` y lo registra como
Egreso en efectivo, categorizado solo. `/hoy`, `/mes`, `/resumen`.

## 5. Atajo de iPhone — las 5 preguntas

El Atajo pregunta, en este orden: **tipo de movimiento → qué es → cuánto →
categoría → medio de pago**, y manda todo junto al servidor.

1. Abrí **Atajos** → **+** → nombralo "Registro Gastos" (o el que ya tenías).
2. **Elegir de menú** — pregunta: "¿Ingreso o Egreso?" — opciones: `Ingreso`, `Egreso`.
3. **Solicitar entrada** (Texto) — pregunta: "¿Qué es?".
4. **Solicitar entrada** (Número) — pregunta: "¿Cuánto?".
5. **Elegir de menú** — pregunta: "¿Categoría?" — opciones: `Comida`,
   `Transporte`, `Salidas`, `Hogar`, `Salud`, `Ropa`, `Ingreso`, `Otros`.
6. **Elegir de menú** — pregunta: "¿Medio de pago?" — opciones: `Efectivo`,
   `Dólares`, y una opción por cada tarjeta que hayas cargado en la
   pestaña **Configuración** del dashboard (los nombres tienen que
   coincidir exactamente, letra por letra).
7. **Obtener contenido de URL**:
   - URL: `https://finanzas.storecofusion.com/api/movimiento`
   - Método: `POST`
   - Encabezados: `x-api-key` → tu `API_KEY`, `Content-Type` → `application/json`
   - Cuerpo JSON:
     - `tipo` → variable del paso 2
     - `descripcion` → variable del paso 3
     - `monto` → variable del paso 4
     - `categoria` → variable del paso 5
     - `medio_pago` → variable del paso 6
8. **Mostrar resultado** (contenido de la URL) — para confirmar que dice `ok`.
9. Compartir → **Agregar a pantalla de inicio**, y en los detalles del
   Atajo activá **Agregar a Siri** con una frase tipo "Registrar gasto".

Con esto, decís "Oye Siri, registrar gasto", contestás las 5 preguntas
(podés dictarlas por voz) y ya está — sin tocar la pantalla ni abrir nada.

## 6. Gastos fijos y suscripciones (100% automático)

En la pestaña **Gastos fijos** del dashboard cargás una vez: nombre,
monto, medio de pago, categoría y día del mes en que se cobra. El
servidor revisa todos los días y, cuando llega ese día, agrega el gasto
solo — no hace falta volver a tocarlo salvo que cambie el monto o quieras
darlo de baja.

## 7. Qué mirás a fin de mes

En **Resumen** vas a ver: balance en pesos y en dólares por separado,
gasto por categoría, gasto por medio de pago (para ver cuánto usás cada
tarjeta), tus últimos movimientos, y el botón **"Analizar mi mes"** que le
pide a Claude un resumen de dónde se te va la plata y consejos concretos.
