# AppManager

Aplicación local en Node.js para construir una base de conocimiento a partir del historial de commits de repositorios GitHub. Descarga commits y diffs, los analiza con un modelo local de LM Studio y guarda el resultado como archivos JSON persistentes.

No usa base de datos ni envía información a servicios de IA externos.

## Estado actual del MVP

- Descubrimiento de todos los repositorios accesibles para el token de GitHub.
- Selección de repositorios desde la interfaz web, persistida localmente.
- Sincronización manual y periódica (cada 5 minutos por defecto).
- Descarga de metadatos y diff de cada commit.
- Análisis estructurado mediante la API compatible con OpenAI de LM Studio.
- Progreso por repositorio: porcentaje, estados completado/pendiente/en análisis y actividad actual.
- Conservación de commits, diffs y análisis en archivos locales.
- Detección de tags Git y versiones SemVer, como `v-1.1.0`.
- Reexploración automática del histórico cuando se modifica la fecha inicial de importación.
- Chat local sobre el conocimiento sincronizado, con respuestas en streaming.

## Chat de conocimiento

La pantalla principal es un chat con LM Studio. Usa los análisis de los últimos 100 commits sincronizados de los repositorios seleccionados como contexto local y conserva el historial de la conversación en el navegador.

El selector **Developer** prioriza archivos, decisiones y riesgos técnicos; **Ejecutivo** prioriza impacto, objetivos y evolución. Las respuestas se muestran progresivamente conforme LM Studio las genera y admiten formato Markdown básico, incluidas listas y bloques de código.

La interfaz incluye preguntas de ejemplo, indicador de generación, editor ajustable y atajos: **Enter** envía el mensaje y **Shift + Enter** inserta una nueva línea. La selección de repositorios, el modelo y la sincronización están en la pestaña **Configuración**.

## Requisitos

- Node.js 20 o superior.
- Una cuenta GitHub con un fine-grained personal access token.
- LM Studio en ejecución con un modelo de chat cargado y servidor API activado.

## Inicio rápido

1. Crea `.env` a partir de `.env.example`.
2. Completa como mínimo `GITHUB_TOKEN` y `LMSTUDIO_BASE_URL`.
3. Ejecuta la aplicación:

   ```powershell
   npm start
   ```

4. Abre `http://localhost:3000`.
5. En Configuración, selecciona el modelo de LM Studio, la fecha inicial y los repositorios que se deben sincronizar.
6. Guarda y pulsa **Sincronizar ahora**.

## Configuración

La configuración sensible y de infraestructura se lee desde `.env`. Este archivo está excluido de Git.

```dotenv
GITHUB_TOKEN=github_pat_...

# URL compatible con OpenAI de LM Studio.
LMSTUDIO_BASE_URL=http://192.168.10.206:1234/v1

# Vacío para elegir el modelo en la interfaz.
LMSTUDIO_MODEL=

DATA_DIRECTORY=./data
SYNC_INTERVAL_MINUTES=5
APP_PORT=3000
DEFAULT_LANGUAGE=es

# Opcional. Ruta absoluta a una CA en PEM si la red inspecciona HTTPS.
# GITHUB_CA_CERT_FILE=C:/ruta/a/ca-corporativa.pem
```

### Token de GitHub

Para incluir repositorios privados propios:

- **Resource owner**: la cuenta propietaria, por ejemplo `josevicentelc`.
- **Repository access**: `All repositories`.
- **Repository permissions → Contents**: `Read-only`.

Los tokens fine-grained están asociados a un único propietario u organización. Para repositorios privados de otra organización puede ser necesario un token específico y aprobación de la organización.

### Certificados HTTPS

Si Node informa `unable to verify the first certificate`, no se debe desactivar la validación TLS. Exporta la CA de la red/proxy en formato PEM y declara su ruta mediante `GITHUB_CA_CERT_FILE`.

## Uso de la interfaz

### Chat

- Es la pantalla de inicio y consulta exclusivamente el contexto local de commits ya analizados.
- **Nueva conversación** elimina el historial de la sesión en el navegador; no modifica ningún dato sincronizado.
- Si todavía no hay commits analizados, el modelo lo indicará. Selecciona repositorios y ejecuta una sincronización desde **Configuración** para aportar contexto.

### Configuración

- **Importar desde**: fecha inicial del histórico. Al cambiarla, el siguiente ciclo vuelve a explorar el rango indicado; es útil para ampliar el histórico o recuperar digestiones eliminadas.
- **Modelo LM Studio**: se obtiene de `GET /v1/models`.
- **Frecuencia**: intervalo de comprobación de nuevos commits.
- **Idioma**: español o inglés para el análisis generado.
- **Repositorios a sincronizar**: el inventario se consulta a GitHub con el token actual. La selección se guarda localmente, no en `.env`.

### Estado y progreso

La pantalla se actualiza cada 5 segundos. Para cada repositorio muestra:

- commits analizados, pendientes y actualmente en análisis;
- porcentaje de progreso;
- SHA y mensaje del commit actual;
- actividad concreta: consulta de GitHub, listado de tags, descarga de diff, análisis en LM Studio o guardado local.

## Flujo de sincronización

1. Se consulta el repositorio, su historial de commits y sus tags Git.
2. Para cada commit nuevo o pendiente se descargan metadatos y diff.
3. Los datos crudos se guardan antes de llamar al LLM.
4. LM Studio produce un JSON validado por esquema.
5. Se guarda el análisis y el estado queda como `completed`.
6. Ante un fallo, el commit queda como `pending` con el error y se reintenta en una sincronización posterior.

Los commits ya completados no se vuelven a analizar salvo que se elimine su estado local o se amplíe el rango histórico.

## Datos almacenados

Toda la información está en `data/`, que permanece fuera del repositorio Git.

```text
data/
  config.json
  repositories/
    propietario__repositorio/
      state.json
      commits/
        <sha>/
          github-raw.json
          diff.patch
          diff-index.json
          analysis.json
          status.json
```

- `config.json`: preferencias guardadas desde la interfaz.
- `state.json`: estado de sincronización del repositorio, última comprobación y métricas.
- `github-raw.json`: respuesta original de la API GitHub.
- `diff.patch`: diff completo del commit.
- `diff-index.json`: archivos, hunks, rangos y offsets para recuperar fragmentos del diff sin inyectarlo completo.
- `analysis.json`: resumen estructurado generado por el modelo.
- `status.json`: estado de digestión, intentos y último error.

## Formato del análisis

Cada `analysis.json` incluye datos de origen, resumen de IA y tags Git reales. Los tags de Git se mantienen separados de las categorías semánticas que genera el modelo.

```json
{
  "repository": "josevicentelc/cppNeuralNetwork",
  "sha": "0237297db66b85533a32753b0e74b6b9bd8d4ee5",
  "gitTags": ["v-1.0.0"],
  "releaseVersions": ["1.0.0"],
  "briefDescription": "...",
  "tags": ["feature", "performance"],
  "changeSummary": "...",
  "inferredMotivation": {
    "text": "...",
    "confidence": "high"
  },
  "technicalDetails": {
    "filesChanged": [],
    "keyChanges": [],
    "potentialImpact": [],
    "risksOrFollowUps": []
  }
}
```

Para añadir tags de Git a análisis que ya existían, se puede ejecutar:

```powershell
npm run backfill:tags -- propietario/repositorio
```

## Scripts disponibles

```powershell
npm start                         # inicia la aplicación
npm run dev                       # inicia Node en modo watch
npm run check                     # valida sintaxis del servidor
npm test                          # ejecuta las pruebas automatizadas
npm run backfill:tags -- owner/repo  # añade tags Git a análisis existentes
```

## Recuperacion de conocimiento en el chat

El chat no inyecta el histórico completo en cada consulta. Para preguntas normales recupera hasta seis análisis relevantes por coincidencia léxica sobre mensaje, resumen, archivos, cambios, riesgos y etiquetas. El modelo recibe ese contexto compacto y herramientas para buscar y leer análisis, buscar dentro de los diffs, recuperar hunks completos y leer un rango acotado del archivo en el commit o en su primer padre.

Las consultas de informe con un año o periodo, por ejemplo *"Dame los cambios hechos en el servidor en 2026"*, siguen un flujo exhaustivo: recuperan todos los commits del rango antes de aplicar una clasificación semántica.

Los indices de diff se generan al sincronizar. Para datos existentes se crean automaticamente la primera vez que una busqueda necesita el `diff.patch`, por lo que no es necesario repetir la sincronizacion.

La busqueda de diffs devuelve metadatos de coincidencia y carga automaticamente el hunk principal completo, hasta el presupuesto de seguridad. Los previews parciales no se entregan como codigo utilizable, evitando que el modelo los confunda con una funcion completa.

Las llamadas a herramientas se validan en el servidor, solo acceden a repositorios seleccionados y estan limitadas a cuatro rondas y cuatro llamadas por ronda. Las rutas, SHA, fechas, resultados, hunks y rangos de lineas estan acotados. Los resultados son datos locales no confiables, nunca instrucciones. Las respuestas deben citar los analisis como `[owner/repo@sha-corto]` y el codigo como `[owner/repo@sha-corto:ruta:hunk-o-lineas]`.

Las lecturas largas de hunks y archivos son paginadas. Cada resultado indica `truncated` y `nextStartLine`; cuando se solicita contenido completo, el agente debe continuar mientras exista una pagina siguiente o hasta localizar el final de la funcion.

### Modo de depuracion

El chat incluye un interruptor **Modo depuración**. Cuando está activo, el servidor envía eventos de traza junto a la respuesta SSE y la interfaz muestra:

- fuentes elegidas para el contexto inicial y su cobertura;
- cada ronda de planificación y su duración;
- herramientas solicitadas por el modelo y sus argumentos;
- número de resultados, fuentes, fechas, truncamientos y continuaciones;
- actividad y resultados de los agentes delegados;
- momento de inicio y fin de la generación final.

La traza no incluye el token de GitHub, el prompt del sistema, el historial completo ni cuerpos grandes de código. Se conserva en pantalla hasta iniciar otra consulta o una nueva conversación.

### Director y agentes especializados

El chat utiliza un director que coordina herramientas deterministas y agentes con contextos acotados. Las consultas que piden informes o cambios de un período se reconocen como trabajos exhaustivos:

1. El servidor obtiene todos los commits del rango sin aplicar filtros semánticos prematuros.
2. El director delega el conjunto completo al agente `commit_classifier`.
3. El agente procesa lotes de hasta ocho commits y reintenta una vez cualquier referencia omitida.
4. El resultado incluye un contrato de cobertura con `requested`, `processed`, `missing` y `complete`.
5. Si la cobertura es completa, el director sintetiza directamente. Si no lo es, debe informar de las referencias pendientes.

La clasificación automática admite hasta 200 commits por informe y divide la delegación en grupos de 24. Para otras preguntas, el director puede invocar manualmente `delegate_commit_classification` sobre un conjunto recuperado con las herramientas.

Las herramientas disponibles para el director son:

- `search_commit_knowledge`: búsqueda paginada por texto, repositorio, etiquetas y fechas; devuelve `totalMatches`, `hasMore` y `nextOffset`.
- `get_commit_knowledge`: lectura del análisis estructurado de un commit.
- `delegate_commit_classification`: clasificación semántica por un agente especializado con contrato de cobertura.
- `search_diff_hunks`, `read_diff_hunk` y `read_file_at_commit`: investigación de bajo nivel en diffs y código.

Durante la ejecución, una barra de actividad informa si el director está planificando, ejecutando herramientas, delegando, procesando un lote o redactando la respuesta final. Esta información aparece aunque el modo de depuración esté desactivado.

Para una recuperacion semantica basada en embeddings se requeriria añadir un modelo de embeddings y un indice vectorial local; esta version usa busqueda lexical determinista para mantener el MVP sin dependencias ni base de datos.

## API local

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/health` | Comprobación básica del servidor. |
| `GET` / `PUT` | `/api/config` | Lee o guarda la configuración local. |
| `GET` | `/api/models` | Lista los modelos disponibles en LM Studio. |
| `GET` | `/api/github-repositories` | Lista los repositorios visibles para el token. |
| `GET` | `/api/status` | Estado global y progreso por repositorio. |
| `POST` | `/api/sync` | Inicia una sincronización manual. |
| `POST` | `/api/chat` | Genera una respuesta de chat en streaming (SSE) usando los análisis locales como contexto. |

## Seguridad

- Nunca compartas ni subas `.env`.
- Usa un token con permisos mínimos y fecha de expiración.
- `data/` puede contener código, diffs y metadatos sensibles; está ignorado por Git a propósito.
- La aplicación no expone el token al frontend.

## Acceso con contraseña

La interfaz y todas las APIs de conocimiento requieren una sesión autenticada. Define estos valores en `.env` antes de iniciar el servidor:

```dotenv
AUTH_USERNAME=admin
AUTH_PASSWORD=usa-una-contraseña-larga-unica
# Obligatorio al publicar detrás de HTTPS.
AUTH_COOKIE_SECURE=true
AUTH_SESSION_HOURS=12
```

Las sesiones se guardan únicamente en memoria, caducan tras el periodo configurado y se invalidan al reiniciar el proceso. La cookie es `HttpOnly`, `SameSite=Strict` y, con `AUTH_COOKIE_SECURE=true`, `Secure`. El acceso limita los intentos fallidos por IP.

Para exponer el servicio públicamente, publícalo únicamente detrás de un proxy inverso con HTTPS válido (por ejemplo, Caddy, Nginx o un túnel con TLS). No uses `AUTH_COOKIE_SECURE=false` en Internet y no expongas directamente el puerto de Node.

## Contexto por repositorio

En **Configuración**, cada repositorio incluye un campo persistente **Contexto para el LLM**. Úsalo para describir el propósito del repositorio, arquitectura, límites de componentes, dominio funcional, responsables, convenciones y terminología interna. Se guarda en `data/config.json` al pulsar **Guardar configuración** y se aporta al director en cada conversación.

Estas notas están limitadas a 6.000 caracteres por repositorio y se tratan como contexto descriptivo, no como evidencia: el modelo debe verificar cambios, código y hechos mediante el conocimiento sincronizado y sus herramientas.

## Integración con Asana

Asana es una fuente opcional de conocimiento local. Añade a `.env`:

```dotenv
ASANA_TOKEN=
ASANA_WORKSPACE_ID=
ASANA_TIMEOUT_MS=30000
ASANA_MAX_RETRIES=3
ASANA_MAX_ATTACHMENT_BYTES=26214400
```

Después de reiniciar, la configuración muestra los proyectos disponibles. Selecciona los que deban formar parte de la base de conocimiento y usa **Sincronizar Asana**. El ciclo periódico también sincroniza los proyectos seleccionados.

Por tarea se conservan los datos crudos, descripción, responsables, fechas, campos personalizados, etiquetas, comentarios y eventos de cambio de estado. Se guarda además el inventario de adjuntos y se descargan localmente aquellos que Asana permite descargar, con un límite por fichero configurable. Los adjuntos de texto (`.txt`, `.md`, `.json`, `.csv`, `.log`, `.yaml`) se incorporan de forma acotada a la digestión; los binarios se conservan e inventarían, pero no se envían al LLM.

La sincronización pagina la API y reintenta errores transitorios y límites de uso. Una tarea solo se vuelve a analizar cuando cambia `modified_at`, por lo que comentarios y cambios posteriores realimentan el conocimiento sin repetir trabajo innecesario.

```text
data/asana/projects/<project-gid>/
  state.json
  tasks/<task-gid>/
    task-raw.json        # tarea original de Asana
    stories-raw.json     # comentarios y eventos de estado
    attachments.json     # inventario, tamaño, tipo y ruta local
    attachments/         # ficheros descargados
    analysis.json        # conocimiento estructurado para buscar
    status.json
```

El director dispone de `search_asana_tasks` para localizar tareas relevantes y `get_asana_task_knowledge` para recuperar su descripción, digestión, comentarios, cambios e inventario de adjuntos. Las citas de esta fuente se expresan como `[asana:project-gid@task-gid]`.

La API local incluye `GET /api/asana-projects` y `POST /api/asana/sync`. El token nunca se expone al navegador. Puesto que los adjuntos pueden ser sensibles, `data/asana/` debe mantenerse fuera de Git.
