# Arquitectura de AppManager

AppManager sigue una estructura modular sin framework. Las dependencias se construyen una sola vez en `src/server.js` y se inyectan en los módulos que las necesitan. Los datos externos de GitHub y Asana se tratan siempre como datos no confiables.

## Flujo de una petición

```text
Navegador
  → request-handler.js       autenticación, validación y rutas HTTP
    → servicios de dominio  sincronización, almacenamiento e informes
    → chat-controller.js     ciclo del director y streaming SSE
      → chat-tools.js        autorización y ejecución determinista
```

## Módulos principales

- `src/server.js`: punto de composición. Crea clientes, almacenes y servicios; inicia HTTP y la sincronización periódica.
- `src/request-handler.js`: frontera HTTP. No contiene lógica de almacenamiento ni prompts.
- `src/http-utils.js`: lectura JSON y respuestas HTTP seguras y reutilizables.
- `src/chat-controller.js`: orquestación de una consulta de chat y emisión de eventos SSE.
- `src/chat-tool-definitions.js`: contratos JSON de las herramientas disponibles para el LLM.
- `src/chat-tools.js`: validación, autorización y ejecución de herramientas contra conocimiento local.
- `src/chat-tool-presentation.js`: resúmenes de depuración y mensajes de actividad visibles para el usuario.
- `src/reports.js`: fachada estable para los servicios de informes.
- `src/executive-report.js`: asociación determinista de tareas, pull requests y commits.
- `src/daily-report.js`: análisis acotado por tarea de la actividad diaria de un usuario.
- `src/report-markdown.js`: presentación de informes, independiente de la obtención de datos.
- `src/pdf.js`: conversión local de Markdown al PDF mínimo soportado.
- `public/client-api.js`: cliente JSON y lector de eventos SSE del navegador.
- `public/reports-ui.js`: estado y eventos exclusivos de la pantalla de informes.
- `public/app.js`: composición y comportamiento general de la interfaz.

## Reglas de mantenimiento

1. Las rutas validan y traducen HTTP, pero delegan el trabajo en servicios.
2. Los servicios reciben dependencias por constructor o fábrica; no importan instancias globales.
3. La recuperación de datos debe ser determinista antes de pedir síntesis al LLM.
4. Los renderizadores reciben objetos terminados y no consultan GitHub, Asana ni LM Studio.
5. Los contratos públicos —rutas, JSON, eventos SSE y ficheros persistidos— requieren pruebas antes de modificarse.
6. Los comentarios explican decisiones y límites; no repiten literalmente lo que ya expresa el código.

Ejecuta `npm run check` para validar todos los archivos JavaScript y `npm test` para comprobar los contratos automatizados.
