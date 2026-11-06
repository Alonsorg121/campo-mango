// Prueba de los módulos de campo (cosecha, floración, riego, sanidad, análisis) y su tablero.
// Arranca el servidor con PLANTILLA=<plantilla sin hojas nuevas> para probar que la API las crea sola.
const { chromium, devices } = require('playwright');
const B = 'http://localhost:8080', OUT = process.argv[2] || '/tmp/campo';
require('fs').mkdirSync(OUT, { recursive: true });
const esperar = ms => new Promise(r => setTimeout(r, ms));
const post = (p, j) => fetch(B + p, { method: 'POST', body: JSON.stringify(j) }).then(r => r.text());
(async () => {
  await post('/_sembrar', { hoja: 'Lotes', celdas: [[2, 4, 3], [3, 4, 8], [4, 4, 4], [5, 4, 2.5], [6, 4, 2.5]] });
  const clima = []; for (let d = new Date('2026-09-01'); d < new Date('2026-11-06'); d.setDate(d.getDate() + 1)) clima.push([d.toISOString().slice(0, 10), 32, 20, 26, 0, 65, 4.5, 14, 'prueba']);
  await post('/_sembrar', { hoja: 'Clima', filas: clima });
  const L = ['ATAULFO', 'KENT', 'EDWARD', 'HADEN', 'KEITT']; const ops = []; let n = 0; const id = p => p + '-C' + (++n);
  L.forEach((l, i) => {
    ops.push({ op: 'agregar', tabla: 'Floracion', registro: { ID: id('FL'), Fecha: '2026-07-20', Campana: '2026-2027', Lote: l, Etapa: 'Floración', Pct_Plantas: String([90, 75, 50, 25, 75][i]) } });
    ops.push({ op: 'agregar', tabla: 'Floracion', registro: { ID: id('FL'), Fecha: '2026-09-10', Campana: '2026-2027', Lote: l, Etapa: 'Llenado de fruto', Cuajado: ['Mucho', 'Normal', 'Normal', 'Poco', 'Normal'][i] } });
    for (const f of ['2026-10-05', '2026-10-15', '2026-10-25']) ops.push({ op: 'agregar', tabla: 'Riego', registro: { ID: id('RG'), Fecha: f, Campana: '2026-2027', Lote: l, Horas: 6, M3: i === 3 ? '' : 400 * (i + 1) } });
    ops.push({ op: 'agregar', tabla: 'Cosecha', registro: { ID: id('CS'), Fecha: '2026-11-02', Campana: '2026-2027', Lote: l, Unidad: 'Jaba', Cantidad: 150 + i * 30, Kg_por_Jaba: 22, Kg_Descarte: 100 + i * 40, Causa_Descarte: ['Mosca de la fruta', 'Antracnosis', 'Mosca de la fruta', 'Quemado de sol', 'Golpes'][i] } });
    for (const [k, f] of ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03'].entries())
      ops.push({ op: 'agregar', tabla: 'Sanidad', registro: { ID: id('SN'), Fecha: f, Campana: '2026-2027', Lote: l, Plaga: 'Mosca de la fruta', Trampas: 4, Capturas: 2 + k * (i + 1), Dias_Exposicion: 7, Nivel: k > 3 && i === 2 ? 'Alto' : 'Bajo' } });
  });
  ops.push({ op: 'agregar', tabla: 'Sanidad', registro: { ID: id('SN'), Fecha: '2026-11-01', Campana: '2026-2027', Lote: 'KENT', Plaga: 'Oídio', Pct_Afectado: 15, Nivel: 'Medio' } });
  ops.push({ op: 'agregar', tabla: 'Analisis', registro: { ID: id('AN'), Fecha: '2026-04-20', Campana: '2026-2027', Lote: 'KENT', Tipo: 'Suelo', Laboratorio: 'UNP', Resumen: 'pH 7.8, potasio bajo' } });
  const r = JSON.parse(await post('/api', { k: 'clave-prueba', ops }));
  const malos = r.resultados.filter(x => !x.ok);
  const st0 = await (await fetch(B + '/_estado')).json();
  console.log('sembrado:', r.resultados.length - malos.length, '/', ops.length, malos.slice(0, 2), '| hojas creadas:', ['Cosecha', 'Floracion', 'Riego', 'Sanidad', 'Analisis'].filter(h => st0.estado[h]).join(','),
    '| Ventas tiene ID_Cosecha:', st0.estado.Ventas[0].includes('ID_Cosecha'), '| fórmula MTD:', st0.estado.Sanidad[1][8]);

  const b = await chromium.launch(); const c = await b.newContext({ ...devices['Pixel 7'] }); const p = await c.newPage();
  const err = []; p.on('pageerror', e => err.push(String(e))); p.on('console', m => { if (m.type() === 'error') err.push(m.text()); });
  await p.goto(`${B}/#/config?api=${encodeURIComponent(B + '/api')}&k=clave-prueba`); await esperar(9000);
  await p.screenshot({ path: OUT + '/0_inicio.png' });
  // Cosecha desde el formulario
  await p.goto(B + '/#/form/cosecha'); await esperar(400);
  await p.selectOption('[data-n="Lote"]', 'KENT'); await p.fill('[data-n="Cantidad"]', '100'); await p.fill('[data-n="Kg_por_Jaba"]', '22');
  await p.fill('[data-n="Kg_Descarte"]', '50'); await p.locator('[data-n="Kg_Descarte"]').blur(); await p.click('[data-n="Observaciones"]').catch(() => {});
  await esperar(200);
  // la causa aparece solo con descarte > 0: re-render ocurre al elegir; forzamos con un toque en Unidad
  await p.click('[data-op="Unidad"][data-v="Jaba"]'); await esperar(200);
  await p.click('[data-op="Causa_Descarte"][data-v="Golpes"]'); await esperar(200);
  await p.screenshot({ path: OUT + '/1_cosecha.png' });
  await p.click('button.guardar'); await p.waitForFunction(() => !location.hash.startsWith('#/form'));
  for (let i = 0; i < 60 && !(await p.textContent('#estado')).includes('Al día'); i++) await esperar(500);
  // Venta desde esa cosecha
  await p.goto(B + '/#/form/venta'); await esperar(500);
  const opts = await p.$$eval('[data-n="ID_Cosecha"] option', os => os.map(o => [o.value, o.textContent]));
  const mia = opts.find(o => o[1].includes('Kent') && o[1].includes('2,150')) || opts[1];
  await p.selectOption('[data-n="ID_Cosecha"]', mia[0]); await esperar(300);
  const lote = await p.$eval('[data-n="Lote"]', s => s.value), cant = await p.$eval('[data-n="Cantidad"]', s => s.value);
  await p.selectOption('[data-n="Comprador"]', 'C001'); await p.fill('[data-n="Precio_Unitario"]', '1.3');
  await p.screenshot({ path: OUT + '/2_venta_desde_cosecha.png' });
  await p.click('button.guardar'); await p.waitForFunction(() => !location.hash.startsWith('#/form'));
  for (let i = 0; i < 60 && !(await p.textContent('#estado')).includes('Al día'); i++) await esperar(500);
  // Tablero › Campo
  await p.goto(B + '/#/tablero/campo'); await p.waitForSelector('.kpis', { timeout: 60000 }); await esperar(800);
  await p.goto(B + '/#/tablero/campo'); await esperar(800);
  await p.screenshot({ path: OUT + '/3_campo.png' });
  for (const [i, y] of [900, 1800, 2700].entries()) { await p.evaluate(y => window.scrollTo(0, y), y); await esperar(200); await p.screenshot({ path: `${OUT}/3_campo_${i + 1}.png` }); }
  await p.goto(B + '/#/tablero/resumen'); await esperar(600);
  const alertas = await p.$$eval('.alerta-f', as => as.map(a => a.textContent.trim()));
  const st = await (await fetch(B + '/_estado')).json();
  const ven = st.estado.Ventas; const ic = ven[0].indexOf('ID_Cosecha');
  console.log(JSON.stringify({ ventaPrellenada: { opcion: mia[1], lote, cant }, ventaGuardadaConCosecha: ven[ven.length - 1][ic], alertas: alertas.filter(a => /ALTO|riego/.test(a)), err }, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
