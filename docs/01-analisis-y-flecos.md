# 1. Análisis de Flecos y Decisiones de Diseño

Este documento recoge los vacíos, ambigüedades y riesgos técnicos detectados en la descripción inicial de **QUIZÓN**, junto con las decisiones cerradas para el desarrollo.

---

## 1.1. Vinculación entre Anfitrión y Televisión
* **Fleco detectado:** El paso 1 indica que el anfitrión crea la partida desde su móvil, pero el paso 2 indica que la televisión muestra un código QR y un código numérico de 6 dígitos. No se especifica cómo sabe la televisión qué partida mostrar si se abrió de forma independiente.
* **Decisión cerrada:** Flujo **"TV primero"**:
  1. La televisión entra directamente a la URL `/tv`, se conecta al servidor y muestra de inmediato un **código QR** y un **código numérico de 6 dígitos**.
  2. El anfitrión vincula la TV escaneando ese código QR (o abriendo `/host` e introduciendo los 6 dígitos) para reclamar la sala y configurarla.
  3. Una vez configurada/abierta la sala, la TV muestra el QR y código para que se conecten los equipos.

---

## 1.2. Juego Exclusivo por Equipos y Múltiples Móviles
* **Fleco detectado:** Se hablaba indistintamente de "jugadores o equipos", sin definir qué ocurre cuando varios miembros de un equipo comparten partida o si todos necesitan un teléfono.
* **Decisión cerrada:**
  * **Solo por equipos:** Todas las partidas se juegan por equipos.
  * **Registro de integrantes:** Al crear un equipo, existe una opción para incluir la lista de nombres de los jugadores que lo componen. **No es necesario que todos los participantes tengan móvil** (un equipo puede jugar con un único móvil compartido o con varios móviles conectados al mismo equipo).
  * **Primera respuesta válida:** Si un equipo tiene más de un móvil conectado, **solo se acepta la primera respuesta** recibida por el servidor para ese equipo en la ronda actual; el resto de móviles del mismo equipo quedan bloqueados hasta la siguiente pregunta.

---

## 1.3. Mecánica de "Respuesta Múltiple"
* **Fleco detectado:** En opción única o verdadero/falso, tocar un botón puede enviar la respuesta al instante. En "Respuesta múltiple" (varias correctas), el jugador necesita seleccionar varias opciones antes de confirmar.
* **Decisión cerrada:**
  * En preguntas de tipo `multiple_choice`, los botones del móvil funcionan como interruptores (*toggle*) y aparece un botón inferior **"Confirmar respuesta"**.
  * Si el tiempo se agota sin pulsar "Confirmar", se evalúan las opciones que el equipo dejó marcadas en ese momento (o se considera sin respuesta si no marcó ninguna), evitando frustración en rondas rápidas.

---

## 1.4. Fórmula de Puntuación y Empates
* **Fleco detectado:** Se indica "cuanto más rápido se responde correctamente, más puntos", pero falta una fórmula exacta, el tratamiento de aciertos parciales y la resolución de empates.
* **Decisión cerrada:**
  * **Fórmula estándar:** Puntuación base + bonificación por velocidad decreciente linealmente según el tiempo restante.
  * **Respuesta múltiple:** Puntuación proporcional `(aciertos_marcados - fallos_marcados) / total_correctas`, con mínimo `0` puntos (nunca negativo) para evitar que marcar todas las opciones dé puntos gratis.
  * **Empates:** Si hay empate en el ranking, ambos equipos comparten posición y suman sus puntos normalmente (sin desempate artificial que penalice a uno de ellos).

---

## 1.5. Seguridad y Lógica en el Servidor (Anti-trampas)
* **Fleco detectado:** La estructura propuesta inicialmente incluía `client/js/scoring.js` y `client/js/questions.js`. Si las preguntas completas o el cálculo de puntos viven en el cliente, cualquier jugador puede inspeccionar el navegador y hacer trampas.
* **Decisión cerrada:**
  * **El servidor es la única fuente de verdad:** `server/game-engine.js` gestiona las preguntas, los temporizadores (`endsAt`) y el cálculo de puntuación.
  * El cliente móvil **nunca** recibe las respuestas correctas ni la explicación hasta que la ronda pasa a fase de revelación (`REVEAL`).

---

## 1.6. Reconexión, Latencia y Desconexiones
* **Fleco detectado:** En partidas reales con móviles, es muy común que alguien bloquee la pantalla, cambie de app o pierda Wi-Fi brevemente.
* **Decisión cerrada:**
  * Al unirse, el servidor entrega un `sessionToken` que el móvil guarda en `localStorage` (junto con `roomCode`). Si la página se recarga o reconecta, el cliente emite `rejoin_room` y recupera su estado y equipo sin perder puntos.
  * **Temporizador autoritativo:** El servidor envía el timestamp UTC de fin (`endsAt`). Los clientes calculan la cuenta atrás local respecto a ese instante para mantener sincronización aunque haya latencia.
  * **Resiliencia del anfitrión:** Si el anfitrión se desconecta, la partida no se destruye; permite reconexión mediante `hostToken`.

---

## 1.7. Políticas de Audio en Navegadores (TV)
* **Fleco detectado:** Se quiere usar Web Audio API para música y efectos en la TV, pero los navegadores modernos bloquean el audio automático si el usuario no ha hecho clic previamente en esa pestaña.
* **Decisión cerrada:**
  * Mostrar en `/tv` un botón inicial de **"Activar pantalla y sonido"** (o aviso si el `AudioContext` está en estado `suspended`). Un único clic al abrir la TV desbloquea el audio para toda la sesión.
  * Permitir al anfitrión silenciar o ajustar el volumen de la TV de forma remota desde `/host`.

---

## 1.8. Repositorio en JSON (Primer Alcance) vs. Base de Datos (Mejora Futura)
* **Fleco detectado:** Se mencionaba SQLite/PostgreSQL junto a `data/questions.json` sin delimitar qué iba en cada sitio.
* **Decisión cerrada:**
  * **Primer alcance (MVP y v1):** Se utiliza `data/questions.json` como repositorio único de preguntas, respuestas y localización de imágenes y sonidos. Así se evita instalar y mantener una base de datos, agilizando la primera iteración.
  * **Mejora futura:** Incorporar SQLite / PostgreSQL para historial de partidas, estadísticas globales y editor visual de preguntas.

---

## 1.9. Revisión de la Estructura de Carpetas Propuesta
* **Decisión cerrada:**
  * Separar la vista del **Anfitrión** (`host.css`, `host.js`).
  * Añadir módulo de audio (`audio.js`), utilidades compartidas y Service Worker (`sw.js`) para PWA.
  * Añadir generación local de códigos QR en el servidor (`server/qr.js`) para no depender de servicios externos.
  * Centralizar las pruebas en `tests/` cubriendo motor de juego, puntuación, equipos y salas.
