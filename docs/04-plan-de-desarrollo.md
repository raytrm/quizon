# 4. Plan de Desarrollo por Fases

El desarrollo se divide en **5 fases incrementales**, diseñadas para tener una versión jugable lo antes posible (Fase 2) e ir añadiendo mecánicas, audio y pulido visual sobre una base sólida, utilizando `data/questions.json` como repositorio inicial.

---

## Fase 0: Inicialización del Proyecto
* **Objetivo:** Preparar el entorno, dependencias y estructura base.
* **Tareas:**
  1. Inicializar `package.json` (`express`, `socket.io`, `qrcode`, `uuid`).
  2. Crear la estructura de carpetas definida en `docs/03-arquitectura-tecnica.md`.
  3. Configurar servidor HTTP básico en `server/server.js` sirviendo `client/` y endpoint de salud `/health`.
  4. Implementar `server/question-store.js` para cargar y validar `data/questions.json`.
  5. Crear `data/questions.json` con un primer pack de ejemplo (10 preguntas cubriendo los 5 tipos y referencias a imágenes/sonidos).
* **Entregable:** Servidor arrancando en local y sirviendo páginas estáticas base (`/tv`, `/player`, `/host`).

---

## Fase 1: Vinculación TV-Anfitrión, Salas y Equipos
* **Objetivo:** Conectar TV, Anfitrión y Equipos de forma fiable.
* **Tareas:**
  1. Implementar `server/rooms.js`: creación de salas desde `/tv`, códigos numéricos únicos de 6 dígitos, gestión de equipos (con lista de integrantes), control de primera respuesta por equipo y tokens de reconexión (`sessionToken`, `hostToken`).
  2. Implementar `server/qr.js` para generar los códigos QR en local sin depender de servicios externos.
  3. Implementar `server/socket.js` con eventos de registro (`tv:register`, `host:claim_room`, `player:join`, `host:kick_team`).
  4. Construir las vistas de Lobby en `tv.html` (QR + 6 dígitos + lista en vivo de equipos e integrantes), `player.html` (crear equipo con integrantes o unirse a equipo existente) y `host.html` (escanear/introducir código + configuración + botón Iniciar).
* **Criterio de aceptación:** Al abrir `/tv` muestra QR y 6 dígitos; el anfitrión reclama la sala, varios equipos se unen (algunos con 1 móvil y otros con varios) y se reconectan tras recargar sin perder su identidad.

---

## Fase 2: Motor de Juego y MVP Jugable
* **Objetivo:** Poder jugar una partida completa de principio a fin (opción múltiple y verdadero/falso).
* **Tareas:**
  1. Implementar `server/game-engine.js` con la máquina de estados (`LOBBY_UNCLAIMED` → `LOBBY` → `QUESTION_INTRO` → `QUESTION_ACTIVE` → `REVEAL` → `LEADERBOARD` → `FINISHED`).
  2. Implementar temporizador autoritativo en servidor (`endsAt`) y sincronización visual de cuenta atrás en `client/js/common/utils.js`.
  3. Implementar fórmula de puntuación estándar, bloqueo de primera respuesta por equipo y ranking con empates compartidos.
  4. Conectar UI de pregunta y revelación en `tv.js` y botones de mando en `player.js`.
  5. Añadir controles de anfitrión en `host.js` (Siguiente, Pausar/Reanudar, Finalizar).
* **Criterio de aceptación:** Se puede jugar una partida completa de 5 preguntas en TV + móviles de equipos con cálculo de puntos y ranking final.

---

## Fase 3: Tipos de Preguntas Avanzados y Estadísticas
* **Objetivo:** Completar las 5 mecánicas de QUIZÓN y las estadísticas de cierre.
* **Tareas:**
  1. Implementar mecánica `multiple_choice` (botones *toggle*, botón "Confirmar respuesta", sincronización `player:selection_changed` por si se agota el tiempo y puntuación proporcional).
  2. Implementar preguntas `visual` (carga y precarga de imágenes desde `client/assets/images/`) y `lightning` (relámpago con tiempo reducido y multiplicador `×1.5`).
  3. Añadir pantalla de estadísticas finales en TV (equipo más rápido, mayor racha, pregunta más difícil).
* **Criterio de aceptación:** Todos los tipos de preguntas funcionan correctamente y los empates comparten posición en la tabla.

---

## Fase 4: Audio, Animaciones y Pulido TV/Móvil
* **Objetivo:** Dar la sensación real de "concurso de televisión".
* **Tareas:**
  1. Implementar `client/js/common/audio.js` con Web Audio API (desbloqueo de autoplay en `/tv`, música de lobby/pregunta/podio, efectos sonoros y reproducción de audios de pregunta/revelación definidos en `questions.json`).
  2. Añadir control remoto de volumen/mute desde `host.html`.
  3. Pulir `tv.css`, `player.css`, `host.css` y `animations.css` (transiciones suaves, barra de tiempo animada, podio Top 3, feedback háptico `navigator.vibrate` en móviles al responder/acertar).
* **Criterio de aceptación:** Experiencia audiovisual fluida en TV 1080p/4K y móviles sin desbordamientos ni retrasos perceptibles.

---

## Fase 5: PWA y Batería de Pruebas
* **Objetivo:** Instalar como PWA y asegurar estabilidad mediante tests.
* **Tareas:**
  1. Configurar `client/manifest.json`, iconos y `client/sw.js` (caché de assets excluyendo Socket.IO).
  2. Escribir pruebas unitarias en `tests/` para:
     * Cálculo de puntuación (única, múltiple con evaluación al fin de tiempo, relámpago, empates).
     * Regla de primera respuesta válida por equipo con múltiples móviles.
     * Máquina de estados y transiciones de `game-engine.js`.
     * Creación de salas, códigos únicos y reconexión en `rooms.js`.
  3. Prueba de estrés simulando 15-20 clientes conectados simultáneamente con Socket.IO.
* **Criterio de aceptación:** Todos los tests pasan en verde y la app es instalable como PWA en Android/iOS/Desktop.

---

## Mejoras Futuras (Fuera del Primer Alcance)
* Integración de **SQLite / PostgreSQL** (`server/database.js`) para historial persistente de partidas, estadísticas globales y editor web de preguntas/packs.
