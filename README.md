# AppManager

AppManager es una aplicación local en Node.js que construye una base de conocimiento consultable a partir de GitHub y Asana. Sincroniza commits, diffs, tareas, comentarios, cambios de estado, adjuntos y pull requests; guarda los datos como JSON y utiliza un modelo local de LM Studio para generar análisis, responder preguntas y redactar informes PDF.

No necesita base de datos y no envía datos a servicios externos de IA. GitHub y Asana solo se consultan durante la sincronización mediante sus APIs oficiales.

## Funcionalidades

- Descubrimiento y selección de repositorios accesibles para el token de GitHub.
- Sincronización manual y periódica de commits, metadatos, tags y diffs.
- Análisis estructurado de commits y tareas mediante LM Studio.
- Persistencia local de datos crudos, índices, análisis y estados de sincronización.
- Integración opcional con proyectos de Asana, incluidos comentarios, eventos y adjuntos.
- Caché local de pull requests mencionados en tareas de Asana, almacenada en `data/pr`.
- Chat con herramientas deterministas para buscar commits, autores, tareas, diffs y código.
- Respuestas en streaming, mensajes de actividad explícitos y modo de depuración.
- Informe ejecutivo por rango de fechas.
- Informe diario por usuario y rango de fechas.
- Exportación de informes en PDF.
- Acceso protegido mediante usuario, contraseña y cookie de sesión.

La organización interna y las reglas para extender el proyecto están en [ARCHITECTURE.md](ARCHITECTURE.md).

## Requisitos

- Node.js 20 o superior.
- Un fine-grained personal access token de GitHub con acceso de lectura a los repositorios necesarios.
- LM Studio ejecutándose con un modelo cargado y su servidor compatible con OpenAI activado.
- Opcionalmente, un token y workspace de Asana.

## Inicio rápido

1. Crea un archivo `.env` en la raíz del proyecto.
2. Configura GitHub, LM Studio y las credenciales de acceso.
3. Arranca la aplicación (actualmente no requiere paquetes npm externos):

   ```powershell
   npm start
   ```

4. Abre `http://localhost:3000`.
5. Inicia sesión.
6. En **Configuración**, selecciona el modelo, los repositorios y, opcionalmente, los proyectos de Asana.
7. Guarda la configuración y ejecuta las sincronizaciones iniciales.

## Variables de entorno

```dotenv
# Obligatorias
GITHUB_TOKEN=github_pat_...
LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
AUTH_USERNAME=admin
AUTH_PASSWORD=usa-una-contraseña-larga-y-unica

# Aplicación
APP_PORT=3000
DATA_DIRECTORY=./data
SYNC_INTERVAL_MINUTES=5
DEFAULT_LANGUAGE=es
LMSTUDIO_MODEL=

# Sesión
AUTH_SESSION_HOURS=12
# Usa true cuando la aplicación se publique detrás de HTTPS.
AUTH_COOKIE_SECURE=false

# Certificado corporativo opcional para GitHub.
GITHUB_CA_CERT_FILE=

# Integración opcional con Asana.
ASANA_TOKEN=
ASANA_WORKSPACE_ID=
ASANA_CA_CERT_FILE=
ASANA_TIMEOUT_MS=30000
ASANA_MAX_RETRIES=3
ASANA_MAX_ATTACHMENT_BYTES=26214400
```

La configuración sensible permanece en `.env`. Las preferencias elegidas desde la interfaz se guardan en `data/config.json`.

### Permisos de GitHub

Para repositorios privados, el token fine-grained debe pertenecer al propietario u organización correctos y disponer al menos de:

- acceso a los repositorios que se quieran sincronizar;
- permiso **Contents: Read-only**;
- acceso de lectura a pull requests cuando se use la asociación con tareas de Asana.

Si la organización exige aprobación, el token debe estar autorizado por ella.

### Certificados HTTPS

Si Node muestra `unable to verify the first certificate`, configura la CA de la red en `GITHUB_CA_CERT_FILE` y, si corresponde, en `ASANA_CA_CERT_FILE`. No desactives globalmente la validación TLS.

## Interfaz

### Chat

El chat consulta exclusivamente el conocimiento sincronizado localmente. El modo **Developer** prioriza archivos, implementación, decisiones técnicas y riesgos; el modo **Ejecutivo** prioriza objetivos, impacto y evolución.

La recuperación inicial usa búsqueda léxica acotada. El director puede utilizar herramientas deterministas para:

- buscar y leer análisis de commits;
- obtener autores desde metadatos originales de GitHub;
- localizar tareas y detalles de Asana;
- buscar hunks dentro de diffs;
- leer fragmentos paginados de diffs o archivos;
- mostrar adjuntos de Asana almacenados localmente;
- delegar clasificaciones semánticas acotadas.

Las referencias recuperadas se validan contra los repositorios y proyectos seleccionados. Los datos de GitHub y Asana se consideran datos no confiables, nunca instrucciones para el modelo.

Las consultas temporales se normalizan de forma determinista. Las expresiones relativas como `hoy`, `ayer`, `mañana`, `pasado mañana`, `los últimos 7 días`, `las últimas dos semanas`, `esta semana`, `la semana pasada`, `este fin de semana`, `el próximo lunes`, `este mes`, `el mes pasado`, `este trimestre`, `el trimestre pasado`, `este año`, `el año pasado`, `desde principios de mes` y `hasta ayer` se amplían antes de llegar al modelo con sus fechas concretas; por ejemplo, `¿Qué he hecho hoy?` pasa a incluir `hoy (4 de agosto de 2026)`. Cuando se pide un subconjunto temático de todos los commits de un período, el sistema obtiene primero el conjunto completo y después delega su clasificación. La cobertura se controla mediante `requested`, `processed`, `missing` y `complete`.

El **Modo depuración** muestra recuperación inicial, rondas de planificación, herramientas utilizadas, argumentos acotados, resultados resumidos, agentes delegados y duración de la generación. No muestra tokens, prompts completos ni cuerpos grandes de código.

### Informes

La pestaña **Informes** dispone de dos modalidades.

#### Informe ejecutivo

Recopila las tareas de Asana con actividad y los commits incluidos en el rango de fechas. La asociación se realiza de forma determinista mediante la caché local de pull requests:

```text
Tarea de Asana → enlace al pull request → commits y merge commit del PR
```

El informe ordena la actividad cronológicamente, incluye autores cuando están disponibles y presenta el avance de las tareas de forma legible. Los commits sin una relación local verificable se conservan como entradas independientes.

#### Informe diario

El selector de usuario se construye a partir de `created_by.name` en los ficheros `stories-raw.json`. Para el usuario y período seleccionados:

1. se recuperan todas sus acciones en las historias de Asana;
2. se agrupan por tarea;
3. se combinan sus eventos con el análisis local de la tarea;
4. LM Studio genera un resumen de alto nivel por tarea;
5. los resúmenes se recopilan en un único PDF.

Los movimientos de sección, cambios de estado y comentarios se usan como evidencia, pero el resultado intenta describir la actividad humana —implementación, revisión de código, investigación, validación o coordinación— sin enumerar cambios internos de Asana.

La caja **Instrucciones para el LLM** es persistente y se incorpora a cada análisis individual del informe diario.

### Configuración

Desde esta pestaña se administran:

- fecha inicial de importación de GitHub;
- fecha inicial de importación de Asana;
- modelo de LM Studio;
- idioma de los análisis;
- intervalo de sincronización;
- repositorios seleccionados y contexto descriptivo por repositorio;
- proyectos de Asana seleccionados.

Las notas de repositorio están limitadas a 6.000 caracteres. Sirven como contexto descriptivo, pero no sustituyen la evidencia recuperada.

## Sincronización

### GitHub

1. Se consulta el historial del repositorio y sus tags.
2. Para cada commit pendiente se descargan metadatos y diff.
3. Los datos crudos se guardan antes de invocar al modelo.
4. LM Studio devuelve un análisis validado mediante un esquema JSON.
5. Se guarda el análisis y el commit queda marcado como completado.
6. Los fallos permanecen pendientes para poder reintentarlos.

Los diffs se indexan por archivos y hunks para permitir búsquedas y lecturas acotadas. Los commits completados no se vuelven a analizar salvo que cambie el rango de importación o se elimine su estado local.

### Asana y pull requests

1. Se listan las tareas de cada proyecto seleccionado.
2. Se descartan las creadas antes de `asanaImportSince`.
3. Se descargan tarea, historias y adjuntos.
4. Los adjuntos de texto se incorporan de forma acotada al análisis; los binarios solo se almacenan e inventarían.
5. Se detectan enlaces de pull requests en la descripción y las historias.
6. Se sincronizan los metadatos y commits de cada PR en `data/pr`.
7. La tarea se vuelve a analizar únicamente cuando cambia `modified_at`.

Un fallo al actualizar un PR no invalida una tarea de Asana que ya esté correctamente sincronizada.

## Datos almacenados

Todo el conocimiento persistente está bajo `data/`, que debe permanecer fuera del control de versiones.

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
  asana/
    projects/
      <project-gid>/
        state.json
        tasks/
          <task-gid>/
            task-raw.json
            stories-raw.json
            attachments.json
            attachments/
            analysis.json
            status.json
  pr/
    propietario__repositorio/
      <numero-pr>.json
```

- `github-raw.json`: respuesta original de GitHub.
- `diff.patch`: diff completo.
- `diff-index.json`: índice de archivos, hunks, líneas y offsets.
- `analysis.json`: conocimiento estructurado generado por LM Studio.
- `status.json`: estado de digestión, intentos y último error.
- `stories-raw.json`: comentarios y eventos originales de Asana.
- `data/pr`: caché reutilizable de pull requests, commits y relaciones con tareas.

## Scripts

```powershell
npm start                            # inicia la aplicación
npm run dev                          # inicia Node en modo watch
npm run check                        # valida todos los archivos JavaScript
npm test                             # ejecuta la suite automatizada
npm run backfill:tags -- owner/repo  # incorpora tags Git a análisis existentes
```

Antes de entregar cambios se recomienda ejecutar:

```powershell
npm run check
npm test
```

## API local

Salvo los recursos estáticos y las rutas de autenticación, la API requiere una sesión válida.

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Crea una sesión autenticada. |
| `POST` | `/api/auth/logout` | Invalida la sesión actual. |
| `GET` | `/api/auth/session` | Comprueba si la sesión es válida. |
| `GET` | `/api/health` | Comprueba que el servidor responde. |
| `GET` / `PUT` | `/api/config` | Lee o guarda la configuración local. |
| `PUT` | `/api/report-instructions` | Guarda las instrucciones persistentes de informes. |
| `GET` | `/api/models` | Lista los modelos disponibles en LM Studio. |
| `GET` | `/api/github-repositories` | Lista los repositorios visibles para el token. |
| `GET` | `/api/asana-projects` | Lista los proyectos disponibles de Asana. |
| `GET` | `/api/asana-report-users` | Lista autores encontrados en historias de Asana. |
| `GET` | `/api/status` | Devuelve el estado global de sincronización. |
| `POST` | `/api/sync` | Inicia la sincronización de GitHub. |
| `POST` | `/api/asana/sync` | Inicia la sincronización de Asana y PR. |
| `POST` | `/api/chat` | Devuelve una respuesta de chat mediante SSE. |
| `POST` | `/api/reports/executive` | Genera el informe ejecutivo en PDF. |
| `POST` | `/api/reports/daily` | Genera el informe diario en PDF. |
| `GET` | `/api/asana/attachments/...` | Sirve un adjunto local autenticado. |

## Seguridad

- No compartas ni subas `.env`.
- Usa tokens con permisos mínimos y fecha de expiración.
- Considera `data/` información sensible: puede contener código, diffs, tareas y adjuntos.
- Los tokens nunca se envían al navegador.
- Las sesiones se guardan en memoria y se invalidan al reiniciar el proceso.
- La cookie es `HttpOnly`, `SameSite=Strict` y puede marcarse como `Secure`.
- Los intentos de acceso fallidos están limitados por IP.
- Si publicas la aplicación, utiliza un proxy inverso con HTTPS y configura `AUTH_COOKIE_SECURE=true`.
