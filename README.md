# BDRamas

Aplicación de demostración para ejecutar pruebas TDD y registrar su relación con
ramas, commits y merges de Git. Los hooks registran la actividad en SQLite.
El hook pre-push envía la actividad con un POST a la API de ramas. El backend se encarga de la persistencia remota.

## Inicio rápido

### Requisitos

- Node.js 20 y npm.
- Git disponible en el `PATH`.
- La API de ramas en ejecución para registrar la actividad por HTTP.

### Instalación

```powershell
npm install
```

### Envío a la API de ramas

Para reproducir la prueba con Git, SQLite y el backend, sigue la [guía de testing paso a paso](GUIA-TESTING-COMPLETO.md#prueba-de-principio-a-fin-con-la-api).

En `.env` configura la dirección del backend:

```env
TDD_BRANCHES_URL=http://localhost:3000/api/TDDCycles/branches/branches
```

1. Haz el commit que quieres probar.
2. Ejecuta `npm run test:app` para guardar en SQLite el resultado asociado al SHA actual.
3. Ejecuta `git push`. El hook envía un solo JSON con el repositorio, las ramas, los commits con sus ejecuciones y los merges. Al confirmar la API, muestra los cuatro contadores.
4. Si la API está apagada o responde con un error, vuelve a levantarla y repite el push. Los datos se conservan en SQLite.

La URL del ejemplo es el destino predeterminado. Para enviar desde la terminal, ejecuta `npm run db:sync` en la rama activa. `npm run test:branches` prueba el envío con un servidor HTTP temporal y un remoto Git de prueba.

### Configuración opcional para las pruebas específicas de Neon

1. En el panel de Neon, copia la cadena de conexión PostgreSQL.
2. Crea un archivo `.env` en la raíz del proyecto:

```env
DATABASE_URL=postgresql://usuario:contraseña@host/base_de_datos?sslmode=require
```

3. No subas `.env` al repositorio. Está incluido en `.gitignore`.
4. Comprueba la conexión:

```powershell
npm run test:neon
```

La aplicación crea automáticamente las tablas e índices TDD cuando se ejecuta
`TddStore.initialize()`. No es necesario ejecutar un script SQL manual para la
instalación inicial.

## Arquitectura

El flujo principal está dividido en estas responsabilidades:

- [`script/tddStore.js`](script/tddStore.js): capa de persistencia. Crea el
  esquema, abre el `Pool` de PostgreSQL y expone operaciones asíncronas para
  ramas, commits, merges y ejecuciones.
- [`script/TDDLogBDAdapter.js`](script/TDDLogBDAdapter.js): nombre de adaptador
  compatible que reutiliza `TddStore` sin duplicar la lógica de persistencia.
- [`script/tddScript.js`](script/tddScript.js): ejecuta Jest, lee
  `script/report.json`, obtiene el contexto Git y guarda la ejecución en SQLite.
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

`TddStore` crea estas tablas en el esquema `public`:

| Tabla | Propósito |
|---|---|
| `tdd_schema_migration` | Registra la versión del esquema inicializada. |
| `tdd_branch` | Ramas observadas y su commit de origen. |
| `tdd_commit` | Commits, padres, rama, autor, mensaje y fecha. |
| `tdd_merge` | Relaciones de merge entre ramas y commits. |
| `tdd_execution` | Resultado de cada ejecución de pruebas. |

Las claves principales y las restricciones `ON CONFLICT` hacen que guardar de
nuevo el mismo commit o rama actualice sus metadatos en lugar de duplicarlos.
Cada ejecución se inserta como un registro nuevo.

### Flujo de una ejecución real

`npm run test:app` realiza este flujo:

1. Carga la configuración desde `.env`.
2. Inicializa SQLite para conservar la ejecución hasta el envío.
3. Ejecuta Jest con salida JSON en `script/report.json`.
4. Obtiene rama, commit, padres y estado del árbol mediante Git.
5. Guarda el commit y la rama, si existen.
6. Guarda los totales de pruebas y el código de salida en `tdd_execution`.
7. Cierra la conexión.

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
| `npm run test:app` | Ejecuta Jest y guarda el resultado en SQLite. |
| `npm run db:sync` | Envía la actividad por HTTP al endpoint de ramas. |
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
  c.branch,
  c.message
FROM tdd_execution AS e
LEFT JOIN tdd_commit AS c ON c.sha = e.commit_sha
ORDER BY e.executed_at DESC;
```

## Guía para nuevos desarrolladores

### Añadir una operación de persistencia

1. Añade el método asíncrono en `TddStore`.
2. Llama a `await this.initialize()` al inicio del método.
3. Usa consultas parametrizadas (`$1`, `$2`, etc.); no interpolar valores
   directamente en SQL.
4. Actualiza el esquema constante `SCHEMA` solo si la estructura realmente
   cambia.
5. Prueba el método con `makePool()` y añade una prueba de integración solo
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

`TddStore.close()` es idempotente. Aun así, el código que crea un store debe
cerrarlo en un bloque `finally` para evitar conexiones abiertas:

```js
const store = new TddStore();

try {
  await store.initialize();
  // Operaciones de persistencia.
} finally {
  await store.close();
}
```

## Solución de problemas

### Configuración de las pruebas opcionales de Neon

Verifica que `.env` esté en la raíz del proyecto y que la variable se llame
exactamente `DATABASE_URL`. No incluyas espacios alrededor del signo `=`.

### Error de conexión SSL

Usa la cadena proporcionada por Neon y conserva `sslmode=require` si aparece en
ella. Comprueba también que el endpoint de Neon esté activo.

### `npm test` intenta escribir en Neon

La suite unitaria usa `MockPool`. Revisa que la prueba no cree
`new TddStore()` sin un pool simulado; utiliza `new TddStore({ pool:
makePool() })`.

### No aparecen datos nuevos

`npm test` no escribe en la nube. Ejecuta `npm run test:app` y luego consulta
`tdd_execution` en SQLite. Ejecuta `npm run db:sync` para enviarla a la API.

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

No ejecutes `npm run test:app` automáticamente en CI o durante una prueba
unitaria: ese comando escribe datos en SQLite.
