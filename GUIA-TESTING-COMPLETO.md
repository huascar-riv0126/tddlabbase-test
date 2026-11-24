# Guía de testing completo (BDRamas / TDD tracking)

Si ya tienes BDRamas y TDDLab en la laptop de Caleb, sigue [Actualizar y reenviar el commit de Caleb](#actualizar-y-reenviar-el-commit-de-caleb). Para instalar desde cero, empieza por la sección 1.

## Actualizar y reenviar el commit de Caleb

El primer push de `0557321` llegó a GitHub con `--no-verify`. Estos pasos recuperan ese commit para la API y dejan preparado el envío automático en los próximos pushes. Usa PowerShell y los dos directorios que aparecen en el registro de la laptop.

**1. Actualiza el proyecto base.** Detén el servidor abierto con `Ctrl+C`. En una terminal ejecuta los siguientes comandos y continúa si cada uno termina correctamente.

```powershell
cd "$HOME\Downloads\BDRamas\BDRamas-4.0.4"
git switch feat/registrar-actividad-tdd-en-push
git pull --ff-only origin feat/registrar-actividad-tdd-en-push
npm.cmd ci
```

**2. Prepara el servidor del equipo.** La corrección incluida en esta rama se probó con TDDLab `6d990021`. El primer comando comprueba los parches y los aplica en la copia local del servidor. Se puede repetir. Si Git informa de un conflicto, detente y revisa los cambios locales del servidor.

```powershell
npm.cmd run api:preparar -- "$HOME\Downloads\tallerSoft\TDDLab"
cd "$HOME\Downloads\tallerSoft\TDDLab\server"
npm.cmd run db:migrar-ramas
npm.cmd run dev
```

Usa la configuración PostgreSQL **de desarrollo** de TDDLab (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` en el entorno del servidor o su archivo `.env`). Si es la primera instalación del servidor, ejecuta `npm.cmd ci` en `TDDLab\server` antes de la migración. La migración requiere permiso para crear y modificar las tablas TDD. Prepara una base vacía o actualiza el modelo UUID de TDDLab en una transacción. Si falla, revisa el error antes de iniciar el servidor. El proyecto base envía la actividad por HTTP.

**3. Reenvía el commit.** Mantén abierta la terminal que muestra `Server is running on port: 3000` y abre una segunda terminal.

```powershell
cd "$HOME\Downloads\BDRamas\BDRamas-4.0.4"
$env:TDD_BRANCHES_URL = "http://localhost:3000/api/TDDCycles/branches/branches"
npm.cmd run db:sync -- --commit 0557321
```

Busca `[pre-push] API:` y los cuatro contadores. En una base limpia se registra un commit con el mensaje `testing:pruebita`. Si no había ejecuciones de Jest guardadas para ese SHA, el contador de ejecuciones es cero. Puedes repetir el comando para comprobar que los contadores nuevos quedan en cero. Para probar el commit actualmente seleccionado y enviar su resultado, ejecuta `npm.cmd run test:app` y después `npm.cmd run db:sync`. En futuros commits basta con un `git push` normal para activar el envío.

Los dos parches y su aplicador se distribuyen desde BDRamas. [Esquema](docs/servidor-tddlab/01-esquema.patch) · [Guardado del lote](docs/servidor-tddlab/02-registro.patch)

> Entorno de referencia: Windows + PowerShell. Ajusta rutas/comandos si usas otro shell.

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

## 6. Verificar la sincronización pre-push

### Prueba de principio a fin con la API

Usa una misma ventana de PowerShell para los pasos 1 a 5. El último paso publica una rama de prueba en el remoto `origin` y necesita permiso de escritura. Para comprobar el flujo solo en local, basta con la sección 2.

1. **Selecciona el endpoint y una base SQLite de prueba.** El backend de TDDLab debe estar en ejecución en la máquina de la URL, con PostgreSQL configurado. Si el equipo te da una dirección distinta, sustituye la URL en la primera línea.

   ```powershell
   $env:TDD_BRANCHES_URL = "http://localhost:3000/api/TDDCycles/branches/branches"
   $env:SQLITE_DB_PATH = ".tddlab/prueba-api.db"
   npm run db:init:local
   ```

2. **Prepara una rama de destino y otra de trabajo.** El sufijo evita reutilizar ramas de demostraciones anteriores.

   ```powershell
   $id = Get-Date -Format "yyyyMMdd-HHmmss"
   $destino = "test/registro-api-$id"
   $origen = "test/cambio-api-$id"
   git switch -c $destino feat/registrar-actividad-tdd-en-push
   git switch -c $origen
   git commit --allow-empty -m "test: comprobar el registro de una ejecución"
   $sha = git rev-parse HEAD
   ```

3. **Ejecuta Jest en ese commit y consulta su fila en SQLite.** El SHA impreso debe coincidir con `$sha`. Con el sumador de esta entrega se espera 1 prueba aprobada y 0 fallidas.

   ```powershell
   npm run test:app
   $sha
   node -e "const db=require('better-sqlite3')(process.env.SQLITE_DB_PATH,{readonly:true}); console.table(db.prepare('SELECT commit_sha, tests_total, tests_passed, tests_failed FROM tdd_execution WHERE commit_sha = ?').all(process.argv[1])); db.close()" $sha
   ```

4. **Crea el merge y verifica el registro local.** Deben aparecer las dos ramas de este ejercicio y `is_fast_forward` debe valer `0`.

   ```powershell
   git switch $destino
   git merge --no-ff $origen -m "test: integrar la ejecución de prueba"
   node -e "const db=require('better-sqlite3')(process.env.SQLITE_DB_PATH,{readonly:true}); console.table(db.prepare('SELECT source_branch, target_branch, merge_commit_sha, is_fast_forward FROM tdd_merge WHERE merge_commit_sha = ?').all(process.argv[1])); db.close()" (git rev-parse HEAD)
   ```

5. **Publica y comprueba la respuesta.**

   ```powershell
   git push -u origin $destino
   git ls-remote --heads origin "refs/heads/$destino"
   git rev-parse HEAD
   ```

   El hook envía un único `POST` JSON con `repository`, `branches`, `commits` y `merges`. Dentro de cada commit van `commitedAt` y `tddExecutions`. Con la base preparada y las dos ramas nuevas, el recibo debe incluir **2 ramas, 2 commits, 1 merge y 1 ejecución**. Si ya se habían recibido datos, los contadores reflejan solo los registros nuevos. Busca la línea `[pre-push] API:` y comprueba que el SHA remoto coincide con `HEAD`. Para verificar la persistencia, consulta la base del backend con el SHA que guardaste en el paso 2.

   ```sql
   SELECT c.sha, e.tests_total, e.tests_passed, e.tests_failed
   FROM tdd_commit AS c
   JOIN tdd_execution AS e ON e.commit_sha = c.sha
   JOIN tdd_repository AS r ON r.id = e.repo_id
   WHERE r.owner = 'CalebBav234' AND r.repos_name = 'BDRamas-4.0.4'
     AND c.sha = '<pega aquí el SHA del paso 2>';
   ```

**Reintento del push.** Si se rechaza la conexión, comprueba la URL y que el servidor esté escuchando. Si responde con HTTP 500, revisa el error en la consola de TDDLab y que hayas aplicado la corrección y ejecutado la migración de esta guía. Después repite `git push -u origin $destino`. Si el commit ya está en GitHub, usa `npm.cmd run db:sync -- --commit <SHA>`. La API corregida devuelve el número de registros nuevos. Una repetición completa devuelve cero en los cuatro contadores.

Al terminar, vuelve a la rama de la entrega con `git switch feat/registrar-actividad-tdd-en-push`. Cerrar la ventana de PowerShell descarta las variables de esta sesión.

## 7. Enviar al endpoint desde la terminal

Con el backend en ejecución, puedes enviar la actividad de la rama activa sin publicar una referencia en GitHub. Desde la raíz de BDRamas, ejecuta en PowerShell:

```powershell
$env:TDD_BRANCHES_URL = "http://localhost:3000/api/TDDCycles/branches/branches"
npm.cmd run test:app
npm.cmd run db:sync
```

El primer comando de npm guarda el resultado en SQLite junto al SHA actual. El segundo prepara el JSON para el remoto `origin` y lo envía mediante `fetch` con método `POST`. Incluye los commits nuevos respecto a las referencias locales de ese remoto, o el último commit cuando ya están publicados. También puedes usar el envío automático del paso 5 de la sección 6. Cada envío manual genera una petición nueva.

La URL local del ejemplo es el valor predeterminado. Para usar un backend compartido, configura la URL que indique el equipo. El cliente solo necesita acceso HTTP al backend.

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
| Pre-push aborta | El endpoint está inaccesible o ha rechazado los datos | Comprueba la URL, revisa el estado HTTP y reintenta cuando el backend esté disponible |
| No aparecen datos en SQLite | Hook omitido o commit fuera de repo | Verificar `HUSKY_SKIP_TRACK`, estar en repo Git y repetir operación |
| Faltan datos en el backend HTTP | La API devolvió un error o el push ya estaba al día | Comprueba la URL, busca la línea `[pre-push] API:` y contrasta los contadores con el SHA en la base del backend |
| `better-sqlite3` falla al instalar/cargar | Binario nativo incompatible | Reinstalar dependencias (`npm ci`/`npm install`) con toolchain compatible en Windows |

---

## 10. Resultado esperado (resumen)

- `npm test` ejecuta la aplicación, el ejecutor TDD y las pruebas de ramas y envío.
- `npm run db:init:local`: crea/actualiza `.tddlab/tddlab.db` con el esquema requerido.
- Commits/checkouts/merges (incl. fast-forward) en ramas de prueba: generan/actualizan registros en SQLite (`tdd_branch`, `tdd_commit`, `tdd_merge`).
- El hook envía la actividad al endpoint y comprueba la confirmación del servidor antes de publicar la rama.
- El archivo `.env` y la base SQLite de la demostración quedan fuera del commit.
