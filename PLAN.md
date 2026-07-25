# Plan — Gestor local de conocimiento de repositorios GitHub

## Objetivo del MVP

Crear una aplicación Node.js con interfaz web que sincronice periódicamente el histórico de commits de repositorios de GitHub configurados, analice cada commit con un LLM local expuesto por LM Studio y guarde el resultado en archivos locales persistentes.

La primera versión debe permitir:

- Configurar y visualizar los repositorios y parámetros de sincronización.
- Sincronizar manualmente los repositorios.
- Comprobar cada cinco minutos si existen commits nuevos.
- Descargar los datos de cada commit, incluido su diff.
- Generar y guardar un JSON estructurado común para todos los commits.
- Consultar el estado de sincronización, trabajos pendientes y errores.

El chat RAG será la siguiente fase. Desde el inicio se conservarán datos suficientemente estructurados para soportarlo.

## Principios y restricciones

- GitHub objetivo: `github.com`.
- Autenticación: token personal mediante `GITHUB_TOKEN` en `.env`.
- Repositorios disponibles: descubiertos mediante la API de GitHub con el token configurado.
- Sin base de datos: el almacenamiento persistente será una carpeta local ignorada por Git.
- LLM: LM Studio mediante una API compatible con OpenAI.
- URL inicial de LM Studio: `http://192.168.10.206:1234`.
- Idiomas de interfaz y análisis: español e inglés.
- Niveles de conversación futuros: Ejecutivo y Developer.

## Arquitectura propuesta

```text
Frontend web
   │
   ├── Configuración y estado
   └── (fase posterior) Chat con selector Ejecutivo / Developer e idioma
   │
Backend Node.js
   ├── Servicio de configuración
   ├── Sincronizador GitHub (manual y cada 5 min)
   ├── Cola local de digestión de commits
   ├── Cliente LM Studio / OpenAI-compatible
   └── Almacén de archivos
        ├── configuración local
        ├── estado de repositorios
        └── commits crudos y analizados
```

## Configuración

### `.env`

El archivo contiene secretos y valores de arranque. No se expone al frontend ni se versiona.

```dotenv
GITHUB_TOKEN=github_pat_...
LMSTUDIO_BASE_URL=http://192.168.10.206:1234/v1
LMSTUDIO_MODEL=
DATA_DIRECTORY=./data
SYNC_INTERVAL_MINUTES=5
```

### Configuración modificable desde la interfaz

Como no se usará base de datos ni se debe editar `.env` desde el navegador, los cambios de la interfaz se guardarán en `data/config.json`, que estará ignorado por Git.

Configuración inicial editable:

- Lista de repositorios que deben sincronizarse, tomada del inventario disponible en GitHub.
- Fecha límite inicial para importar commits.
- Modelo de LM Studio seleccionado.
- Intervalo de sincronización (por defecto, 5 minutos).
- Idioma predeterminado (`es` o `en`).

El token procede siempre del `.env`; los repositorios seleccionados se guardan en la configuración local mediante la interfaz.

## Sincronización y digestión

1. Al iniciar, el servicio lee `.env` y la configuración local.
2. La interfaz consulta el inventario de repositorios disponible para el token en GitHub.
3. Ejecuta una comprobación de cada repositorio seleccionado al arrancar y cada cinco minutos.
4. Consulta los commits de la rama objetivo desde la última sincronización, sin volver a procesar SHA ya conocidos.
5. Obtiene para cada commit sus metadatos completos y diff desde la API de GitHub.
6. Guarda la respuesta original de GitHub como fuente cruda.
7. Envía al LLM el contexto del commit y solicita un JSON válido conforme al esquema común.
8. Valida el JSON generado y lo guarda junto al contenido crudo.
9. Actualiza el estado del repositorio y registra errores o commits pendientes.

Para evitar duplicados, el SHA será el identificador único de un commit por repositorio.

## Almacenamiento local

La carpeta `data/` estará incluida en `.gitignore`.

```text
data/
  config.json
  repositories/
    organizacion__repositorio-a/
      state.json
      commits/
        <sha>/
          github-raw.json
          diff.patch
          analysis.json
          status.json
```

Responsabilidad de cada archivo:

- `config.json`: preferencias modificables desde la interfaz.
- `state.json`: última sincronización correcta, último SHA observado, métricas y errores del repositorio.
- `github-raw.json`: respuesta original recibida de GitHub.
- `diff.patch`: diff completo tal como se descargó.
- `analysis.json`: documento estructurado y normalizado generado por el LLM.
- `status.json`: estado de análisis, intentos, último error y fechas de procesamiento.

## Esquema de análisis por commit

El backend validará el documento antes de guardarlo. El modelo deberá producir JSON sin Markdown.

```json
{
  "schemaVersion": 1,
  "repository": "organizacion/repositorio-a",
  "sha": "...",
  "commitDate": "2026-07-24T10:30:00Z",
  "author": {
    "name": "Nombre",
    "email": "autor@ejemplo.com",
    "githubLogin": "usuario"
  },
  "originalMessage": "fix: correct validation",
  "language": "es",
  "briefDescription": "Corrige la validación de entrada.",
  "tags": ["bugfix", "validation"],
  "changeSummary": "...",
  "inferredMotivation": {
    "text": "...",
    "confidence": "medium"
  },
  "technicalDetails": {
    "filesChanged": [],
    "keyChanges": [],
    "potentialImpact": [],
    "risksOrFollowUps": []
  }
}
```

El análisis será técnico y rico en contexto. En la fase de chat, el nivel Ejecutivo resumirá impacto, objetivo y evolución; el nivel Developer incluirá detalles técnicos, archivos, riesgos y decisiones.

## Interfaz del MVP

Pantallas iniciales:

1. **Estado**: lista de repositorios, última sincronización, número de commits procesados, pendientes y errores.
2. **Configuración**: fecha límite de importación, modelo LM Studio, intervalo, idioma y comprobación de conectividad con LM Studio.
3. **Sincronización**: botón para forzar la sincronización y visualización del progreso actual.

La interfaz de chat quedará planificada para una fase posterior e incluirá selectores de idioma y nivel (Ejecutivo/Developer).

## Gestión de errores

- Si GitHub falla, se conserva el estado anterior y se registra el error por repositorio.
- Si LM Studio no responde, el commit queda en estado `pending` y se reintenta en una sincronización posterior.
- Si el LLM devuelve JSON inválido, se guarda el error y se reintenta con un prompt de corrección limitado.
- Los reintentos deberán tener un máximo configurable para evitar bucles infinitos.
- La aplicación nunca debe perder el contenido crudo por un fallo de análisis.

## Decisiones pendientes

1. Formato definitivo de `GITHUB_REPOSITORIES`: lista simple o JSON con opciones por repositorio.
2. Alcance de ramas: solo rama por defecto (recomendado para el MVP) o todas las ramas.
3. Política de etiquetas: lista cerrada de categorías, etiquetas libres generadas por IA, o ambas.
4. Política de retención de diffs: conservarlos siempre (recomendado inicialmente) o limitar su tamaño/antigüedad.
5. Vista de estado: confirmar si forma parte del primer entregable junto a sincronización y configuración.
6. Selección de modelo: confirmar que se consultará automáticamente `GET /v1/models` en LM Studio.

## Fases posteriores

1. Chat RAG sobre los commits y resúmenes almacenados.
2. Respuestas adaptadas a Ejecutivo o Developer.
3. Búsqueda por repositorio, fechas, autor, etiquetas y contenido semántico.
4. Reanálisis de commits al cambiar de modelo o prompt.
5. Administración de repositorios desde la interfaz.
