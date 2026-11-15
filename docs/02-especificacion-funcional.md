# 2. Especificación Funcional y Reglas del Juego

## 2.1. Roles e Interfaces

El sistema cuenta con tres vistas web diferenciadas:

1. **Televisión (`/tv`):** Pantalla pasiva de proyección. Al abrirse directamente muestra un QR y un código de 6 dígitos para vincular al anfitrión y conectar equipos; durante el juego muestra preguntas, imágenes, barra de tiempo, audio/música, revelación de respuesta con explicación y clasificaciones animadas.
2. **Móvil Equipo (`/player` o `/`):** Mando del equipo. Permite unirse por código/QR, crear un equipo (incluyendo los nombres de sus integrantes) o unirse a uno existente, visualizar botones grandes de respuesta, ver la puntuación del equipo y el tiempo restante.
3. **Móvil Anfitrión (`/host`):** Panel de control. Vincula la TV mediante QR o código de 6 dígitos, configura la partida, inicia el juego, avanza/pausa rondas, controla el audio de la TV y modera equipos.

---

## 2.2. Máquina de Estados de la Partida

Cada sala atraviesa los siguientes estados controlados por el servidor:

```text
LOBBY_UNCLAIMED (TV abierta mostrando QR y código de 6 dígitos esperando al anfitrión)
   │  [Anfitrión escanea QR o introduce los 6 dígitos]
   ▼
LOBBY (esperando equipos + configuración del anfitrión)
   │  [Anfitrión pulsa "Iniciar Partida"]
   ▼
QUESTION_INTRO (3s: número de pregunta, categoría y tipo; ej. "¡RELÁMPAGO!")
   │
   ▼
QUESTION_ACTIVE (temporizador corriendo; los equipos envían su respuesta)
   │  [Todos los equipos responden O se agota el tiempo]
   ▼
REVEAL (muestra respuesta correcta, explicación, imagen y puntos de la ronda)
   │  [Anfitrión pulsa "Siguiente" O temporizador automático]
   ▼
LEADERBOARD (ranking parcial animado)
   │
   ├──► (si quedan preguntas) ──► QUESTION_INTRO
   │
   ▼  (si no quedan preguntas)
FINISHED (podio final, ganador, estadísticas de la partida y opción "Jugar de nuevo")
```

> **Pausa (`PAUSED`):** El anfitrión puede pausar en cualquier momento durante `QUESTION_ACTIVE` o `LEADERBOARD`, congelando el tiempo restante.

---

## 2.3. Flujo Detallado de Juego

### Paso 1: Vinculación de TV y Configuración (Anfitrión)
1. La televisión abre `/tv` y muestra automáticamente un **código QR** y un **código numérico de 6 dígitos**.
2. El anfitrión escanea el QR (o abre `/host` e introduce los 6 dígitos) para tomar el control de la sala.
3. El anfitrión configura:
   * **Nombre de la partida** (ej. "Noche de Viernes").
   * **Paquete / Categorías de preguntas** (o "Todas mezcladas").
   * **Número de preguntas:** 10, 15, 20 o Personalizado.
   * **Avance entre preguntas:** Manual (el anfitrión pulsa Siguiente) o Automático (tras X segundos en `REVEAL`/`LEADERBOARD`).
   * **Permitir entrada tardía (Late Join):** Sí / No.

### Paso 2: Conexión de Equipos
* La TV muestra el **Código de 6 dígitos** y el **Código QR** apuntando a `http(s)://<host>/player?code=123456`.
* Desde el móvil, el participante puede:
  * **Crear un equipo nuevo:** Introduce el nombre del equipo y, opcionalmente, añade la lista de nombres de los jugadores que lo integran (no hace falta que todos tengan móvil).
  * **Unirse a un equipo existente:** Selecciona un equipo ya creado en la sala (si varios miembros quieren usar su propio móvil).
* En la TV aparecen en tiempo real los equipos conectados y los nombres de sus integrantes.

### Paso 3 y 4: Tipos de Preguntas y Mecánicas

| Tipo (`type`) | Tiempo base | UI en TV | UI en Móvil | Envío |
| :--- | :---: | :--- | :--- | :--- |
| **`single_choice`** (Opción múltiple) | 20 s | Enunciado + 4 opciones (A, B, C, D) | 4 botones grandes con letra/color | Inmediato al tocar |
| **`multiple_choice`** (Respuesta múltiple) | 25 s | Enunciado + 4-6 opciones + aviso "Varias correctas" | Botones *toggle* + botón **"Confirmar respuesta"** | Al pulsar Confirmar o fin de tiempo (evalúa marcadas) |
| **`true_false`** (Verdadero / Falso) | 15 s | Enunciado + Verdadero / Falso | 2 botones grandes (Verde / Rojo) | Inmediato al tocar |
| **`visual`** (Visual) | 20 s | Imagen grande protagonista + opciones | Opciones (A, B, C, D) | Inmediato al tocar |
| **`lightning`** (Relámpago) | 7 s | Alerta visual/sonora + pregunta corta + opciones | Botones grandes | Inmediato al tocar (puntos ×1.5) |

* **Regla de primera respuesta por equipo:** Cuando un equipo tiene varios móviles conectados, la primera respuesta confirmada que llega al servidor se registra como la respuesta oficial del equipo. Los demás móviles del equipo reciben aviso de que el equipo ya ha respondido y quedan bloqueados para esa pregunta.
* **Respuesta múltiple al agotarse el tiempo:** Si el tiempo termina sin haber pulsado "Confirmar respuesta", el servidor evalúa las opciones que el equipo tenía marcadas en ese instante (o `0` puntos si no había marcado ninguna).

### Paso 5: Revelación y Ranking
Cuando todos los equipos activos han respondido o el temporizador llega a `0`:
1. La TV marca en verde la(s) opción(es) correcta(s) y atenúa las incorrectas.
2. Se muestra la **explicación** breve y la **imagen de explicación** (si existe en la pregunta).
3. El móvil muestra a cada equipo si acertó, cuántos puntos ganó en la ronda y su posición actual.
4. En modo `LEADERBOARD`, la TV muestra la clasificación actualizada de equipos.

### Paso 6: Finalización y Estadísticas
Al terminar la última pregunta, la TV muestra:
* **Podio (Top 3)** con animación y música de cierre.
* **Tabla completa** de equipos (mostrando integrantes y puntuación total).
* **Estadísticas de la partida:**
  * Equipo más rápido (menor tiempo medio de acierto).
  * Mayor racha de aciertos consecutivos.
  * Pregunta más difícil (menor % de acierto).
* Botón para el anfitrión: **"Nueva partida (mismos equipos)"** o **"Volver al inicio"**.

---

## 2.4. Sistema de Puntuación y Empates

### Preguntas de una sola respuesta (`single_choice`, `true_false`, `visual`, `lightning`)
* Si la respuesta es **incorrecta** o no responde: `0` puntos.
* Si la respuesta es **correcta**:
  $$\text{Puntos} = \text{Base} + \text{round}\left(\text{BonusMax} \times \frac{\text{TiempoRestante}}{\text{TiempoTotal}}\right)$$
  * Valores por defecto: `Base = 500`, `BonusMax = 500` (rango de `500` a `1000` puntos).
  * En modo **`lightning` (Relámpago)**: se aplica multiplicador `× 1.5` (rango de `750` a `1500` puntos).

### Preguntas de respuesta múltiple (`multiple_choice`)
Sea $C$ el conjunto de opciones correctas y $S$ el conjunto de opciones marcadas por el equipo:
$$\text{Ratio} = \max\left(0,\ \frac{|S \cap C| - |S \setminus C|}{|C|}\right)$$
$$\text{Puntos} = \text{round}\left(\text{Ratio} \times \left(\text{Base} + \text{BonusMax} \times \frac{\text{TiempoRestante}}{\text{TiempoTotal}}\right)\right)$$
* Si acierta todas sin fallos: 100% de los puntos.
* Si acierta 1 de 2 y marca 1 incorrecta: `(1 - 1) / 2 = 0` puntos.

### Empates
* Si dos o más equipos terminan una ronda o la partida con exactamente la misma puntuación, **comparten la misma posición en el ranking** y conservan ambos sus puntos completos (no se aplican desempates que desplacen a un equipo por debajo del otro).
