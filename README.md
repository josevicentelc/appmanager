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

Pendiente para una fase posterior: chat RAG con los modos Ejecutivo y Developer.

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
          analysis.json
          status.json
```

- `config.json`: preferencias guardadas desde la interfaz.
- `state.json`: estado de sincronización del repositorio, última comprobación y métricas.
- `github-raw.json`: respuesta original de la API GitHub.
- `diff.patch`: diff completo del commit.
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
npm run backfill:tags -- owner/repo  # añade tags Git a análisis existentes
```

## API local

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/health` | Comprobación básica del servidor. |
| `GET` / `PUT` | `/api/config` | Lee o guarda la configuración local. |
| `GET` | `/api/models` | Lista los modelos disponibles en LM Studio. |
| `GET` | `/api/github-repositories` | Lista los repositorios visibles para el token. |
| `GET` | `/api/status` | Estado global y progreso por repositorio. |
| `POST` | `/api/sync` | Inicia una sincronización manual. |

## Seguridad

- Nunca compartas ni subas `.env`.
- Usa un token con permisos mínimos y fecha de expiración.
- `data/` puede contener código, diffs y metadatos sensibles; está ignorado por Git a propósito.
- La aplicación no expone el token al frontend.
