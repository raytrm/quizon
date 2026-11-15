# QUIZÓN — Documentación y Especificación

**QUIZÓN** es un juego web multijugador por equipos de preguntas y respuestas en tiempo real diseñado para convertir cualquier televisión en un concurso televisivo interactivo, utilizando los teléfonos móviles como mandos y panel de control del anfitrión.

## Índice de Documentación

1. [Análisis de Flecos y Decisiones de Diseño](docs/01-analisis-y-flecos.md)  
   Revisión crítica de la propuesta inicial, detección de vacíos funcionales/técnicos y decisiones cerradas.
2. [Especificación Funcional y Reglas del Juego](docs/02-especificacion-funcional.md)  
   Máquina de estados de la partida, flujos de TV/Equipo/Anfitrión, tipos de preguntas y fórmulas de puntuación.
3. [Arquitectura Técnica y Protocolo](docs/03-arquitectura-tecnica.md)  
   Estructura de carpetas revisada, modelo de datos en JSON (preguntas, imágenes y sonidos), protocolo Socket.IO, seguridad, audio y PWA.
4. [Plan de Desarrollo por Fases](docs/04-plan-de-desarrollo.md)  
   Hoja de ruta incremental desde el MVP hasta la versión completa, con entregables y plan de pruebas.

## Stack Tecnológico

- **Frontend:** HTML5, CSS3, JavaScript (ES Modules), Web Audio API, PWA (Manifest + Service Worker).
- **Backend:** Node.js, Express (servir estáticos y API básica), Socket.IO (tiempo real), `qrcode`.
- **Repositorio de datos (Alcance inicial):** JSON (`data/questions.json`) para preguntas, respuestas y rutas de imágenes/sonidos. *(La persistencia en SQLite / PostgreSQL queda planificada como mejora futura).*

## Cómo ejecutar (Beta)

```bash
npm install
npm start
```

- **Pantalla TV:** `http://localhost:3000/tv` (o la IP de tu red Wi-Fi mostrada en consola).
- **Anfitrión:** `http://localhost:3000/host` (o escaneando el QR de la TV).
- **Equipos:** `http://localhost:3000/player` (o escaneando el QR tras vincular el anfitrión).

### Pruebas
```bash
npm test
```
