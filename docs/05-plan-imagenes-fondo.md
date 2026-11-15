# 5. Plan de Organización de Imágenes y Fondo en Bucle

## 5.1. Análisis de Organización de Imágenes

Partiendo de la prueba en `data/images/lemming/` (con archivos `*_ask_1`, `*_ask_2`, `*_ask_3`, `*_explain_1`, `*_explain_2`), se comparan dos enfoques:

### Opción A: Archivos planos con sufijo (`_ask_N` / `_explain_N`)
* **Ventajas:** Todas las fotos de una pregunta se ven en una sola carpeta; el nombre describe el contenido.
* **Inconvenientes:** Requiere nombrar manualmente cada archivo con el sufijo exacto y cuidar ceros a la izquierda (`01`, `02`... `10`) para que el orden no falle al superar 9 imágenes.

### Estructura Definitiva: Tres Niveles (`catalogId` / `questionId` / `bg | clue | explain`)

* `data/questions.json` incluye `"catalogId"` de **6 dígitos** (por ejemplo, `"000001"`).
* Cada pregunta tiene un `"id"` de **5 dígitos** (`"00001"` a `"99999"`).
* Las carpetas de imágenes se generan automáticamente con `npm run media:scaffold` (`scripts/scaffold-media.js`):

```text
data/images/
└── 000001/                  (catalogId de 6 dígitos)
    ├── 00001/               (questionId de 5 dígitos - ej. Lemmings)
    │   ├── bg/              (imágenes ambientales en bucle de fondo)
    │   │   ├── 01_lemming.jpg
    │   │   ├── 02_lemming-jumping.jpg
    │   │   └── 03_lemming-game.png
    │   ├── clue/            (imágenes protagonistas nítidas necesarias para responder)
    │   └── explain/         (imágenes al mostrar la solución y curiosidad)
    │       ├── 01_lemming-white-wilderness-wald-disney.jpg
    │       └── 02_lemming-white-wilderness-wald-disney.jpg
    ├── 00002/
    └── ...
```

* **Compatibilidad híbrida dentro de cada carpeta de pregunta:** El servidor (`GET /api/media/:catalogId/:questionId`) soporta **ambos formatos** dentro de `data/images/<catalogId>/<questionId>/`:
  1. Subcarpetas `bg/`, `clue/` y `explain/` con archivos numerados (`01_...`, `02_...`).
  2. Archivos en la raíz de la pregunta con **prefijo** `bg_N_`, `clue_N_` o `explain_N_`.

---

## 5.2. Plan de Implementación

1. **Fase A — Servidor de medios, generador de carpetas y página de prueba (`/test-bg`):**
   * Exponer `data/images/` en `/media` desde `server/server.js`.
   * Script `npm run media:scaffold` para crear automáticamente `data/images/<catalogId>/<questionId>/{bg,clue,explain}/` a partir de `data/questions.json`.
   * Endpoints `GET /api/media/:catalogId/:questionId` (devuelve `{ bg, clue, explain }`) y `GET /api/preview-question/:questionId`.
   * Página de prueba `/test-bg` (`client/test-bg.html`) con valores por defecto ajustados: duración `4.0s`, crossfade `1.4s`, opacidad `0.65`, velo `0.15`, blur `0px` y Ken Burns activado, además de soporte para mostrar imágenes `clue` nítidas (`object-fit: contain`).

2. **Fase B — Integración en el juego (completada):**
   * Eliminado el bloque redundante `media` de `data/questions.json` y trasladadas las imágenes existentes (`orion.svg`, `jupiter.svg`) a sus carpetas `clue/` (`00039` y `00040`).
   * En `QuestionStore` (`server/question-store.js` + `server/media-scanner.js`), se resuelven automáticamente `bg`, `clue` y `explain` desde `data/images/<catalogId>/<questionId>/`, sin exponer `explain` durante `QUESTION_ACTIVE`.
   * Integrado el fondo en bucle (`bg` durante la pregunta, `explain` en `REVEAL`) y el contenedor de pista (`clue`) en `client/tv.html`, `client/css/tv.css` y `client/js/tv.js`.
