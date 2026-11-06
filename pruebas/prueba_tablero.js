// Prueba del tablero con datos de una campaña simulada. node prueba_tablero.js [carpeta_capturas]
const { chromium, devices } = require('playwright');
const B = 'http://localhost:8080', OUT = process.argv[2] || '/tmp/tablero';
require('fs').mkdirSync(OUT, { recursive: true });
const esperar = ms => new Promise(r => setTimeout(r, ms));
const post = (p, j) => fetch(B + p, { method: 'POST', body: JSON.stringify(j) }).then(r => r.text());
let n = 0; const id = p => p + '-T' + (++n);
(async () => {
  // Hectáreas de los lotes (filas 2..6, columna D)
  await post('/_sembrar', { hoja: 'Lotes', celdas: [[2, 4, 3], [3, 4, 8], [4, 4, 4], [5, 4, 2.5], [6, 4, 2.5]] });
  // Clima de abril a noviembre
  const clima = []; for (let d = new Date('2026-04-01'); d < new Date('2026-11-06'); d.setDate(d.getDate() + 1)) {
    const m = d.getMonth(); const fr = m >= 5 && m <= 8; const f = d.toISOString().slice(0, 10);
    const tmax = (fr ? 29 : 33) + Math.sin(d.getDate()) * 1.5, tmin = (fr ? 17 : 21) + Math.cos(d.getDate()) * 1.2;
    clima.push([f, +tmax.toFixed(1), +tmin.toFixed(1), +((tmax + tmin) / 2).toFixed(1), m === 3 && d.getDate() % 6 === 0 ? 4.2 : 0, fr ? 72 : 65, +(fr ? 3.6 : 4.8).toFixed(1), 14, 'prueba']);
  }
  await post('/_sembrar', { hoja: 'Clima', filas: clima });
  await post('/_sembrar', { hoja: 'Clima_Hoy', filas: [['2026-11-06', 32.4, 21.1, 26.7, 0, 66, 5.1, 15, '2026-11-06']] });
  // Registros vía la API real
  const ops = [];
  const lotes = ['ATAULFO', 'KENT', 'EDWARD', 'HADEN', 'KEITT'];
  ops.push({ op: 'agregar', tabla: 'Compradores', registro: { ID_Comprador: 'C002', Nombre: 'Empacadora Norte', Tipo: 'Empacadora/exportadora' } });
  ops.push({ op: 'agregar', tabla: 'Productos', registro: { ID_Producto: 'PR002', Nombre: 'Urea', Tipo: 'Fertilizante', Unidad: 'saco', Stock_Minimo: 5 } });
  ops.push({ op: 'agregar', tabla: 'Compras_Insumos', registro: { ID: id('CI'), Fecha: '2026-05-10', Campana: '2026-2027', Producto: 'PR002', Cantidad: 20, Unidad: 'saco', Precio_Unitario: 120 } });
  for (const [i, m] of ['05', '06', '07', '08', '09', '10'].entries()) {
    for (const l of lotes) {
      ops.push({ op: 'agregar', tabla: 'Planilla', registro: { ID: id('PL'), Fecha: `2026-${m}-15`, Campana: '2026-2027', Trabajador: 'T001', Lote: l, Labor: i < 2 ? 'Poda' : 'Riego', Modalidad: 'Jornal', Cantidad: 4, Tarifa: 50, Pagado: 'Sí' } });
      if (i === 1) ops.push({ op: 'agregar', tabla: 'Aplicaciones', registro: { ID: id('AP'), Fecha: `2026-${m}-20`, Campana: '2026-2027', Lote: l, Producto: 'PR002', Cantidad: 3 } });
    }
    ops.push({ op: 'agregar', tabla: 'Costos', registro: { ID: id('CO'), Fecha: `2026-${m}-05`, Campana: '2026-2027', Lote: 'GENERAL', Categoria: 'Riego y agua', Concepto: 'Turno de agua', Monto: 300 } });
  }
  const precios = { ATAULFO: 1.6, KENT: 1.3, EDWARD: 1.0, HADEN: 0.9, KEITT: 1.1 };
  for (const l of lotes) for (const [k, [cid, c]] of [['C001', 1], ['C002', 1.12]].entries())
    ops.push({ op: 'agregar', tabla: 'Ventas', registro: { ID_Venta: id('VE'), Fecha: '2026-11-0' + (k + 2), Campana: '2026-2027', Lote: l, Comprador: cid, Unidad: 'Kg', Cantidad: 3000 + lotes.indexOf(l) * 500, Precio_Unitario: +(precios[l] * c).toFixed(2) } });
  ops.push({ op: 'agregar', tabla: 'Planilla', registro: { ID: id('PL'), Fecha: '2026-11-03', Campana: '2026-2027', Trabajador: 'T001', Lote: 'KENT', Labor: 'Cosecha', Modalidad: 'Jornal', Cantidad: 2, Tarifa: 60, Pagado: 'No' } });
  ops.push({ op: 'agregar', tabla: 'Plan_Fertilizacion', registro: { ID: id('PF'), Campana: '2026-2027', Lote: 'EDWARD', Fase: 'Inducción', Producto: 'PR002', Mes_Programado: 'Agosto', Cantidad_Programada: 6 } });
  const r = JSON.parse(await post('/api', { k: 'clave-prueba', ops }));
  console.log('sembrado:', r.resultados.filter(x => x.ok).length, 'de', ops.length, r.resultados.filter(x => !x.ok).slice(0, 3));

  const b = await chromium.launch(); const c = await b.newContext({ ...devices['Pixel 7'] }); const p = await c.newPage();
  const err = []; p.on('pageerror', e => err.push(String(e))); p.on('console', m => { if (m.type() === 'error') err.push(m.text()); });
  await p.goto(`${B}/#/config?api=${encodeURIComponent(B + '/api')}&k=clave-prueba`); await esperar(9000);
  await p.screenshot({ path: OUT + '/0_inicio.png' });
  await p.goto(B + '/#/tablero'); await p.waitForSelector('.heroe', { timeout: 60000 }); await esperar(500);
  await p.screenshot({ path: OUT + '/1_resumen.png', fullPage: false });
  await p.evaluate(() => window.scrollTo(0, 900)); await esperar(200); await p.screenshot({ path: OUT + '/1b_resumen.png' });
  const heroe1 = await p.textContent('.heroe b');
  // filtro: solo Kent
  await p.click('[data-lote="*"]'); await p.click('[data-lote="KENT"]'); await esperar(300);
  const heroeKent = await p.textContent('.heroe b');
  await p.click('[data-lote="*"]'); await esperar(200);
  for (const t of ['costos', 'ventas', 'caja', 'clima']) {
    await p.goto(B + '/#/tablero/' + t); await esperar(500); await p.screenshot({ path: `${OUT}/2_${t}.png` });
  }
  // tooltip en línea de clima
  const box = await p.locator('svg.lineas .zona').first().boundingBox();
  await p.locator('svg.lineas .zona').first().dispatchEvent('pointermove', { clientX: box.x + box.width * 0.6, clientY: box.y + box.height / 2 }); await esperar(200);
  const tipTxt = await p.textContent('#tip');
  await p.screenshot({ path: OUT + '/3_tooltip.png' });
  // ver tabla
  await p.click('[data-vt="temp"]'); await esperar(200);
  const hayTabla = await p.locator('.graf-card .tabla').count();
  console.log(JSON.stringify({ heroe1, heroeKent, tipTxt, hayTabla, err }, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
