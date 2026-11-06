// Prueba: conexión oculta y PIN de administrador. node prueba_pin.js
const { chromium, devices } = require('playwright');
const B = 'http://localhost:8080';
const esperar = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ ...devices['Pixel 7'] }); const p = await c.newPage();
  const err = []; p.on('pageerror', e => err.push(String(e)));
  await c.grantPermissions(['clipboard-read', 'clipboard-write']);
  await p.goto(`${B}/#/config?api=${encodeURIComponent(B + '/api')}&k=clave-prueba`); await esperar(5000);
  await p.goto(B + '/#/ajustes'); await esperar(500);
  const textoAj = await p.textContent('#main');
  console.log('clave visible en Ajustes:', textoAj.includes('clave-prueba'), '| campo de clave visible:', await p.isVisible('#clave'));
  await p.screenshot({ path: '/tmp/aj1.png' });
  // crear PIN
  await p.click('#pin'); await p.fill('#pin-in', '1234'); await p.click('.modal button[type=submit]');
  await p.fill('#pin-in', '1234'); await p.click('.modal button[type=submit]'); await esperar(500);
  // recargar (bloquea) y probar PIN incorrecto
  await p.reload(); await esperar(1500); await p.goto(B + '/#/ajustes'); await esperar(400);
  await p.click('#ver-con'); await p.fill('#pin-in', '9999'); await p.click('.modal button[type=submit]'); await esperar(300);
  console.log('con PIN incorrecto muestra la clave:', await p.isVisible('#clave'));
  await p.click('#ver-con'); await p.screenshot({ path: '/tmp/aj2.png' }); await p.fill('#pin-in', '1234'); await p.click('.modal button[type=submit]'); await esperar(300);
  console.log('con PIN correcto muestra el formulario:', await p.isVisible('#clave'), '| clave oculta (password):', await p.getAttribute('#clave', 'type'));
  // la URL #/ajustes/conexion no debe saltarse el PIN
  await p.goto(B + '/#/'); await p.reload(); await esperar(1500); await p.goto(B + '/#/ajustes/conexion'); await esperar(400);
  console.log('saltar PIN por URL:', await p.isVisible('#clave'));
  console.log('errores:', err);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
