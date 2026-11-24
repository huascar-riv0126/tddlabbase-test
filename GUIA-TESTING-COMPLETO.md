# Guía de testing completo (BDRamas / Neon)

Las ejecuciones de Jest se escriben en Neon al terminar la prueba. El hook
`pre-push` guarda en Neon los repositorios, ramas, commits y merges publicados.
SQLite conserva una copia local de la actividad.

## Configurar Neon

1. Copia a `.env` la cadena PostgreSQL de Neon como `DATABASE_URL`, conservando
   `sslmode=require`. No configures `TDD_BRANCHES_URL` si quieres escritura
   directa en Neon.
2. Instala dependencias y verifica la conexión y las tablas:

   ```powershell
   npm ci
   npm run test:neon
   ```

3. Si necesitas enviar un commit ya existente, ejecuta
   `npm run db:sync -- --commit <SHA>`. Para los pushes normales, el hook se
   ejecuta automáticamente.

El esquema debe estar creado en `public` de acuerdo con la definición de Neon
del proyecto. `npm run db:init:remote` valida las columnas requeridas; no
modifica ni recrea la base.

> Entorno de referencia: Windows + PowerShell. Ajusta comandos si usas otro shell.

---

## 1. Prerrequisitos

Abre PowerShell en una carpeta de trabajo. Comprueba que tienes Git, Node.js 20 y npm.

```powershell
git --version
node --version
npm --version
```

Clona la rama de Caleb que contiene la entrega. Si ya tienes este repositorio clonado, entra en su carpeta y usa `git switch feat/registrar-actividad-tdd-en-push` en lugar de volver a clonarlo.

```powershell
git clone --branch feat/registrar-actividad-tdd-en-push https://github.com/CalebBav234/BDRamas-4.0.4.git
cd BDRamas-4.0.4
git branch --show-current
npm ci
git config --get core.hooksPath
```

La rama debe ser `feat/registrar-actividad-tdd-en-push`. La instalación activa Husky y el último comando debe mostrar `.husky/_`.

## 2. Ejecutar las pruebas y compilar

1. **Ejecuta la suite habitual y genera la compilación.**

   ```powershell
   npm test
   npm run build
   ```

   En la entrega del sprint pasan 28 pruebas (1 de la aplicación, 17 del ejecutor TDD y 10 de ramas y envío). Parcel genera `dist/index.html`.

2. **Para repetir únicamente la prueba de ramas y del POST**, ejecuta el siguiente comando. La suite crea su propio servidor HTTP y remoto Git temporales. Cubre el primer push, ambos tipos de merge y el reintento tras un HTTP 503. Puedes correrla incluso con la API del equipo apagada.

   ```powershell
   npm run test:branches
   ```

3. **(Opcional) Cobertura de app**
   ```powershell
   npm run test:coverage
   ```
   - Esperado: reporte generado en `coverage/` para el alcance configurado en `jest.config.js`.

---

## 3. Verificar BD local SQLite (esquema e inicialización)

1. **Inicializar esquema local**
   ```powershell
   npm run db:init:local
   ```
   - Esperado: mensaje indicando esquema SQLite inicializado en `.tddlab\tddlab.db`.

2. **Comprobar que el archivo existe**
   ```powershell
   Test-Path .\.tddlab\tddlab.db
   Get-ChildItem .\.tddlab -ErrorAction SilentlyContinue
   ```
   - Esperado: `True` y el archivo `tddlab.db` presente. En esta rama el archivo predeterminado ya está versionado. La prueba de la API usa un archivo separado.

3. **Inspeccionar tablas y datos (sin `sqlite3` CLI, usando Node + better-sqlite3)**
   ```powershell
   node -e "const Database=require('better-sqlite3');const db=new Database('.tddlab/tddlab.db',{readonly:true});console.log(db.prepare('SELECT name FROM pragma_table_list ORDER BY name').all());db.close()"
   ```
   - Esperado: tablas como `tdd_branch`, `tdd_commit`, `tdd_merge`, `tdd_execution`, `tdd_schema_migration`.

4. **Idempotencia**
   - Ejecuta de nuevo `npm run db:init:local`.
   - Esperado: finaliza sin error y sin duplicar/corromper el esquema.

---

## 4. Verificar hooks y tracking local (pre-commit / post-commit / checkout)

Los hooks escriben en la **BD local SQLite** (salvo que se omitan). Para no interferir con tu trabajo, usa una rama de prueba.

1. **Crear rama de prueba**
   ```powershell
   git checkout -b test/db-hooks-verification
   ```

2. **Probar pre-commit (registro antes del commit)**
   - Crea un cambio trivial (no lo subas):
     ```powershell
     "test $(Get-Date -Format o)" | Out-File -Encoding utf8 .tddlab-hook-test.tmp
     git add .tddlab-hook-test.tmp
     git commit -m "test: verificar pre-commit db"
     ```
   - Esperado: el commit se crea (o el hook no lo bloquea). El hook `pre-commit` ejecuta `script/pre-commit-tracker.js` y registra contexto/rama en SQLite.

3. **Verificar registro en SQLite tras commit**
   ```powershell
   node -e "const Database=require('better-sqlite3');const db=new Database('.tddlab/tddlab.db',{readonly:true});console.log('branches',db.prepare('SELECT * FROM tdd_branch').all());console.log('commits',db.prepare('SELECT sha,branch,message FROM tdd_commit ORDER BY rowid DESC LIMIT 5').all());db.close()"
   ```
   - Esperado: aparece la rama `test/db-hooks-verification` y el commit reciente con su SHA real y mensaje.

4. **Probar post-checkout (registro de rama al cambiar)**
   ```powershell
   git checkout -
   git checkout test/db-hooks-verification
   ```
   - Repite la consulta del paso 3.
   - Esperado: la rama sigue/queda registrada en `tdd_branch`.

5. **Omitir tracking (comportamiento de hooks)**
   - En PowerShell (solo sesión actual):
     ```powershell
     $env:HUSKY_SKIP_TRACK = "1"
     git commit --allow-empty -m "test: skip tracking"
     Remove-Item Env:HUSKY_SKIP_TRACK
     ```
   - Esperado: el commit se realiza; no debe fallar por BD. (Úsalo solo para pruebas controladas).

6. **Limpieza del commit/archivo de prueba (opcional, si no lo necesitas)**
   - Elimina el archivo temporal y ajusta la rama según tu flujo (evita reescribir historial compartido). Puedes borrar la rama de prueba al finalizar:
     ```powershell
     git checkout <tu-rama-original>
     git branch -D test/db-hooks-verification
     ```

---

## 5. Verificar registro de merges (incluye fast-forward)

Usa un repo/ramas locales de prueba.

1. **Preparar base**
   ```powershell
   git checkout -b test/merge-local-base
   echo "base" > merge-test.txt; git add merge-test.txt; git commit -m "test: base merge"
   ```

2. **Merge no fast-forward**
   ```powershell
   git checkout -b test/merge-feature
   echo "feature" >> merge-test.txt; git add merge-test.txt; git commit -m "test: feature change"
   git checkout test/merge-local-base
   git commit --allow-empty -m "test: mainline change"
   git merge --no-ff test/merge-feature -m "test: merge no-ff"
   ```
   - Consulta:
     ```powershell
     node -e "const Database=require('better-sqlite3');const db=new Database('.tddlab/tddlab.db',{readonly:true});console.log(db.prepare('SELECT source_branch,target_branch,source_commit_sha,merge_commit_sha,is_fast_forward,merged_at FROM tdd_merge ORDER BY id DESC LIMIT 5').all());db.close()"
     ```
   - Esperado: un registro con `is_fast_forward = 0` (o equivalente) y ramas/SHAs coherentes.

3. **Merge fast-forward**
   ```powershell
   git checkout -b test/ff-feature test/merge-local-base
   echo "ff" > ff.txt; git add ff.txt; git commit -m "test: ff feature"
   git checkout test/merge-local-base
   git merge test/ff-feature
   ```
   - Repite la consulta de `tdd_merge`.
   - Esperado: registro con `is_fast_forward = 1` (según detección por reflog/ORIG_HEAD) para el merge fast-forward.

4. **Limpieza**: vuelve a tu rama de trabajo y elimina ramas/archivos temporales si corresponde.

---

## 6. Verificar la sincronización con Neon

1. Verifica la conexión y confirma que `.env` contiene `DATABASE_URL`:

   ```powershell
   npm run test:neon
   ```

2. Ejecuta las pruebas. La ejecución se inserta en Neon y queda asociada al SHA
   de `HEAD` cuando se ejecuta dentro de un repositorio Git:

   ```powershell
   npm run test:app
   git rev-parse HEAD
   ```

3. Haz un push normal. Si la escritura en Neon falla, el hook aborta el push;
   corrige la conexión y vuelve a intentarlo:

   ```powershell
   git push
   ```

4. Comprueba los datos desde el SQL Editor de Neon:

   ```sql
   SELECT e.id, e.executed_at, e.tests_total, e.tests_passed, e.tests_failed,
          c.sha, c.message, b.name AS branch, r.owner, r.repos_name
   FROM public.tdd_execution AS e
   LEFT JOIN public.tdd_commit AS c ON c.sha = e.commit_sha
   LEFT JOIN public.tdd_branch AS b ON b.id = c.branch_id
   LEFT JOIN public.tdd_repository AS r ON r.id = b.repo_id
   ORDER BY e.id DESC
   LIMIT 20;
   ```

Las ejecuciones se envían al correr Jest; el push guarda el repositorio, las
ramas, los commits y los merges. Reintentar el push no vuelve a insertar la
ejecución. Si el envío de una prueba falla, la copia local se conserva y se
puede reintentar ejecutando de nuevo `npm run test:app`.

---

## 8. Verificaciones de seguridad (checklist)

- [ ] `.env` no está versionado (`git status` limpio respecto a `.env`).
- [ ] `.env.example` no contiene secretos reales.
- [ ] La base de la demostración `.tddlab/prueba-api.db` queda fuera del commit.
- [ ] Hooks pueden omitirse solo con `HUSKY_SKIP_TRACK=1` / `SKIP_DB_SYNC=1` de forma consciente.

---

## 9. Solución de problemas

| Síntoma | Causa probable | Acción |
|---|---|---|
| Solo quiero repetir las pruebas del ejecutor TDD | `npm test` incluye tres grupos de pruebas | Ejecuta `npm run test:runner` |
| Error de parseo JSON/BOM en `package.json` | Archivo con BOM | Re-guardar `package.json` como UTF-8 sin BOM |
| Pre-push aborta | Neon está inaccesible o rechazó los datos | Comprueba `DATABASE_URL` y repite `git push` |
| No aparecen datos en SQLite | Hook omitido o commit fuera de repo | Verificar `HUSKY_SKIP_TRACK`, estar en repo Git y repetir operación |
| No aparecen ejecuciones en Neon | Falta `DATABASE_URL` o falló la conexión durante Jest | Revisa el error y vuelve a ejecutar `npm run test:app` |
| `better-sqlite3` falla al instalar/cargar | Binario nativo incompatible | Reinstalar dependencias (`npm ci`/`npm install`) con toolchain compatible en Windows |

---

## 10. Resultado esperado (resumen)

- `npm test` ejecuta la aplicación, el ejecutor TDD y las pruebas de ramas y envío.
- `npm run db:init:local`: crea/actualiza `.tddlab/tddlab.db` con el esquema requerido.
- Commits/checkouts/merges (incl. fast-forward) en ramas de prueba: generan/actualizan registros en SQLite (`tdd_branch`, `tdd_commit`, `tdd_merge`).
- El hook guarda commits y merges en Neon antes de publicar la rama.
- El archivo `.env` y la base SQLite de la demostración quedan fuera del commit.
