# 1. Análisis de Flecos

Todos los flecos técnicos y funcionales detectados en la propuesta inicial (vinculación TV-Anfitrión, modo por equipos con primera respuesta válida, mecánica de respuesta múltiple, fórmula de puntuación y empates, seguridad en servidor, reconexión/temporizador autoritativo, desbloqueo de audio en TV, repositorio JSON y estructura de carpetas) ya han sido **resueltos e implementados** en la versión Beta actual.

---

## Puntos pendientes / Mejoras futuras

### Base de Datos (SQLite / PostgreSQL)
* **Estado:** Pendiente para una iteración posterior al primer alcance.
* **Motivo:** En la Beta actual se utiliza `data/questions.json` como repositorio único para agilizar el arranque sin depender de base de datos. Queda pendiente añadir `server/database.js` cuando se quiera persistir el historial de partidas, estadísticas globales y un editor web de preguntas.
