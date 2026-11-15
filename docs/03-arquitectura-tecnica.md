# 3. Arquitectura Técnica y Protocolo

## 3.1. Estructura de Carpetas Revisada

Se parte de la propuesta inicial del proyecto, añadiendo separación para la vista de Anfitrión (`host`), módulo de Audio, Service Worker para PWA y utilidades compartidas, usando `data/questions.json` como repositorio único en este primer alcance:

```text
quizon/
├── client/
│   ├── index.html              # Redirección o selector rápido (Unirse / Anfitrión / TV)
│   ├── tv.html                 # Interfaz de Televisión
│   ├── player.html             # Interfaz de Móvil (Equipo)
│   ├── host.html               # Interfaz de Anfitrión
│   ├── admin.html              # Editor visual de juegos, preguntas e imágenes (/admin)
│   ├── manifest.json           # Manifiesto PWA
│   ├── sw.js                   # Service Worker (caché de App Shell y assets)
│   │
│   ├── css/
│   │   ├── global.css          # Variables CSS, tipografía, reset, botones base
│   │   ├── tv.css              # Diseño 16:9 legible a distancia (TV)
│   │   ├── player.css          # Diseño mobile-first táctil
│   │   ├── host.css            # Panel de control del anfitrión
│   │   └── animations.css      # Transiciones, podio, barras de tiempo
│   │
│   ├── js/
│   │   ├── common/
│   │   │   ├── connection.js   # Wrapper de Socket.IO + reconexión automática
│   │   │   ├── audio.js        # Web Audio API (música, efectos, control volumen)
│   │   │   └── utils.js        # Formateo, temporizador sincronizado, storage
│   │   ├── tv.js               # Controlador de vista TV
│   │   ├── player.js           # Controlador de vista Equipo
│   │   ├── host.js             # Controlador de vista Anfitrión
│   │   └── admin.js            # Controlador de editor de juegos/preguntas (/admin)
│   │
│   └── assets/
│       ├── images/             # Imágenes de preguntas, explicaciones y UI
│       ├── sounds/             # Música de lobby, tensión, acierto, fallo, podio
│       └── icons/              # Iconos PWA (192x192, 512x512)
│
├── server/
│   ├── server.js               # Servidor HTTP (Express) + arranque Socket.IO
│   ├── socket.js               # Registro y validación de eventos Socket.IO
│   ├── rooms.js                # Gestión de salas, códigos 6 dígitos, equipos y tokens
│   ├── game-engine.js          # Máquina de estados, temporizadores y puntuación
│   ├── question-store.js       # Carga y validación en memoria de data/questions.json
│   └── qr.js                   # Generación local de QR (SVG/DataURL)
│
├── data/
│   └── questions.json          # Repositorio de preguntas, respuestas, imágenes y sonidos
│
├── docs/                       # Especificaciones del proyecto
├── tests/                      # Pruebas unitarias e integración (node:test o vitest)
├── package.json
└── README.md
```

> **Nota clave:** Se eliminan `client/js/scoring.js` y `client/js/questions.js` del cliente. La validación de respuestas, el banco de preguntas y el cálculo de puntuación residen exclusivamente en el servidor (`server/game-engine.js` y `server/question-store.js`) para evitar trampas.

---

## 3.2. Modelo de Datos en `data/questions.json`

En este primer alcance, `data/questions.json` centraliza los packs de preguntas, respuestas correctas, explicaciones y las rutas locales a imágenes y sonidos:

```json
{
  "catalogId": "000001",
  "packs": [
    {
      "id": "cultura-general",
      "title": "Cultura General",
      "description": "Historia, ciencia, geografía y entretenimiento",
      "questions": [
        {
          "id": "00001",
          "type": "single_choice",
          "category": "Ciencia",
          "difficulty": "medium",
          "timeLimit": 20,
          "prompt": "¿Cuál es el planeta más grande del sistema solar?",
          "options": [
            { "id": "a", "text": "Saturno" },
            { "id": "b", "text": "Júpiter" },
            { "id": "c", "text": "Neptuno" },
            { "id": "d", "text": "Urano" }
          ],
          "correctOptionIds": ["b"],
          "explanation": "Júpiter tiene un diámetro de unos 143.000 km, más de 11 veces el de la Tierra.",
          "extraFact": "Curiosidad adicional opcional que se muestra en la pantalla de revelación."
        }
      ]
    }
  ]
}
```

* `type` admite: `"single_choice"`, `"multiple_choice"`, `"true_false"`, `"visual"`, `"lightning"`.
* `options` admite entre 2 y 6 opciones dinámicas (la UI de TV y móvil se adapta automáticamente al número de opciones de cada pregunta).
* `correctOptionIds` siempre es un array de strings para unificar la lógica entre respuesta única (`["b"]`) y múltiple (`["a", "c"]`).
* `extraFact` es un campo opcional para destacar una curiosidad o moraleja breve en la fase `REVEAL`.
* `media` referencia rutas locales servidas desde `client/assets/images/` y `client/assets/sounds/`.

### Mejora Futura: Base de Datos (SQLite / PostgreSQL)
Para una iteración posterior (fuera de este primer alcance), se añadirá `server/database.js` para persistir:
* Packs y preguntas editables desde una interfaz web.
* Historial de partidas (`matches`, `match_results`) y estadísticas históricas.

---

## 3.3. Protocolo de Eventos Socket.IO

### Cliente → Servidor
* `tv:register` `{ roomCode? }` → Al abrir `/tv`, crea sala en `LOBBY_UNCLAIMED` y devuelve código de 6 dígitos + QR de anfitrión (o reconecta a sala existente).
* `host:claim_room` `{ roomCode, hostToken? }` → El anfitrión vincula la TV mediante el QR o los 6 dígitos y recibe control de la sala.
* `host:update_config` `{ roomCode, config }` → Cambia nombre de partida, pack, nº preguntas, factor multiplicador de tiempo (`timeMultiplier`), avance auto/manual y late join.
* `host:start_game` `{ roomCode }` → Inicia la partida desde `LOBBY`.
* `host:end_timer` `{ roomCode }` → Finaliza el reloj inmediatamente pasando de `QUESTION_ACTIVE` a `TIME_UP`.
* `host:reveal_answer` `{ roomCode }` → Muestra la solución, explicación detallada y curiosidades (`TIME_UP` → `REVEAL`).
* `host:show_results` `{ roomCode }` → Muestra la clasificación parcial o podio final (`REVEAL` → `LEADERBOARD` / `FINISHED`).
* `host:next_step` `{ roomCode }` → Avanza al siguiente paso lógico (desde `LEADERBOARD` a la siguiente pregunta).
* `host:pause_toggle` `{ roomCode }` → Pausa o reanuda el temporizador.
* `host:kick_team` `{ roomCode, teamId }` → Expulsa a un equipo del lobby o partida.
* `host:tv_audio` `{ roomCode, muted, volume }` → Controla el audio de la TV.
* `player:join` `{ roomCode, teamName, members?, color?, icon?, createTeam?, sessionToken? }` → Crea un equipo (con lista opcional de jugadores, color de píldora e icono) o se une a uno existente; reconecta si trae `sessionToken`.
* `player:selection_changed` `{ roomCode, questionId, selectedOptionIds }` → (Solo en `multiple_choice`) Sincroniza en servidor las opciones marcadas por si se agota el tiempo sin pulsar Confirmar.
* `player:answer` `{ roomCode, questionId, selectedOptionIds, confirm? }` → Registra o actualiza la selección del equipo (el tiempo registrado coincide con la última selección). Si `confirm: true`, bloquea la respuesta del equipo; cuando todos confirman, finaliza el tiempo.

### Servidor → Clientes
* `room:state` → Snapshot completo del estado actual adaptado al rol (sin `correctOptionIds` ni `optionPicks` durante `QUESTION_ACTIVE`; en `TIME_UP` y `REVEAL` la TV recibe `game.optionPicks` con los equipos que eligieron cada opción).
* `room:teams_updated` → Lista de equipos conectados y sus integrantes.
* `game:question_intro` `{ index, total, category, type }` → Aviso previo de pregunta.
* `game:question_start` `{ question, endsAt }` → Pregunta activa y timestamp UTC de fin.
* `game:time_up` `{ questionId, answeredCount }` → Aviso de tiempo agotado (la TV mantiene la pregunta sin revelar solución hasta que el moderador la muestre).
* `game:answer_ack` `{ accepted, lockedByTeam, selectedOptionIds }` → Confirmación al móvil y sincronización del botón activado entre los dispositivos del equipo.
* `game:reveal` `{ correctOptionIds, explanation, extraFact, revealImages, roundScores }` → Resultados de la ronda.
* `game:leaderboard` `{ standings, isFinal }` → Clasificación actualizada (respetando empates en la misma posición).
* `game:finished` `{ podium, standings, stats }` → Podio y estadísticas finales.
* `tv:audio_settings` `{ muted, volume }` → Orden de volumen/mute hacia la TV.
* `room:error` `{ code, message }` → Errores controlados (sala no existe, nombre de equipo repetido, sala cerrada).

---

## 3.4. Seguridad, Audio y PWA

* **Tokens de sesión:** Cada dispositivo de equipo recibe un `sessionToken` UUID al unirse; el anfitrión recibe un `hostToken`. Ninguna acción de anfitrión se ejecuta si no coincide su `hostToken`.
* **Web Audio API (`audio.js`):**
  * Música en bucle para Lobby, Tensión durante pregunta y Fanfarria en Podio, además de audios específicos por pregunta (`media.questionAudio`, `media.revealAudio`).
  * Efectos cortos (tic-tac últimos 5 segundos, respuesta enviada, acierto, fallo).
  * Botón inicial en `/tv` para desbloquear el `AudioContext` ante las políticas de autoplay de los navegadores.
* **PWA (`manifest.json` + `sw.js`):**
  * `sw.js` usa estrategia *Cache-First* para imágenes/sonidos/fuentes y *Network-First* para HTML/JS/CSS, excluyendo siempre `/socket.io/*`.
