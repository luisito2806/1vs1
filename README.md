# Duelo Ronin 1 vs 1

Juego de pelea 1 vs 1 en tiempo real con Node.js + Socket.IO + Canvas. Junta los dos proyectos base:

- **sprite-colisiones**: personaje animado (parado, caminar, correr, brincar), gravedad, salto y colisiones AABB.
- **juegos-dual**: servidor autoritativo y duelo **cerrado a exactamente 2 jugadores**.

El personaje es propio: **Ronin**, un peleador con cinta en la frente dibujado por código (`public/fighter.js`).
El Jugador 1 es rojo y el Jugador 2 es azul. También se puede usar una imagen (sprite sheet) en su lugar (ver abajo).

## Uso

```bash
npm install
npm start          # http://localhost:3000
npm test
```

Variables de entorno: `PORT` (3000), `ROUNDS_TO_WIN` (2), `ROUND_TIME_MS` (60000), `RECONNECT_GRACE_MS` (10000),
`ALLOW_SAME_BROWSER` (`1` solo en desarrollo).

Para jugar en red local, el otro jugador abre `http://<IP-de-tu-PC>:3000`.

## Cómo jugar

1. Abre la página en dos navegadores o pestañas: el primero es el **Jugador 1** y el segundo el **Jugador 2**.
   Mientras esperas al rival puedes practicar con el Costalito (los golpes no quitan vida).
2. Ambos pulsan **Listo** (o Enter) → cuenta regresiva 3-2-1 → **¡PELEA!**
3. Gana la ronda quien noquee al rival o quien tenga más vida al acabar los 60 s. Gana el duelo quien gane 2 rondas.
4. Al final, **Revancha** (ambos deben aceptar).

| Tecla | Acción |
|---|---|
| `A` `D` / `←` `→` | moverse |
| `Shift` | correr |
| `W` / `↑` / `Espacio` | brincar (soltar antes = salto corto) |
| `S` / `↓` | bloquear (recibes 20 % del daño si miras al rival) |
| `J` | puñetazo: rápido, 7 de daño |
| `K` | patada: lenta, 13 de daño, empuja y levanta |
| `H` | ver hitboxes (como en sprite-colisiones) |
| `M` | silenciar sonido |

## Límite de 2 jugadores

- El servidor tiene solo dos lugares: `p1` y `p2`. El cupo se revisa **solo en el servidor**, en `io.use()`,
  antes de entrar al duelo.
- Un **tercer** visitante recibe `duel_full`, ve la pantalla "Duelo lleno" y nunca recibe el estado del juego
  (no hay espectadores).
- Si un jugador se desconecta, su lugar se le guarda 10 s (la pelea se pausa). Si vuelve recupera su lado;
  si no, el rival gana por abandono y el lugar queda libre.
- Si un jugador no pulsa "Listo" en 60 s, se le expulsa para no bloquear el duelo.

## Usar tu imagen de jugador

1. Guarda tu sprite sheet como `public/img/jugador.png` (fondo transparente, mirando a la derecha).
2. Por defecto se espera el mismo formato que sprite-colisiones: **5 columnas x 4 filas**
   (parado, caminar, correr, brincar). Si tu imagen es distinta, edita `public/sprite-config.js`
   (columnas, filas, fila de cada animación y alto en pantalla). Puedes poner una imagen distinta por jugador
   con `p1` y `p2`.
3. Recarga la página. Si la imagen no existe, se usa el Ronin dibujado, así que el juego siempre funciona.

## Estructura

- `server/game.js`: lógica pura de la pelea (gravedad, plataformas, paredes, empuje entre cuerpos,
  golpes con arranque/activo/recuperación, bloqueo, K.O.).
- `server/duel.js`: lugares, fases (`WAITING → READY → COUNTDOWN → FIGHTING → ROUND_END → GAME_OVER`), rondas,
  reconexión, revancha. Sin sockets; el tiempo avanza con `tick(dt)`.
- `server/index.js`: Express + Socket.IO; aquí se aplica el cupo de 2.
- `public/client.js`: input, interpolación, escenario, HUD (vida, rondas, reloj), chispas y sonido.
- `public/fighter.js`: el personaje Ronin dibujado y animado por poses.
- `public/sprites.js` + `public/sprite-config.js`: carga opcional de la imagen del jugador.
- `test/`: pruebas con `node:test` (física, duelo y conexión real con `socket.io-client`).

## Notas

- El servidor decide todo (posiciones, golpes, vida); el cliente solo manda qué teclas tiene presionadas.
  Así nadie puede hacer trampa modificando su navegador.
- El `playerId` en `sessionStorage` sirve para reconectar, no es seguridad real.

## Publicar en Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/luisito2806/1vs1)

El archivo `render.yaml` crea un servicio web gratuito (`npm install` y `npm start`). Render asigna el puerto con la variable `PORT` y soporta WebSocket, así que Socket.IO funciona sin configurar nada más. Para jugar, abre la dirección en dos dispositivos o navegadores distintos. El plan gratuito se duerme tras 15 minutos sin visitas: la primera visita después tarda alrededor de un minuto en cargar.
