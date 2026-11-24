import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function prepararServidor(ruta) {
  if (!ruta || process.argv.length !== 3) {
    throw new Error('Uso: npm run api:preparar -- "<ruta a TDDLab>"');
  }
  const cwd = resolve(ruta);
  if (!existsSync(join(cwd, 'server/src/routes/branchRoutes.ts'))) {
    throw new Error('Indica la carpeta TDDLab que contiene server/src/routes/branchRoutes.ts.');
  }
  const pendientes = [];
  for (const nombre of ['01-esquema.patch', '02-registro.patch']) {
    const parche = fileURLToPath(new URL('../docs/servidor-tddlab/' + nombre, import.meta.url));
    const aplicado = spawnSync('git', ['apply', '--reverse', '--check', parche], { cwd, encoding: 'utf8' });
    if (aplicado.error) {throw aplicado.error;}
    if (aplicado.status !== 0) {pendientes.push(parche);}
  }
  if (!pendientes.length) {
    console.log('La corrección ya está aplicada en esta copia de TDDLab.');
    return;
  }
  const options = { cwd, stdio: 'inherit' };
  execFileSync('git', ['apply', '--check', ...pendientes], options);
  execFileSync('git', ['apply', ...pendientes], options);
  console.log('Corrección aplicada. Desde TDDLab/server ejecuta npm run db:migrar-ramas.');
}

try {
  prepararServidor(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
