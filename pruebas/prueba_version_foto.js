// Prueba: foto de comprobante y actualización de versión. node prueba_version_foto.js
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const B = 'http://localhost:8080', V = path.join(__dirname, '..', 'app', 'version.js');
const esperar = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ ...devices['Pixel 7'] }); const p = await c.newPage();
  await p.goto(`${B}/#/config?api=${encodeURIComponent(B + '/api')}&k=clave-prueba`); await esperar(6000);
  // foto
  await p.goto(B + '/#/form/gasto'); await esperar(500);
  await p.selectOption('[data-n="Categoria"]', 'Otros'); await p.fill('[data-n="Concepto"]', 'Prueba foto'); await p.fill('[data-n="Monto"]', '10');
  await p.setInputFiles('[data-foto="Foto_Comprobante"]', path.join(__dirname, '..', 'app', 'icon-512.png')); await esperar(800);
  await p.click('button.guardar'); await esperar(8000);
  const st = await (await fetch(B + '/_estado')).json();
  const ult = st.estado.Costos[st.estado.Costos.length - 1];
  console.log('foto guardada en Drive (simulado):', ult[10], '| archivos:', st.fotos.length);
  // versión nueva
  const orig = fs.readFileSync(V, 'utf8');
  fs.writeFileSync(V, orig.replace(/'[\d.]+'/, "'9.9.9'"));
  await p.reload(); await esperar(4000);
  const banner = await p.isVisible('#nueva');
  if (banner) { await p.click('#nueva'); await esperar(3000); }
  const ver = await p.evaluate(() => self.APP_VERSION);
  fs.writeFileSync(V, orig);
  console.log('aviso de nueva versión visible:', banner, '| versión tras actualizar:', ver);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
