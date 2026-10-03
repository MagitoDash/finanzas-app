# Mis Finanzas — Gestor financiero automático

Web + API + bot de Telegram, enlazado al Atajo de iPhone. Gastos fijos
automáticos, saldos por medio de pago y reservas/ahorros.

## Qué cambió en esta versión

- **Ya no usa ninguna API paga.** El botón "Analizar mi mes" genera un
  texto con todos tus datos y lo copiás a mano en la IA que quieras
  (Claude, ChatGPT, etc.). Por eso `ANTHROPIC_API_KEY` ya no es necesaria
  — podés sacarla de las variables de entorno en Dokploy si querés.
- **Pestaña Saldos**: cuánta plata tenés en cada medio de pago (tarjetas,
  efectivo, dólares), calculado solo a partir de tus movimientos.
- **Pestaña Reservas**: creá ahorros con nombre, descripción, meta y
  fecha, y movés plata hacia/desde un medio de pago.
- **Gráficos con porcentaje** en las categorías y medios de pago, más un
  histórico de ingresos vs egresos.
- **Borrar movimientos** directo desde el dashboard (ya no hace falta la
  terminal).
- Internamente, ya no usa `node-fetch` ni llama a ninguna IA desde el
  servidor.

## 1. Variables de entorno

```
TELEGRAM_BOT_TOKEN=tu_token_de_botfather   # opcional, para carga rápida por chat
TELEGRAM_CHAT_ID=tu_chat_id                # opcional
API_KEY=una_clave_larga_inventada          # protege el endpoint que usa el Atajo
```

## 2. Desplegar

Subí los cambios a tu repo `MagitoDash/finanzas-app` y redeployá desde
Dokploy como siempre. La base de datos (`finanzas-data` en el volumen)
no se borra: tus 13 medios de pago y movimientos ya cargados siguen ahí,
las tablas nuevas (`reservas`, `movimientos_reserva`) se crean solas al
arrancar.

## 3. Saldo por medio de pago — cómo arranca bien

El saldo de cada tarjeta/efectivo se calcula como: Ingresos - Egresos
cargados en ese medio (y los movimientos hacia/desde reservas). Como
recién empezás a usar el sistema, **cargá un "Ingreso" inicial** en cada
medio de pago con el monto que tenías antes de usar la app, así el saldo
arranca correcto. Podés hacerlo desde el dashboard o con el Atajo.

## 4. Reservas / ahorros

En la pestaña **Reservas** creás una (ej: "Viaje a Bariloche", meta
$300.000, fecha objetivo). Para mover plata hacia ella elegís "Aportar",
el monto y de qué medio de pago sale — eso resta del saldo de ese medio y
suma al de la reserva. "Retirar" hace lo inverso. La barra de progreso te
muestra cuánto llevás de la meta.

## 5. Atajo de iPhone — recordatorio de las 5 preguntas

El Atajo sigue mandando a `https://finanzas.storecofusion.com/api/movimiento`
con: `tipo`, `descripcion`, `monto`, `categoria`, `medio_pago`. El nombre
en `medio_pago` tiene que coincidir exactamente con alguno de tus 13
medios de pago cargados (Efectivo, Dólares, Naranja X, BBVA Débito, BBVA
Crédito, Santander, Cencosud, Galicia, Mercado Pago, Supervielle, UALA,
Patagonia, Cocos). Si agregás uno nuevo desde Configuración, actualizá
también las opciones del menú en el Atajo.

## 6. Analizar tu mes

Botón **"Generar texto"** en Resumen: arma un texto con ingresos,
egresos, categorías, saldos y reservas. Tocás **"Copiar"** y lo pegás en
Claude, ChatGPT o la IA que uses — te va a devolver el análisis sin que
vos pagues ninguna API desde el servidor.
