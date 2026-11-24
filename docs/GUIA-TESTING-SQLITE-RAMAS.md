# Guia de Testing - SQLite con Soporte de Ramas Git (4 tablas)

**Sistema:** TDDLabBaseProject  
**Componente:** Sistema de logging y registro de ejecuciones TDD con SQLite  
**Versión:** 2.0.0  
**Objetivo:** Permitir que cualquier integrante del equipo valide la implementación de persistencia SQLite con soporte de ramas Git, reducida a 4 tablas esenciales.

---

## 1. Portada y objetivo

Esta guía documenta cómo ejecutar y validar el sistema de logging y registro de ejecuciones de TDDLab basado en SQLite con soporte de ramas Git, utilizando exactamente 4 tablas:

- `tdd_branch` — guarda las ramas de trabajo
- `tdd_commit` — guarda las ejecuciones de los commits
- `tdd_merge` — mergea entre ramas
- `tdd_execution` — ejecución de pruebas

El objetivo es verificar que:

- Cada ejecución de pruebas (`npm test`) se registra en `tdd_execution` con un `id` único (autoincremental).
- Los commits se identifican por su SHA real de Git (nunca por el literal `HEAD`).
- Las ejecuciones se asocian al commit correspondiente a través de `commit_sha`.
- Los merges entre ramas se registran en `tdd_merge` con `source_branch`, `target_branch`, `source_commit_sha`, `merge_commit_sha`, `is_fast_forward` y `merged_at`.
- El historial se preserva al cambiar de rama y en detached HEAD.
- No se pierde información ante fallos de infraestructura.

---

## 2. Requisitos previos

Antes de ejecutar las pruebas, asegúrate de tener instalado:

| Herramienta | Versión mínima | Propósito |
|-------------|---------------|-----------|
| Node.js | 20.x | Entorno de ejecución |
| npm | 10.x | Gestor de paquetes |
| Git | 2.x | Control de versiones |

El proyecto utiliza **ES Modules** (`"type": "module"` en `package.json`).

---

## 3. Instalación

Clona el repositorio e instala las dependencias:

```bash
git clone <tu-fork>
cd TDDLabBaseProject
npm ci
```

Durante la instalación se:

1. Descarga e instala `better-sqlite3` (dependencia nativa para SQLite).
2. Instala las dependencias de desarrollo (Jest, ESLint, Husky, etc.).
3. Ejecuta `postinstall` que inicializa Git y configura Husky.

Verifica la instalación:

```bash
node --version      # Debe mostrar v20.x
npm --version       # Debe mostrar 10.x+
```

---

## 4. Estructura de almacenamiento

El sistema utiliza **SQLite** como almacén local-first. La base de datos se crea automáticamente en:

```text
.tddlab/
  tddlab.db         # Base de datos SQLite principal
  tddlab.db-wal     # Archivo de registro anticipado (WAL)
  tddlab.db-shm     # Memoria compartida (WAL)
```

El directorio `.tddlab/` está ignorado por Git (`.gitignore`), por lo que cada clon o worktree tiene su propia base de datos y no hay conflictos entre ramas.

### Las 4 tablas del esquema

| Tabla | Propósito | Clave primaria |
|-------|-----------|----------------|
| `tdd_branch` | Guarda las ramas de trabajo | `name` |
| `tdd_commit` | Guarda las ejecuciones de los commits | `sha` |
| `tdd_merge` | Mergea entre ramas | `id` (autoincremental) |
| `tdd_execution` | Ejecución de pruebas | `id` (autoincremental) |

### Columnas por tabla

**`tdd_branch`**

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `name` | TEXT PK | Nombre de la rama |
| `fork_commit_sha` | TEXT | Commit desde que nació la rama |
| `created_at` | TEXT | Cuando se registró en la base |

**`tdd_commit`**

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `sha` | TEXT PK | Hash del commit, es único |
| `parent_sha` | TEXT | Primer padre, puede ser NULL en HEAD descoplado |
| `branch` | TEXT | Rama donde se hizo el commit |
| `author` | TEXT | Autor del commit |
| `message` | TEXT | Mensaje del commit |
| `committed_at` | TEXT | Fecha del commit |

**`tdd_merge`**

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Identificador interno |
| `source_branch` | TEXT NOT NULL | Rama que se mergeó |
| `target_branch` | TEXT NOT NULL | Rama que recibió el merge |
| `source_commit_sha` | TEXT NOT NULL | Commit de rama origen que entró en el merge |
| `merge_commit_sha` | TEXT NOT NULL | Commit en el que ocurrió el merge |
| `is_fast_forward` | INTEGER NOT NULL DEFAULT 0 | Si fue fast-forward |
| `merged_at` | TEXT NOT NULL | Fecha del merge |

**`tdd_execution`**

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | INTEGER PK AUTOINCREMENT | Identificador interno |
| `commit_sha` | TEXT | Commit al que pertenece |
| `tests_total` | INTEGER DEFAULT 0 | Total de pruebas |
| `tests_passed` | INTEGER DEFAULT 0 | Cantidad de pruebas exitosas |
| `tests_failed` | INTEGER DEFAULT 0 | Cantidad de pruebas erróneas |
| `executed_at` | TEXT NOT NULL | Fecha de la ejecución |

---

## 5. Comandos de testing

Todos los comandos están definidos en `package.json`. Ejecútalos desde la raíz del proyecto.

| Comando | Objetivo | Qué ejecuta | Código de salida |
|---------|----------|-------------|------------------|
| `npm test` | Ejecución de pruebas + registro | `node ./script/tddScript.js` (corre Jest y registra en SQLite) | 0 si las pruebas pasan, 1 si fallan |
| `npm run test:unit` | Pruebas unitarias | Jest sobre `database.test.js`, `persistence.test.js` | 0 si todas pasan |
| `npm run test:integration` | Pruebas de integración | Jest sobre `integration-sqlite.test.js`, `branch-support.test.js` | 0 si todas pasan |
| `npm run test:e2e` | Pruebas end-to-end | Jest sobre `branch-support.test.js` (flujo real Git + SQLite) | 0 si todas pasan |
| `npm run test:smoke` | Smoke tests | Jest sobre `smoke.test.js` (verificación rápida de funcionalidad esencial) | 0 si todas pasan |
| `npm run test:coverage` | Pruebas con cobertura | Jest con informe de cobertura y umbrales | 0 si pasa y cobertura ≥85% |
| `npm run lint` | Análisis estático | ESLint sobre todo el proyecto | 0 si no hay errores |
| `npm run build` | Build de Parcel | `parcel build index.html` | 0 si compila |

**No ejecutes comandos que no estén listados aquí.**

### Interpretación de errores

| Síntoma | Causa probable | Solución |
|---------|---------------|----------|
| `Cannot find module 'better-sqlite3'` | Dependencia no instalada | Ejecuta `npm ci` |
| `SQLITE_CANTOPEN` | No se puede crear `.tddlab/` | Verifica permisos de escritura en la carpeta del proyecto |
| `GitContextError: Not a git repository` | No estás dentro de un repo Git | Ejecuta los comandos desde la raíz del repositorio |
| `Jest: coverage threshold not met` | Cobertura por debajo del 85% | Añade más pruebas o revisa el código no cubierto |
| `git checkout main: pathspec did not match` | Rama por defecto es `master` no `main` | Usa `git branch --show-current` para verificar |

---

## 6. Pruebas unitarias

Validan los módulos de persistencia y el contexto Git de forma aislada, usando bases de datos en memoria (`:memory:`).

**Archivos:**

- `script/__tests__/database.test.js` — Inicialización, esquema de 4 tablas, migración, CRUD de ramas/commits/merges/ejecuciones, consultas por commit.
- `script/__tests__/persistence.test.js` — `getLastExecutionId` sobre SQLite, IDs autoincrementales únicos, FK de commit_sha, consultas por commit y por id.

**Ejecutar:**

```bash
npm run test:unit
```

**Qué validan:**

- Inicialización de SQLite y creación del esquema (4 tablas: `tdd_branch`, `tdd_commit`, `tdd_merge`, `tdd_execution`).
- Foreign keys habilitadas (`PRAGMA foreign_keys = ON`).
- Migración uno-shot que elimina tablas antiguas (`tdd_repository`, `tdd_commit_parent`, `tdd_run_failures`, `tdd_event_log`, `tdd_schema_migration`) al crear el esquema nuevo.
- Inserción y lectura de ramas, commits, merges y ejecuciones.
- `id` autoincremental único por ejecución (sin colisiones).
- Asociación ejecución ↔ commit a través de `commit_sha`.
- `commit_sha` puede ser `NULL` para ejecuciones manuales fuera de Git.
- Migración idempotente (no borra datos en aperturas posteriores).

---

## 7. Pruebas de integración

Validan la interacción real entre `tddStore.js`, `tddScript.js`, `gitContext.js`, `commitScript.js` y `commit-tracker.js` usando SQLite real en archivos temporales.

**Archivo:**

- `script/__tests__/integration-sqlite.test.js`

**Ejecutar:**

```bash
npm run test:integration
```

**Qué validan:**

- Persistencia en archivo `.tddlab/tddlab.db` (sobrevive al cierre de la conexión).
- Registro integrado: commit → rama → ejecución.
- Asociación ejecución ↔ commit a través de `commit_sha`.
- Detección de rama y SHA de commit desde Git real.
- Prevención de duplicados (`id` autoincremental PK).

---

## 8. Pruebas E2E

Recorren el flujo completo con Git y SQLite reales en un repositorio temporal aislado (no modifica el historial del fork).

**Archivo:**

- `script/__tests__/branch-support.test.js`

**Escenarios cubiertos:**

| Escenario | Qué valida |
|-----------|------------|
| Dos ramas independientes | Ejecuciones diferenciadas por commit, `id` únicos |
| Merge commit | Registro en `tdd_merge` con `source_branch`, `target_branch`, `source_commit_sha`, `merge_commit_sha`, `is_fast_forward` |
| Cambio de rama | Ejecuciones preservadas al cambiar de rama, no hay contaminación entre commits |
| Detached HEAD | `branch` NULL en `tdd_commit`, SHA registrado correctamente |
| Ejecución fallida | Diferenciación entre fallo de prueba y fallo de infraestructura |

**Ejecutar:**

```bash
npm run test:e2e
```

---

## 9. Smoke tests

Pruebas rápidas que verifican que la funcionalidad esencial está operativa. Usan una base temporal y no modifican el historial del repositorio.

**Archivo:**

- `script/__tests__/smoke.test.js`

**Comprobaciones (10):**

1. Node.js disponible.
2. Dependencia SQLite (`better-sqlite3`) importable.
3. SQLite inicializable.
4. Base de datos abrible.
5. Esquema existente (tablas `tdd_execution`, `tdd_commit`, `tdd_branch`, `tdd_merge`).
6. Inserción y consulta de registro temporal en `tdd_execution`.
7. Foreign keys habilitadas.
8. Git identificable dentro de un repositorio.
9. Módulo de persistencia responde correctamente (`upsertCommit`, `upsertBranch`, `insertExecution`, `recordMerge`, `getExecutionById`, `getExecutionsByCommit`, `getCommit`, `getBranch`, `getMerges`).
10. Conexiones cerradas sin errores.

**Ejecutar:**

```bash
npm run test:smoke
```

**Resultado esperado:** Todas las 10 comprobaciones pasan con código de salida 0.

---

## 10. Cobertura

El proyecto requiere una cobertura mínima del **85 %** en las cuatro métricas de Jest.

| Métrica | Umbral | Cómo medir |
|---------|--------|------------|
| Statements | 85 % | `npm run test:coverage` |
| Branches | 85 % | `npm run test:coverage` |
| Functions | 85 % | `npm run test:coverage` |
| Lines | 85 % | `npm run test:coverage` |

**Informes generados:**

- `coverage/lcov.info` — Formato LCOV para integración con herramientas de CI.
- `coverage/lcov-report/index.html` — Informe HTML navegable.
- `coverage/coverage-final.json` — Resumen en JSON.

**Umbral configurado en `package.json`:**

```json
"coverageThreshold": {
  "global": {
    "statements": 85,
    "branches": 85,
    "functions": 85,
    "lines": 85
  }
}
```

**Si la cobertura está por debajo del umbral:**

1. Identifica los archivos y ramas no cubiertos en el informe HTML.
2. Añade pruebas que cubran las rutas faltantes.
3. Vuelve a ejecutar `npm run test:coverage`.

---

## 11. Pruebas manuales

La siguiente matriz permite validación manual sin modificar el historial del repositorio.

| ID | Escenario | Pasos | Resultado esperado | Estado |
|----|-----------|-------|-------------------|--------|
| M1 | `npm test` registra ejecución | Ejecutar `npm test`, consultar SQLite | Nueva fila en `tdd_execution` | |
| M2 | `id` único | Ejecutar `npm test` dos veces, comparar `id` | IDs distintos y correlativos | |
| M3 | Cambio de rama | Crear rama, ejecutar `npm test`, cambiar a otra rama, ejecutar nuevamente | Ambas ejecuciones existen con sus respectivos `commit_sha` | |
| M4 | Commit con SHA real | Hacer `git commit`, ejecutar `npm test`, verificar `sha` en `tdd_commit` | `sha` es el SHA real de Git, no `'HEAD'` | |
| M5 | Merge entre ramas | Hacer `git merge`, verificar fila en `tdd_merge` | Fila con `source_branch`, `target_branch`, `source_commit_sha`, `merge_commit_sha`, `is_fast_forward` | |
| M6 | SQLite sin red | Desconectar red, ejecutar `npm test` | Ejecución registrada localmente sin error | |
| M7 | Informe de cobertura | Ejecutar `npm run test:coverage` | Informe HTML generado en `coverage/` | |
| M8 | Rama en `tdd_branch` | Crear rama, hacer commit, verificar fila en `tdd_branch` | `name` es el nombre de la rama, `fork_commit_sha` es el SHA del commit | |

---

## 12. Verificación de SQLite

Consultas SQL de diagnóstico para inspeccionar la base de datos:

```bash
# Abrir la base de datos
sqlite3 .tddlab/tddlab.db

# Listar tablas (deben ser exactamente 4 más tdd_schema_migration)
.tables

# Consultar ramas
SELECT name, fork_commit_sha, created_at FROM tdd_branch ORDER BY created_at DESC;

# Consultar commits
SELECT sha, parent_sha, branch, author, message, committed_at FROM tdd_commit ORDER BY committed_at DESC;

# Consultar merges
SELECT id, source_branch, target_branch, source_commit_sha, merge_commit_sha, is_fast_forward, merged_at FROM tdd_merge ORDER BY merged_at DESC;

# Consultar ejecuciones
SELECT id, commit_sha, tests_total, tests_passed, tests_failed, executed_at FROM tdd_execution ORDER BY executed_at DESC;

# Contar ejecuciones por commit
SELECT commit_sha, COUNT(*) as runs FROM tdd_execution GROUP BY commit_sha;

# Listar todas las ejecuciones con commit
SELECT e.id, e.commit_sha, c.message, e.tests_total, e.tests_passed, e.tests_failed, e.executed_at
FROM tdd_execution e
LEFT JOIN tdd_commit c ON e.commit_sha = c.sha
ORDER BY e.executed_at DESC;

# Identificar ejecuciones sin commit asociado
SELECT id, commit_sha FROM tdd_execution WHERE commit_sha IS NULL;

# Verificar integridad referencial
PRAGMA foreign_key_check;
```

Sal de `sqlite3` con `.quit` o `Ctrl+D`.

---

## 13. Troubleshooting

| Problema | Causa posible | Solución |
|----------|---------------|----------|
| `Error: Cannot find module 'better-sqlite3'` | Dependencia no instalada | `npm ci` |
| `SQLITE_CANTOPEN: unable to open database file` | Permisos de carpeta | Verifica escritura en la carpeta del proyecto |
| `GitContextError: Not a git repository` | No estás dentro de un repo Git | Ejecuta desde la raíz del repositorio |
| `Jest: coverage threshold not met` | Cobertura baja | Añade pruebas para las ramas no cubiertas |
| `git checkout main: pathspec did not match` | Rama por defecto es `master` | Usa `git branch --show-current` |
| `Error: emit() after close` | Conexión SQLite cerrada prematuramente | Reinicia el proceso de prueba |
| Cobertura de ramas baja | Condicionales no probados | Añade pruebas que cubran ambos caminos de los `if` |
| Tabla antigua aún existe (`tdd_repository`, etc.) | Base de datos creada con versión anterior del esquema | Elimina `.tddlab/tddlab.db` y vuelve a ejecutar las pruebas para aplicar la migración |

---

## 14. Criterios finales de aceptación

Antes de considerar la implementación lista, verifica:

- [ ] `npm ci` se completa sin errores.
- [ ] `npm test` registra una ejecución en `.tddlab/tddlab.db`.
- [ ] `npm run test:smoke` pasa las 10 comprobaciones.
- [ ] `npm run test:unit` pasa todas las pruebas unitarias.
- [ ] `npm run test:integration` pasa todas las pruebas de integración.
- [ ] `npm run test:e2e` pasa todas las pruebas E2E (ramas, merge, detached HEAD).
- [ ] `npm run test:coverage` alcanza ≥85 % en las cuatro métricas.
- [ ] `npm run lint` no reporta errores.
- [ ] `npm run build` compila sin errores.
- [ ] `tdd_execution` contiene filas con `id` único y autoincremental.
- [ ] `tdd_commit` contiene SHA reales de Git (no `'HEAD'`).
- [ ] `tdd_branch` contiene el nombre y `fork_commit_sha` de cada rama.
- [ ] `tdd_merge` contiene los merges entre ramas con `is_fast_forward`.
- [ ] Las ejecuciones se conservan al cambiar de rama (diferenciadas por `commit_sha`).
- [ ] No hay archivos `.db`, `.db-wal`, `.db-shm` versionados en Git.
- [ ] Las tablas antiguas (`tdd_repository`, `tdd_commit_parent`, `tdd_run_failures`, `tdd_event_log`) han sido eliminadas por la migración.

Cuando todos los criterios se cumplen, la implementación está correctamente validada.

---

## 15. Conclusión

La implementación de SQLite con soporte de ramas Git, reducida a 4 tablas (`tdd_branch`, `tdd_commit`, `tdd_merge`, `tdd_execution`), permite registrar de forma confiable cada ejecución de pruebas y commit en una base de datos local-first. El sistema es resistente a fallos de infraestructura, preserva el historial al cambiar de rama y soporta merges con múltiples padres a través de `tdd_merge`. Utiliza esta guía para validar cualquier cambio futuro en el sistema de logging.
