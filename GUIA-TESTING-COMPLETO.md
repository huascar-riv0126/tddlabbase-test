# Guía de testing completo (BDRamas / TDD tracking)

Esta guía describe, paso a paso, cómo verificar que todo el flujo funcione: pruebas de aplicación (`src`), base local SQLite, hooks de Git (pre-commit/post-commit/post-checkout/post-merge), inicialización de esquema, sincronización pre-push hacia PostgreSQL/Neon y controles de seguridad.

> Entorno de referencia: Windows + PowerShell. Ajusta rutas/comandos si usas otro shell.

---

## 1. Prerrequisitos

1. **Herramientas**
   - Node.js y npm instalados.
   - Git instalado y disponible en `PATH`.
2. **Dependencias del proyecto**
   - Ejecuta en la raíz del proyecto (`BDRamas-4.0.4`):
     ```powershell
     npm install
     ```
3. **Repositorio Git**
   - Debes estar dentro de un repo Git con al menos un commit. Comprueba:
     ```powershell
     git rev-parse --is-inside-work-tree
     git log --oneline -1
     ```
4. **Variables de entorno (seguridad)**
   - Crea tu `.env` a partir de la plantilla **sin subirlo nunca**:
     ```powershell
     Copy-Item .env.example .env
     ```
   - Edita `.env` y configura:
     - `DATABASE_URL`: cadena PostgreSQL (Neon) para sincronización remota / scripts remotos. Debe incluir base de datos y, en entornos no locales, `sslmode=require`.
     - `REQUIRE_DB_SSL=1` (recomendado fuera de local) para exigir SSL.
     - `SQLITE_DB_PATH` (opcional): ruta de la BD local; por defecto `.tddlab/tddlab.db`.
   - **No** hagas commit de `.env`. Verifica:
     ```powershell
     git status --short
     ```
     `.env` no debe aparecer como archivo a versionar (está en `.gitignore`).
   - Si alguna credencial se expuso, **rótala** en el proveedor.

---

## 2. Verificar pruebas de aplicación (solo `src`)

La configuración de Jest (`jest.config.js`) ejecuta únicamente tests bajo `src/`.

1. **Listar tests detectados**
   ```powershell
   node ./node_modules/jest/bin/jest.js --listTests
   ```
   - Esperado: solo archivos dentro de `src` (p. ej. `src\sumador.test.js`). No deben listarse tests de `script/`.

2. **Ejecutar tests unitarios de app**
   ```powershell
   npm test
   ```
   - Esperado: suites/tests de `src` pasan (exit code 0).

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
   - Esperado: `True` y el archivo `tddlab.db` presente. (`.tddlab/` está ignorado por Git).

3. **Inspeccionar tablas y datos (sin `sqlite3` CLI, usando Node + better-sqlite3)**
   ```powershell
   node -e "const Database=require('better-sqlite3');const db=new Database('.tddlab/tddlab.db',{readonly:true});console.log(db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name').all());db.close()"
   ```
   - Esperado: tablas como `tdd_branch`, `tdd_commit`, `tdd_merge`, `tdd_execution`, `tdd_schema_migration`.
   - Nota (PowerShell): usa comillas dobles externas para `-e` y `\'` para la comilla simple dentro del SQL (PowerShell pasa `\` tal cual a Node, que lo interpreta correctamente). En bash/cmd ajusta el entrecomillado según tu shell.

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

> **Importante (PowerShell):** usa `Set-Content -Encoding utf8` para crear archivos de texto. `echo "x" > file` en PowerShell 5.1 puede generar UTF-16 y provocar conflictos binarios en merges.

1. **Preparar base**
   ```powershell
   git checkout -b test/merge-base
   Set-Content -Encoding utf8 merge-test.txt "base"
   git add merge-test.txt
   git commit -m "test: base merge"
   ```

2. **Merge no fast-forward** (cambios en archivos distintos para evitar conflictos de contenido)
   ```powershell
   git checkout -b test/merge-feature
   Set-Content -Encoding utf8 feature.txt "feature"
   git add feature.txt
   git commit -m "test: feature change"
   git checkout test/merge-base
   Set-Content -Encoding utf8 mainline.txt "mainline"
   git add mainline.txt
   git commit -m "test: mainline change"
   git merge --no-ff test/merge-feature -m "test: merge no-ff"
   ```
   - Consulta:
     ```powershell
     node -e "const Database=require('better-sqlite3');const db=new Database('.tddlab/tddlab.db',{readonly:true});console.log(db.prepare('SELECT source_branch,target_branch,source_commit_sha,merge_commit_sha,is_fast_forward,merged_at FROM tdd_merge ORDER BY id DESC LIMIT 5').all());db.close()"
     ```
   - Esperado: un registro nuevo con `is_fast_forward = 0` y ramas/SHAs coherentes (el hook `post-merge` corre solo si el merge termina sin conflictos).

3. **Merge fast-forward**
   ```powershell
   git checkout -b test/ff-feature test/merge-base
   Set-Content -Encoding utf8 ff.txt "ff"
   git add ff.txt
   git commit -m "test: ff feature"
   git checkout test/merge-base
   git merge test/ff-feature
   ```
   - Repite la consulta de `tdd_merge`.
   - Esperado: registro con `is_fast_forward = 1` (según detección por reflog/ORIG_HEAD) para el merge fast-forward.

4. **Limpieza**: vuelve a tu rama de trabajo y elimina ramas/archivos temporales si corresponde.

---

## 6. Verificar sincronización pre-push (SQLite → PostgreSQL/Neon)

El hook `.husky/pre-push` ejecuta `script/pre-push-sync.js`, que:
- lee refs desde stdin del push,
- calcula commits de la rama a subir,
- extrae de SQLite solo datos relevantes (commits/rama/ejecuciones/merges relacionados),
- valida `DATABASE_URL` y sincroniza al remoto,
- **aborta el push** si falla la sincronización (a menos que se omita explícitamente).

### 6.1 Verificación de seguridad de configuración (sin exponer secretos)
```powershell
node -r dotenv/config -e "import('./script/db-security.js').then(m=>{try{console.log(JSON.stringify(m.validateDatabaseUrl(process.env.DATABASE_URL),null,2))}catch(e){console.error('invalid:',e.message)}})"
```
- `-r dotenv/config` carga `.env` en el proceso. Si `DATABASE_URL` ya está en el entorno, puedes omitir `-r dotenv/config`.
- Para una prueba local sin exigir SSL explícito en el validador, puedes pasar `{requireSsl:false}` como segundo argumento a `validateDatabaseUrl`.
- Esperado: objeto con `host/database/sslmode/secure/masked` sin mostrar contraseña en claro. Si es inválida o insegura según flags, muestra error.

### 6.2 Inicializar esquema remoto (si aplica)
```powershell
npm run db:init:remote
```
- Esperado: esquema PostgreSQL remoto inicializado (requiere `DATABASE_URL` válida y accesible).

### 6.3 Prueba de sync (simulada por stdin)
`pre-push` recibe líneas `localRef localSha remoteRef remoteSha` por stdin. Puedes simular sin hacer push real:
```powershell
$head = git rev-parse HEAD
$branch = git rev-parse --abbrev-ref HEAD
"$("refs/heads/$branch") $head $("refs/remotes/origin/$branch") 0000000000000000000000000000000000000000" | node ./script/pre-push-sync.js
```
- Ajusta `remoteSha` a un SHA real remoto si quieres sincronizar solo un rango incremental.
- Esperado: mensaje `[pre-push-sync] Sincronizado...` o “sin datos nuevos”. Con `DATABASE_URL` inválida/inaccesible: error enmascarado y exit code != 0 (comportamiento deseado antes de un push real).

### 6.4 Prueba de push real (controlada)
- Haz push de una rama de prueba a un remoto de prueba:
  ```powershell
  git push -u origin test/db-hooks-verification
  ```
- Esperado: si hay datos y credenciales válidas, sincroniza y luego continúa el push; si falla, el push se aborta con mensaje de sincronización.

### 6.5 Omitir sync (solo pruebas controladas)
```powershell
$env:SKIP_DB_SYNC = "1"; git push; Remove-Item Env:SKIP_DB_SYNC
```
- Esperado: omite la sincronización de BD. **No recomendado** en flujo normal (pierde trazabilidad remota).

---

## 7. Verificar scripts remotos/Neon existentes (opcionales según entorno)

1. **Conectividad y tablas remotas**
   ```powershell
   npm run test:neon
   ```
   - Requiere `DATABASE_URL`. Esperado: conexión exitosa y listado de tablas TDD disponibles.

2. **Integración real Neon (opt-in)**
   ```powershell
   $env:RUN_NEON_INTEGRATION = "1"; npm run test:neon:integration; Remove-Item Env:RUN_NEON_INTEGRATION
   ```
   - Esperado: pruebas de inserción/rollback y limpieza (según implementación del script).

3. **Flujo de app que registra ejecución remota**
   ```powershell
   npm run test:app
   ```
   - Requiere `DATABASE_URL` y repo Git (según `script/tddScript.js`/store remoto). Esperado: ejecuta Jest, genera/lee reporte y registra ejecución en la BD remota configurada.

---

## 8. Verificaciones de seguridad (checklist)

- [ ] `.env` no está versionado (`git status` limpio respecto a `.env`).
- [ ] `.env.example` no contiene secretos reales.
- [ ] `DATABASE_URL` usa `sslmode=require` (o SSL equivalente) fuera de local; `REQUIRE_DB_SSL=1` en entornos estrictos.
- [ ] Errores de BD no exponen credenciales (mensajes enmascarados por `db-security`).
- [ ] `.tddlab/` y `*.db*` permanecen ignorados por Git.
- [ ] Hooks pueden omitirse solo con `HUSKY_SKIP_TRACK=1` / `SKIP_DB_SYNC=1` de forma consciente.

---

## 9. Solución de problemas

| Síntoma | Causa probable | Acción |
|---|---|---|
| `npm test` ejecuta tests de `script/` | Jest no usa `jest.config.js` | Verifica que `jest.config.js` exista en raíz y que `package.json` no tenga sección `jest` conflictiva |
| Error de parseo JSON/BOM en `package.json` | Archivo con BOM | Re-guardar `package.json` como UTF-8 sin BOM |
| `DATABASE_URL no está configurada` | Falta `.env` o variable | Crear `.env` desde `.env.example` y definir `DATABASE_URL` |
| `DATABASE_URL debe usar SSL...` | `sslmode` ausente/disable con `REQUIRE_DB_SSL=1` | Añadir `sslmode=require` o ajustar flags solo en local controlado |
| Pre-push aborta | Sync remoto falla o URL inválida | Revisar conectividad/credenciales/SSL; usar `SKIP_DB_SYNC=1` solo si aceptas no sincronizar |
| No aparecen datos en SQLite | Hook omitido o commit fuera de repo | Verificar `HUSKY_SKIP_TRACK`, estar en repo Git y repetir operación |
| No aparecen datos en remoto | No se ejecutó pre-push/sync o no había commits en rango | Ejecutar `db:sync` (con refs) o hacer push; revisar logs `[pre-push-sync]` |
| `better-sqlite3` falla al instalar/cargar | Binario nativo incompatible | Reinstalar dependencias (`npm ci`/`npm install`) con toolchain compatible en Windows |

---

## 10. Resultado esperado (resumen)

- `npm test`: pasa y solo ejecuta `src/**/*.test.js`.
- `npm run db:init:local`: crea/actualiza `.tddlab/tddlab.db` con el esquema requerido.
- Commits/checkouts/merges (incl. fast-forward) en ramas de prueba: generan/actualizan registros en SQLite (`tdd_branch`, `tdd_commit`, `tdd_merge`).
- Pre-push: con `DATABASE_URL` válida, sincroniza solo los datos necesarios de la rama a PostgreSQL y permite el push; con fallo, bloquea el push.
- `.env` y `.tddlab/*` no se versionan; credenciales no se exponen en logs.
