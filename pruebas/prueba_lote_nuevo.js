const { chromium, devices } = require('playwright');
const B = 'http://localhost:8080'; const esperar = ms => new Promise(r => setTimeout(r, ms));
const post = (p, j) => fetch(B + p, { method: 'POST', body: JSON.stringify(j) }).then(r => r.text());
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ ...devices['Pixel 7'] }); const p = await c.newPage();
  const err = []; p.on('pageerror', e => err.push(String(e)));
  await p.goto(`${B}/#/config?api=${encodeURIComponent(B + '/api')}&k=clave-prueba`); await esperar(8000);
  await p.goto(B + '/#/tablero'); await p.waitForSelector('.chips'); await esperar(500);
  const antes = await p.$$eval('.chip[data-lote]:not(.todos)', cs => cs.map(c => c.textContent.trim() + ' ' + c.querySelector('i').style.background));
  // Cambio del usuario: renombrar KENT y agregar KENT-JOVEN entre Keitt y GENERAL
  await post('/_sembrar', { hoja: 'Lotes', celdas: [[3, 2, 'Lote Kent viejo'], [3, 6, 2008]], insertar: { fila: 7, valores: ['KENT-JOVEN', 'Lote Kent joven', 'Kent', 3, 900, 2021, '', ''] } });
  await p.goto(B + '/#/ajustes'); await esperar(300); await p.click('#sinc'); await esperar(9000);
  await p.goto(B + '/#/tablero'); await esperar(600);
  const despues = await p.$$eval('.chip[data-lote]:not(.todos)', cs => cs.map(c => c.textContent.trim() + ' ' + c.querySelector('i').style.background));
  // formulario: el lote nuevo aparece y se puede registrar
  await p.goto(B + '/#/form/cosecha'); await esperar(400);
  const opciones = await p.$$eval('[data-n="Lote"] option', os => os.map(o => o.textContent));
  await p.selectOption('[data-n="Lote"]', 'KENT-JOVEN'); await p.fill('[data-n="Cantidad"]', '50'); await p.fill('[data-n="Kg_por_Jaba"]', '22');
  await p.click('button.guardar'); await p.waitForFunction(() => !location.hash.startsWith('#/form'));
  for (let i = 0; i < 60 && !(await p.textContent('#estado')).includes('Al día'); i++) await esperar(500);
  await p.goto(B + '/#/tablero/campo'); await esperar(400); await p.click('#t-act'); await esperar(6000);
  await p.goto(B + '/#/tablero/campo'); await esperar(600);
  const rend = await p.$eval('section.graf-card', s => s.textContent.replace(/\s+/g, ' ').slice(0, 400));
  await p.screenshot({ path: '/tmp/lote_nuevo.png' });
  const st = await (await fetch(B + '/_estado')).json();
  const ok = st.estado.Cosecha.some(f => f[3] === 'KENT-JOVEN');
  console.log(JSON.stringify({ antes, despues, opciones, cosechaGuardadaEnKentJoven: ok, graficoRendimiento: rend, err }, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
