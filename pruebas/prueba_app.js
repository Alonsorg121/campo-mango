// Prueba de punta a punta: node prueba_app.js  (con servidor_prueba.js corriendo en :8080)
const { chromium, devices } = require('playwright');
const B = 'http://localhost:8080';
const OUT = process.argv[2] || '/tmp/capturas';
require('fs').mkdirSync(OUT, { recursive: true });
const esperar = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  const foto = async n => p.screenshot({ path: `${OUT}/${n}.png` });
  const guardar = async () => { await p.click('button.guardar'); await p.waitForFunction(() => !location.hash.startsWith('#/form')); };
  const estadoTxt = () => p.textContent('#estado');
  const esperarSync = async () => { for (let i = 0; i < 80; i++) { const t = await estadoTxt(); if (t.includes('Al día')) return; await esperar(500); } throw new Error('No sincronizó: ' + await estadoTxt()); };

  // 1. Configuración por enlace
  await p.goto(`${B}/#/config?api=${encodeURIComponent(B + '/api')}&k=clave-prueba`);
  await esperarSync();
  await foto('01_inicio');

  // 2. Nuevo trabajador
  await p.goto(B + '/#/form/nuevo-trabajador');
  await p.fill('[data-n="Nombres"]', 'Pedro Ramos');
  await p.fill('[data-n="Jornal_Base"]', '55');
  await guardar();
  await esperarSync();

  // 3. Jornal grupal (2 trabajadores)
  await p.goto(B + '/#/form/jornal');
  await p.waitForSelector('[data-multi="Trabajador"]');
  const nChecks = await p.locator('[data-multi="Trabajador"]').count();
  for (let i = 0; i < nChecks; i++) await p.locator('[data-multi="Trabajador"]').nth(i).check();
  await p.selectOption('[data-n="Lote"]', 'KENT');
  await p.selectOption('[data-n="Labor"]', 'Poda');
  await foto('02_jornal');
  await guardar();
  await esperarSync();
  await foto('03_historial');

  // 4. Venta por jaba
  await p.goto(B + '/#/form/venta');
  await p.selectOption('[data-n="Lote"]', 'KENT');
  await p.selectOption('[data-n="Comprador"]', 'C001');
  await p.click('[data-op="Unidad"][data-v="Jaba"]');
  await p.fill('[data-n="Cantidad"]', '200');
  await p.fill('[data-n="Kg_por_Jaba"]', '22');
  await p.fill('[data-n="Precio_Unitario"]', '24');
  await foto('04_venta');
  await guardar();
  await esperarSync();

  // 5. Sin señal: gasto + recarga de la app sin internet
  await ctx.setOffline(true);
  await p.goto(B + '/#/form/gasto').catch(() => {});
  await p.reload().catch(() => {});
  await p.waitForSelector('[data-n="Concepto"]');
  await p.selectOption('[data-n="Categoria"]', 'Maquinaria y transporte');
  await p.fill('[data-n="Concepto"]', 'Flete de jabas');
  await p.fill('[data-n="Monto"]', '80');
  await guardar();
  await esperar(800);
  const off = await estadoTxt();
  await foto('05_sin_senal');
  await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await esperarSync();

  // 6. Pagar planilla
  await p.goto(B + '/#/pagar');
  await foto('06_pagar');
  if (await p.locator('[data-t]:not([disabled])').count()) { await p.locator('[data-t]:not([disabled])').first().check(); await p.click('#pagar'); }
  await esperarSync();

  // 7. Consultas
  for (const v of ['resumen', 'stock', 'cobrar', 'clima']) { await p.goto(B + '/#/' + v); await esperar(300); await foto('07_' + v); }
  await p.goto(B + '/#/'); await esperar(300); await foto('08_inicio_final');

  const st = await (await fetch(B + '/_estado')).json();
  const filas = n => st.estado[n].slice(1).filter(f => f[0]);
  console.log(JSON.stringify({
    estadoSinSenal: off,
    trabajadores: filas('Trabajadores').map(f => f[1]),
    planilla: filas('Planilla').map(f => [f[0], f[3], f[5], f[7], f[8], f[9], f[10]]),
    ventas: filas('Ventas').map(f => [f[0], f[6], f[7], f[8], f[10], f[11]]),
    costos: filas('Costos').map(f => [f[0], f[4], f[5], f[6]]),
    errores
  }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
