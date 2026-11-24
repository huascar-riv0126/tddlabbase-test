# BDRamas

Aplicación de demostración para ejecutar pruebas TDD y registrar su relación con
ramas, commits y merges de Git. SQLite conserva una copia local; las ejecuciones
de pruebas se guardan en Neon al ejecutarlas y los commits/ramas/merges se
guardan al hacer `git push`.

## Inicio rápido

### Requisitos

- Node.js 20 y npm.
- Git disponible en el `PATH`.
- Una base PostgreSQL de Neon y su URL de conexión.

### Instalación

```powershell
npm install
```

### Configurar Neon

En `.env` configura la conexión a Neon:

```env
DATABASE_URL=postgresql://usuario:contraseña@host/base_de_datos?sslmode=require
```

1. Copia la cadena de conexión desde Neon y conserva `sslmode=require`.
2. No subas `.env` al repositorio. Está incluido en `.gitignore`.
3. Valida la conexión y las tablas:

```powershell
npm run test:neon
```

La base debe tener las tablas del esquema TDD proporcionado. El comando
`npm run db:init:remote` valida el esquema; no altera ni recrea las tablas.
`npm run test:app` guarda la ejecución en SQLite y en Neon. `git push` registra
en Neon el repositorio, las ramas, los commits y los merges. Si el guardado
remoto falla, el comando informa el error y conserva la copia local.

## Arquitectura

El flujo principal está dividido en estas responsabilidades:

- [`script/neonActivityStore.js`](script/neonActivityStore.js): valida el
  esquema compartido de Neon y guarda ejecuciones, ramas, commits y merges en
  transacciones.
- [`script/TDDLogBDAdapter.js`](script/TDDLogBDAdapter.js): nombre de adaptador
  compatible que reutiliza `TddStore` sin duplicar la lógica de persistencia.
- [`script/tddScript.js`](script/tddScript.js): ejecuta Jest, lee
  `script/report.json`, obtiene el contexto Git y guarda la ejecución en SQLite
  y Neon.
- [`script/commitScript.js`](script/commitScript.js): registra el commit actual
  y su rama.
- [`script/commit-tracker.js`](script/commit-tracker.js): registra commits desde
  hooks sin volver a ejecutar Jest.
- [`script/branch-tracker.js`](script/branch-tracker.js): registra la rama
  activa después de un checkout.
- [`script/merge-tracker.js`](script/merge-tracker.js): registra merges
  fast-forward y no-fast-forward desde el hook `post-merge`.
- [`script/gitContext.js`](script/gitContext.js): encapsula las consultas a Git
  y devuelve un contexto normalizado.
- [`script/test-neon.js`](script/test-neon.js): verifica que
  `DATABASE_URL` sea válida y que las tablas TDD estén disponibles.
- [`script/test-neon-integration.js`](script/test-neon-integration.js): ejecuta
  validaciones reales contra Neon, incluyendo confirmación y rollback.
- [`script/test-helpers/mockPool.js`](script/test-helpers/mockPool.js): pool en
  memoria utilizado por las pruebas unitarias; no conecta con Neon.

La aplicación usa ES modules (`"type": "module"` en `package.json`) y todas las
operaciones de base de datos deben tratarse como asíncronas con `await`.

## Modelo de datos

El registro en Neon utiliza estas tablas del esquema `public`:

| Tabla | Propósito |
|---|---|
| `tdd_repository` | Repositorios por propietario, nombre y URL. |
| `tdd_branch` | Ramas relacionadas con el repositorio y su commit de origen. |
| `tdd_commit` | Commits, padre, rama, autor, mensaje y fecha. |
| `tdd_merge` | Relaciones de merge entre ramas y commits. |
| `tdd_execution` | Resultado de cada ejecución de pruebas. |
| `tdd_schema_migration` | Versionado auxiliar del esquema. |

Los commits se actualizan por SHA; las ramas se buscan por repositorio y nombre
antes de insertarlas. Cada ejecución se inserta como un registro nuevo. El
esquema suministrado usa columnas `date` para algunas fechas, por lo que Neon
conserva el día pero no la hora exacta de ejecuciones, ramas y merges.

### Flujo de una ejecución real

`npm run test:app` realiza este flujo:

1. Carga la configuración desde `.env`.
2. Inicializa SQLite para conservar una copia local.
3. Ejecuta Jest con salida JSON en `script/report.json`.
4. Obtiene rama, commit, padres y estado del árbol mediante Git.
5. Guarda el commit y la rama, si existen.
6. Guarda los totales de pruebas localmente y los envía a `public.tdd_execution`
   en Neon.
7. Cierra las conexiones.

El hook `pre-push` registra ramas, commits y merges. No vuelve a insertar las
ejecuciones que ya se guardaron al correr las pruebas.

Los hooks `post-checkout`, `post-commit` y `post-merge` registran,
respectivamente, la rama activa, el commit y los merges. Para
evitar que un fallo de seguimiento bloquee una operación de Git durante una
ejecución controlada, puede usarse `HUSKY_SKIP_TRACK=1`.

Si la ejecución se realiza fuera de un repositorio Git, se guarda igualmente la
ejecución, pero `commit_sha` queda en `NULL`. Un fallo de Jest se registra como
resultado de pruebas fallidas; un fallo de persistencia se informa mediante
`console.error`.

## Comandos

| Comando | Uso |
|---|---|
| `npm start` | Inicia el servidor de desarrollo de Parcel. |
| `npm test` | Ejecuta las pruebas de la aplicación, del ejecutor TDD y del envío de ramas. |
| `npm run test:runner` | Comprueba cómo se registran las ejecuciones de Jest. |
| `npm run test:unit` | Alias explícito de las pruebas unitarias. |
| `npm run test:neon` | Comprueba la conexión y las tablas de Neon. |
| `npm run test:neon:integration` | Ejecuta integración real contra Neon solo con `RUN_NEON_INTEGRATION=1`. |
| `npm run test:app` | Ejecuta Jest y guarda el resultado localmente y en Neon. |
| `npm run db:sync` | Envía ramas, commits y merges a Neon. |
| `npm run test:integration` | Ejecuta la comprobación real de Neon. |
| `npm run test:e2e` | Ejecuta el flujo real de la aplicación. |
| `npm run test:smoke` | Ejecuta la suite rápida de smoke tests. |
| `npm run test:coverage` | Ejecuta Jest con cobertura y umbral global del 85%. |
| `npm run lint` | Ejecuta ESLint. |
| `npm run build` | Genera el build de Parcel. |

### Qué comando usar

- Para desarrollar o modificar código: `npm test`.
- Para confirmar credenciales y disponibilidad de Neon: `npm run test:neon`.
- Para registrar una ejecución asociada al commit actual: `npm run test:app`.
- Para validar cobertura antes de entregar cambios: `npm run test:coverage`.

Las pruebas unitarias no deben depender de la red ni insertar datos reales. Usa
`makePool()` de `script/test-helpers/mockPool.js` en nuevas pruebas de
persistencia. Usa `test:app` para registrar las pruebas de la aplicación.

La prueba específica de integración con Neon es opcional.
Para ejecutarla de forma explícita, configura `DATABASE_URL` y
`RUN_NEON_INTEGRATION=1`; el script crea registros temporales y los elimina al
finalizar.

## Consultar datos en Neon

Desde el SQL Editor de Neon puedes consultar el historial:

```sql
SELECT *
FROM tdd_execution
ORDER BY executed_at DESC;

SELECT *
FROM tdd_commit
ORDER BY committed_at DESC NULLS LAST;

SELECT *
FROM tdd_branch
ORDER BY created_at DESC;

SELECT *
FROM tdd_merge
ORDER BY merged_at DESC;
```

Para relacionar una ejecución con su commit:

```sql
SELECT
  e.id,
  e.executed_at,
  e.tests_total,
  e.tests_passed,
  e.tests_failed,
  e.commit_sha,
  b.name AS branch,
  r.owner,
  r.repos_name,
  c.message
FROM tdd_execution AS e
LEFT JOIN tdd_commit AS c ON c.sha = e.commit_sha
LEFT JOIN tdd_branch AS b ON b.id = c.branch_id
LEFT JOIN tdd_repository AS r ON r.id = b.repo_id
ORDER BY e.executed_at DESC;
```

## Guía para nuevos desarrolladores

### Añadir una operación de persistencia

1. Añade el método asíncrono en `NeonActivityStore`.
2. Llama a `await this.initialize()` al inicio del método.
3. Usa consultas parametrizadas (`$1`, `$2`, etc.); no interpolar valores
   directamente en SQL.
4. Mantén las consultas alineadas con el esquema compartido de Neon; la
    inicialización valida las tablas y no las recrea.
5. Prueba el método con un pool simulado y añade una prueba de integración solo
    cuando sea necesario validar PostgreSQL real.
6. Asegúrate de cerrar el store en `afterEach` o `finally`.

### Añadir o modificar el flujo de pruebas

- Mantén la ejecución y la persistencia separadas en `tddScript.js`.
- Conserva el código de salida de Jest: `0` significa éxito y cualquier otro
  valor indica fallo.
- No sustituyas `console.error` por `console.log` para errores.
- No uses credenciales reales dentro de pruebas, mocks o código fuente.
- Si una prueba necesita simular un error, silencia la salida solo dentro de esa
  prueba y restaura los mocks después.

### Cierre del pool

`NeonActivityStore.close()` es idempotente. Aun así, el código que crea un store debe
cerrarlo en un bloque `finally` para evitar conexiones abiertas:

```js
const store = new NeonActivityStore();

try {
  await store.initialize();
  // Operaciones de persistencia.
} finally {
  await store.close();
}
```

## Solución de problemas

### Configuración de Neon

Verifica que `.env` esté en la raíz del proyecto y que la variable se llame
exactamente `DATABASE_URL`. No incluyas espacios alrededor del signo `=`.

### Error de conexión SSL

Usa la cadena proporcionada por Neon y conserva `sslmode=require` si aparece en
ella. Comprueba también que el endpoint de Neon esté activo.

### Las pruebas unitarias intentan escribir en Neon

La suite unitaria usa `MockPool`; solo `npm run test:app` y `git push` escriben
en Neon.

### No aparecen datos nuevos

Confirma que `.env` contiene `DATABASE_URL` y que no define
`TDD_BRANCHES_URL` (esa variable activa el transporte HTTP heredado solo si no
hay `DATABASE_URL`). Las ejecuciones aparecen en `tdd_execution` al correr
pruebas; los commits y merges aparecen al completar `git push`.

### Mensajes `fatal:` de Git

Las consultas Git se ejecutan con `stderr` capturado por
`script/gitContext.js`. Los casos de error esperados se validan en pruebas sin
mostrar el ruido de Git en la consola.

## Validación antes de entregar cambios

Ejecuta como mínimo:

```powershell
npm test
npm run test:coverage
npm run lint
git diff --check
```

Si el cambio modifica la conexión o el esquema, añade también:

```powershell
npm run test:neon
```

`npm run test:app` y `git push` escriben datos en Neon; las pruebas unitarias no.
