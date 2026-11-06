/**
 * TABLERO (dashboard) – reportes con filtros.
 * Lee todos los registros (acción "tablero" de la API), suma también los pendientes del celular
 * y calcula todo aquí: así funciona sin señal con la última copia.
 *
 * Pestañas: Resumen · Costos · Ventas · Caja · Clima. Filtros: campaña, lotes, periodo, gastos generales.
 * Gráficos en SVG propio (sin librerías) para que funcionen offline.
 */

// Colores fijos por lote (el color sigue al lote, nunca al orden): paleta validada para daltonismo.
const COLORES_LOTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const C = { serie1: '#2a78d6', serie2: '#eb6834', pos: '#2a78d6', neg: '#e34948', gris: '#c3c2b7',
  tinta: '#0b0b0b', tinta2: '#52514e', muda: '#898781', grilla: '#e1e0d9', base: '#c3c2b7', bien: '#006300' };
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const Tablero = {
  datos: null,        // {tablas, actualizado}
  cargando: false,
  pestana: 'resumen',
  filtro: null,       // {campana, lotes:[...], periodo, desde, hasta, generales}
  tablasVisibles: {}, // gráficos mostrados como tabla

  async cargarCache() { if (!this.datos) this.datos = (await DB.get('tablero')) || null; },
  async actualizar(forzar) {
    if (this.cargando || !Datos.config.api || !navigator.onLine) return;
    if (!forzar && this.datos && Date.now() - new Date(this.datos.actualizado).getTime() < 120000) return;
    this.cargando = true;
    try {
      const d = await Sync.get('tablero');
      this.datos = { tablas: d.tablas, actualizado: d.actualizado };
      await DB.set('tablero', this.datos);
    } catch (e) { UI.toast('No se pudo actualizar el tablero: ' + (e.message || e)); }
    finally { this.cargando = false; if (location.hash.startsWith('#/tablero')) Vistas.tablero(this.pestana); }
  },

  /** Filas de una tabla como objetos, con los registros pendientes del celular incluidos. */
  filas(nombre) {
    const t = this.datos && this.datos.tablas && this.datos.tablas[nombre];
    let rs = t ? t.filas.map(f => { const o = {}; t.enc.forEach((h, i) => { o[h] = f[i]; }); return o; }) : [];
    if (nombre !== 'Clima') {
      const ids = new Set(rs.map(r => r.ID || r.ID_Venta));
      Datos.cola.filter(c => c.op === 'agregar' && c.tabla === nombre).forEach(c => {
        if (!ids.has(c.registro.ID || c.registro.ID_Venta)) rs.push(Object.assign({ _pendiente: true }, c.registro));
      });
      if (nombre === 'Planilla') {
        const pagos = new Map(Datos.cola.filter(c => c.op === 'editar' && c.tabla === 'Planilla').map(c => [c.id, c.campos]));
        rs = rs.map(r => pagos.has(r.ID) ? Object.assign({}, r, pagos.get(r.ID)) : r);
      }
    }
    return rs;
  }
};

// ======================================================================
// Cálculos
// ======================================================================
function lotesReales() { return Datos.catalogo('Lotes').filter(l => l.ID_Lote && l.ID_Lote !== 'GENERAL'); }
function colorLote(id) { const i = lotesReales().findIndex(l => l.ID_Lote === id); return i < 0 ? C.gris : COLORES_LOTE[i % COLORES_LOTE.length]; }
function campanas() { return Datos.catalogo('Campanas').slice().sort((a, b) => String(a.Fecha_Inicio).localeCompare(String(b.Fecha_Inicio))); }
function fechaISO(v) { return String(v || '').slice(0, 10); }
const kgDeVenta = r => r.Unidad === 'Jaba' ? num(r.Cantidad) * num(r.Kg_por_Jaba) : num(r.Cantidad);
const totalVenta = r => num(r.Cantidad) * num(r.Precio_Unitario);
const totalJornal = r => num(r.Cantidad) * num(r.Tarifa);
const esPagado = r => ['sí', 'si'].includes(String(r.Pagado || '').toLowerCase());

function rangoFiltro(F) {
  const camp = campanas().find(c => c.ID_Campana === F.campana);
  let desde = camp ? fechaISO(camp.Fecha_Inicio) : '0000-01-01';
  let hasta = camp ? fechaISO(camp.Fecha_Fin) : '9999-12-31';
  const h = hoy();
  if (F.periodo === 'mes') { desde = h.slice(0, 8) + '01'; hasta = h; }
  if (F.periodo === '3m') { const d = new Date(h + 'T12:00:00'); d.setMonth(d.getMonth() - 3); desde = d.toISOString().slice(0, 10); hasta = h; }
  if (F.periodo === 'rango') { desde = F.desde || desde; hasta = F.hasta || hasta; }
  return { desde, hasta, porCampana: F.periodo !== 'rango' && F.periodo !== 'mes' && F.periodo !== '3m' };
}

function preciosPromedio() {
  const acc = {};
  Tablero.filas('Compras_Insumos').forEach(r => {
    const a = acc[r.Producto] = acc[r.Producto] || { c: 0, t: 0 };
    a.c += num(r.Cantidad); a.t += num(r.Cantidad) * num(r.Precio_Unitario);
  });
  const pp = {}; Object.keys(acc).forEach(k => { pp[k] = acc[k].c ? acc[k].t / acc[k].c : 0; });
  return pp;
}

/** Todo lo que el tablero necesita, según los filtros. */
function calcular(F) {
  const R = rangoFiltro(F);
  const lotesSel = new Set(F.lotes);
  const reales = lotesReales();
  const enPeriodo = r => { const f = fechaISO(r.Fecha); return f >= R.desde && f <= R.hasta; };
  const enCampana = r => !r.Campana || r.Campana === F.campana || !R.porCampana;
  const ok = r => enPeriodo(r) && enCampana(r);
  const pp = preciosPromedio();

  const plan = Tablero.filas('Planilla').filter(ok);
  const apl = Tablero.filas('Aplicaciones').filter(ok).map(r => Object.assign({}, r, { _costo: num(r.Cantidad) * (pp[r.Producto] || 0) }));
  const cos = Tablero.filas('Costos').filter(ok);
  const ven = Tablero.filas('Ventas').filter(ok);
  const comp = Tablero.filas('Compras_Insumos').filter(ok);

  // Reparto de gastos generales por hectárea (o en partes iguales si faltan hectáreas)
  const haTot = reales.reduce((s, l) => s + num(l.Hectareas), 0);
  const sinHa = haTot <= 0;
  const parte = id => sinHa ? 1 / Math.max(1, reales.length) : num((reales.find(l => l.ID_Lote === id) || {}).Hectareas) / haTot;
  const generalTot = plan.filter(r => r.Lote === 'GENERAL').reduce((s, r) => s + totalJornal(r), 0)
    + apl.filter(r => r.Lote === 'GENERAL').reduce((s, r) => s + r._costo, 0)
    + cos.filter(r => r.Lote === 'GENERAL').reduce((s, r) => s + num(r.Monto), 0);

  const porLote = reales.filter(l => lotesSel.has(l.ID_Lote)).map(l => {
    const id = l.ID_Lote;
    const mano = plan.filter(r => r.Lote === id).reduce((s, r) => s + totalJornal(r), 0);
    const insumos = apl.filter(r => r.Lote === id).reduce((s, r) => s + r._costo, 0);
    const otros = cos.filter(r => r.Lote === id).reduce((s, r) => s + num(r.Monto), 0);
    const generales = F.generales ? generalTot * parte(id) : 0;
    const vs = ven.filter(r => r.Lote === id);
    const ingresos = vs.reduce((s, r) => s + totalVenta(r), 0);
    const kg = vs.reduce((s, r) => s + kgDeVenta(r), 0);
    const costo = mano + insumos + otros + generales;
    const ha = num(l.Hectareas);
    return { id, nombre: l.Nombre || id, ha, mano, insumos, otros, generales, costo, ingresos, kg, utilidad: ingresos - costo,
      costoKg: kg ? costo / kg : 0, precioKg: kg ? ingresos / kg : 0, costoHa: ha ? costo / ha : 0, kgHa: ha ? kg / ha : 0 };
  });
  const sum = k => porLote.reduce((s, x) => s + x[k], 0);
  const T = { ingresos: sum('ingresos'), costo: sum('costo'), mano: sum('mano'), insumos: sum('insumos'), otros: sum('otros'), generales: sum('generales'), kg: sum('kg'), ha: sum('ha') };
  T.utilidad = T.ingresos - T.costo; T.margen = T.ingresos ? T.utilidad / T.ingresos : 0;
  T.costoKg = T.kg ? T.costo / T.kg : 0; T.precioKg = T.kg ? T.ingresos / T.kg : 0;
  T.kgHa = T.ha ? T.kg / T.ha : 0; T.costoHa = T.ha ? T.costo / T.ha : 0;

  // Costos por categoría (lotes elegidos + su parte de generales)
  const dentro = r => lotesSel.has(r.Lote);
  const factorGen = r => r.Lote === 'GENERAL' ? (F.generales ? reales.filter(l => lotesSel.has(l.ID_Lote)).reduce((s, l) => s + parte(l.ID_Lote), 0) : 0) : (dentro(r) ? 1 : 0);
  const categorias = {};
  const sumar = (obj, k, v) => { if (v) obj[k] = (obj[k] || 0) + v; };
  plan.forEach(r => sumar(categorias, 'Mano de obra', totalJornal(r) * factorGen(r)));
  apl.forEach(r => sumar(categorias, 'Insumos', r._costo * factorGen(r)));
  cos.forEach(r => sumar(categorias, r.Categoria || 'Otros', num(r.Monto) * factorGen(r)));
  const porLabor = {}; plan.forEach(r => sumar(porLabor, r.Labor || 'Sin labor', totalJornal(r) * factorGen(r)));
  const porProducto = {}; apl.forEach(r => sumar(porProducto, nombreDe('Productos', 'ID_Producto', 'Nombre', r.Producto), r._costo * factorGen(r)));
  const jornales = plan.filter(r => dentro(r) && r.Modalidad !== 'Tarea').reduce((s, r) => s + num(r.Cantidad), 0);

  // Ventas por comprador
  const porComprador = {};
  ven.filter(dentro).forEach(r => {
    const k = r.Comprador; const a = porComprador[k] = porComprador[k] || { ingresos: 0, kg: 0 };
    a.ingresos += totalVenta(r); a.kg += kgDeVenta(r);
  });

  // Por mes (todo el campo; ingresos = ventas, egresos = planilla + compras de insumos + gastos)
  const meses = {};
  const mesDe = r => fechaISO(r.Fecha).slice(0, 7);
  const m = k => meses[k] = meses[k] || { ingresos: 0, egresos: 0, kg: 0 };
  ven.filter(dentro).forEach(r => { const x = m(mesDe(r)); x.ingresos += totalVenta(r); x.kg += kgDeVenta(r); });
  plan.forEach(r => { m(mesDe(r)).egresos += totalJornal(r); });
  comp.forEach(r => { m(mesDe(r)).egresos += num(r.Cantidad) * num(r.Precio_Unitario); });
  cos.forEach(r => { m(mesDe(r)).egresos += num(r.Monto); });
  const listaMeses = Object.keys(meses).filter(k => k && k !== '').sort();

  return { R, porLote, T, categorias, porLabor, porProducto, porComprador, meses, listaMeses, jornales, sinHa, generalTot };
}

function alertas() {
  const out = [];
  const pend = Tablero.filas('Planilla').filter(r => !esPagado(r));
  if (pend.length) out.push({ nivel: 'aviso', icono: '🧾', txt: `Planilla por pagar: ${soles(pend.reduce((s, r) => s + totalJornal(r), 0))} (${pend.length} jornales)`, ir: '#/pagar' });
  // stock
  const compr = {}, usado = {};
  Tablero.filas('Compras_Insumos').forEach(r => { compr[r.Producto] = (compr[r.Producto] || 0) + num(r.Cantidad); });
  Tablero.filas('Aplicaciones').forEach(r => { usado[r.Producto] = (usado[r.Producto] || 0) + num(r.Cantidad); });
  Datos.catalogo('Productos').forEach(p => {
    const st = (compr[p.ID_Producto] || 0) - (usado[p.ID_Producto] || 0);
    if (p.Stock_Minimo !== '' && p.Stock_Minimo !== undefined && st <= num(p.Stock_Minimo) && (compr[p.ID_Producto] || usado[p.ID_Producto]))
      out.push({ nivel: 'serio', icono: '📦', txt: `Stock bajo: ${p.Nombre} (quedan ${st.toLocaleString('es-PE')} ${p.Unidad || ''})`, ir: '#/stock' });
  });
  // por cobrar
  const vend = {}, cob = {};
  Tablero.filas('Ventas').forEach(r => { vend[r.Comprador] = (vend[r.Comprador] || 0) + totalVenta(r); });
  Tablero.filas('Cobros').forEach(r => { cob[r.Comprador] = (cob[r.Comprador] || 0) + num(r.Monto); });
  Object.keys(vend).forEach(k => {
    const saldo = vend[k] - (cob[k] || 0);
    if (saldo > 0.5) out.push({ nivel: 'aviso', icono: '📒', txt: `${nombreDe('Compradores', 'ID_Comprador', 'Nombre', k)} te debe ${soles(saldo)}`, ir: '#/cobrar' });
  });
  // plan de fertilización atrasado
  const camp = campanas().find(c => c.ID_Campana === Datos.campanaActiva());
  if (camp) {
    const ini = fechaISO(camp.Fecha_Inicio); const h = hoy();
    Tablero.filas('Plan_Fertilizacion').filter(p => p.Campana === camp.ID_Campana && p.Mes_Programado).forEach(p => {
      const mi = MESES_LARGOS.indexOf(p.Mes_Programado); if (mi < 0) return;
      let y = +ini.slice(0, 4); if (mi + 1 < +ini.slice(5, 7)) y++;
      const finMes = new Date(y, mi + 1, 0).toISOString().slice(0, 10);
      if (finMes >= h) return;
      const aplicado = Tablero.filas('Aplicaciones').filter(a => a.Campana === p.Campana && a.Lote === p.Lote && a.Producto === p.Producto).reduce((s, a) => s + num(a.Cantidad), 0);
      if (aplicado < num(p.Cantidad_Programada)) out.push({ nivel: 'serio', icono: '📅', txt: `Atrasado: ${nombreDe('Productos', 'ID_Producto', 'Nombre', p.Producto)} en ${nombreDe('Lotes', 'ID_Lote', 'Nombre', p.Lote)} (${p.Mes_Programado}: ${aplicado} de ${num(p.Cantidad_Programada)})` });
    });
  }
  return out;
}

// ======================================================================
// Gráficos SVG
// ======================================================================
const fmtS = v => 'S/ ' + Math.round(v).toLocaleString('es-PE');
const fmtN = (v, d = 0) => num(v).toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d });
const ancho = () => Math.min(680, (document.querySelector('#main') || document.body).clientWidth - 30);

/** Barras horizontales: items [{label, value, color, tip}] */
function gBarrasH(items, o = {}) {
  if (!items.length) return '<p class="vacio chico">Sin datos para estos filtros.</p>';
  const W = ancho(), fila = 34, etq = Math.min(130, W * 0.36), H = items.length * fila + 6;
  const min = Math.min(0, ...items.map(i => i.value)), max = Math.max(0, ...items.map(i => i.value));
  const area = W - etq - 70; const x = v => etq + (v - min) / ((max - min) || 1) * area;
  const fmt = o.fmt || fmtS;
  return `<svg class="graf" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(o.titulo || '')}">
    ${min < 0 ? `<line x1="${x(0)}" x2="${x(0)}" y1="0" y2="${H}" stroke="${C.base}"/>` : ''}
    ${items.map((it, i) => {
      const y = i * fila + 6, x0 = x(Math.min(0, it.value)), w = Math.max(2, Math.abs(x(it.value) - x(0)));
      const r = Math.min(4, w / 2);
      const der = it.value >= 0;
      return `<g class="hit" data-tip="${esc(it.tip || (it.label + ': ' + fmt(it.value)))}">
        <rect x="0" y="${y - 3}" width="${W}" height="${fila}" fill="transparent"/>
        <text x="${etq - 8}" y="${y + 16}" text-anchor="end" class="t2">${esc(recortar(it.label, 20))}</text>
        <path d="${barraRedonda(x0, y + 4, w, 18, r, der)}" fill="${it.color || C.serie1}"/>
        <text x="${der ? x0 + w + 6 : x0 - 6}" y="${y + 17}" text-anchor="${der ? 'start' : 'end'}" class="t1">${esc(fmt(it.value))}</text>
      </g>`;
    }).join('')}
  </svg>`;
}
function barraRedonda(x, y, w, h, r, derecha) {
  // extremo de datos redondeado, lado de la base recto
  if (derecha) return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`;
  return `M${x + w},${y}h-${w - r}a${r},${r} 0 0 0 -${r},${r}v${h - 2 * r}a${r},${r} 0 0 0 ${r},${r}h${w - r}z`;
}
function recortar(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/** Columnas agrupadas: cats [...], series [{nombre, color, valores}] */
function gColumnas(cats, series, o = {}) {
  if (!cats.length) return '<p class="vacio chico">Sin datos para estos filtros.</p>';
  const W = ancho(), H = 200, ml = 52, mb = 26, mt = 10, ah = H - mb - mt, aw = W - ml - 6;
  const max = Math.max(1, ...series.flatMap(s => s.valores)); const esc_ = escala(max);
  const y = v => mt + ah - v / esc_.max * ah;
  const g = aw / cats.length, bw = Math.max(3, Math.min(26, (g - 6) / series.length - 2));
  const fmt = o.fmt || fmtS;
  return `<svg class="graf" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(o.titulo || '')}">
    ${esc_.ticks.map(t => `<line x1="${ml}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="${t ? C.grilla : C.base}"/><text x="${ml - 6}" y="${y(t) + 4}" text-anchor="end" class="eje">${esc(abrev(t))}</text>`).join('')}
    ${cats.map((c, i) => {
      const gx = ml + i * g + (g - series.length * (bw + 2)) / 2;
      const tip = esc(c + ' · ' + series.map(s => s.nombre + ': ' + fmt(s.valores[i])).join(' · '));
      return `<g class="hit" data-tip="${tip}"><rect x="${ml + i * g}" y="${mt}" width="${g}" height="${ah}" fill="transparent"/>
        ${series.map((s, j) => { const v = s.valores[i], h = Math.max(0, ah - (y(v) - mt)); return h > 0 ? `<path d="${colRedonda(gx + j * (bw + 2), y(v), bw, h)}" fill="${s.color}"/>` : ''; }).join('')}
        ${(cats.length <= 8 || i % Math.ceil(cats.length / 8) === 0) ? `<text x="${ml + i * g + g / 2}" y="${H - 8}" text-anchor="middle" class="eje">${esc(c)}</text>` : ''}</g>`;
    }).join('')}
  </svg>`;
}
function colRedonda(x, y, w, h) { const r = Math.min(4, w / 2, h); return `M${x},${y + h}v-${h - r}a${r},${r} 0 0 1 ${r},-${r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`; }
function escala(max) {
  const p = Math.pow(10, Math.floor(Math.log10(max))); const n = max / p;
  const paso = (n <= 2 ? 0.5 : n <= 5 ? 1 : 2) * p; const top = Math.ceil(max / paso) * paso;
  const ticks = []; for (let t = 0; t <= top + 1e-9; t += paso) ticks.push(+t.toFixed(6));
  return { max: top, ticks };
}
function abrev(v) { return Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace('.0', '') + ' M' : Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0).replace('.0', '') + ' mil' : String(v); }

/** Líneas en el tiempo: xs [fechas], series [{nombre, color, valores}] con cruz y tooltip */
function gLineas(xs, series, o = {}) {
  if (!xs.length) return '<p class="vacio chico">Sin datos de clima para este periodo.</p>';
  const W = ancho(), H = 190, ml = 40, mb = 24, mt = 10, ah = H - mb - mt, aw = W - ml - 10;
  const todos = series.flatMap(s => s.valores).filter(v => v !== null && v !== '' && !isNaN(v));
  let lo = Math.floor(Math.min(...todos) - 1), hi = Math.ceil(Math.max(...todos) + 1);
  const x = i => ml + (xs.length === 1 ? aw / 2 : i / (xs.length - 1) * aw), y = v => mt + ah - (v - lo) / ((hi - lo) || 1) * ah;
  const paso = Math.max(1, Math.round((hi - lo) / 4));
  const ticks = []; for (let t = Math.ceil(lo / paso) * paso; t <= hi; t += paso) ticks.push(t);
  const etqX = [0, Math.floor((xs.length - 1) / 2), xs.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const datos = encodeURIComponent(JSON.stringify({ xs, series: series.map(s => ({ n: s.nombre, v: s.valores })), u: o.unidad || '' }));
  return `<svg class="graf lineas" viewBox="0 0 ${W} ${H}" width="100%" data-lineas="${datos}" data-ml="${ml}" data-aw="${aw}" role="img" aria-label="${esc(o.titulo || '')}">
    ${ticks.map(t => `<line x1="${ml}" x2="${W - 10}" y1="${y(t)}" y2="${y(t)}" stroke="${C.grilla}"/><text x="${ml - 6}" y="${y(t) + 4}" text-anchor="end" class="eje">${t}${o.unidad || ''}</text>`).join('')}
    ${series.map(s => `<path d="${s.valores.map((v, i) => (i && s.valores[i - 1] !== null ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(num(v)).toFixed(1)).join('')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
    ${etqX.map(i => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'}" class="eje">${esc(fechaCorta(xs[i]))}</text>`).join('')}
    <line class="cruz" x1="0" x2="0" y1="${mt}" y2="${mt + ah}" stroke="${C.muda}" stroke-dasharray="3 3" visibility="hidden"/>
    <rect class="zona" x="${ml}" y="${mt}" width="${aw}" height="${ah}" fill="transparent"/>
  </svg>`;
}
function fechaCorta(s) { if (!s) return ''; const [y, m, d] = String(s).split('-'); return d ? `${+d} ${MESES[+m - 1]}` : `${MESES[+m - 1]} ${y.slice(2)}`; }

function leyenda(series) { return `<div class="leyenda">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.nombre)}</span>`).join('')}</div>`; }
function tablaHTML(enc, filas) {
  return `<div class="tabla-scroll"><table class="tabla"><tr>${enc.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${filas.map(f => `<tr>${f.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
}
/** Tarjeta de gráfico con botón "Ver tabla" */
function bloque(id, titulo, sub, grafico, tabla) {
  const verTabla = Tablero.tablasVisibles[id];
  return `<section class="tarjeta graf-card"><div class="graf-cab"><div><h3>${esc(titulo)}</h3>${sub ? `<div class="det">${sub}</div>` : ''}</div>
    ${tabla ? `<button class="mini" data-vt="${id}">${verTabla ? '📊 Gráfico' : '☰ Tabla'}</button>` : ''}</div>
    ${verTabla && tabla ? tabla : grafico}</section>`;
}

// ======================================================================
// Vista
// ======================================================================
Vistas.tablero = async (pest) => {
  if (Datos.config.pinTablero && !(await Pin.verificar('PIN para ver el tablero'))) { location.hash = '#/'; return; }
  await Tablero.cargarCache();
  if (pest) Tablero.pestana = pest;
  const cs = campanas();
  const reales = lotesReales();
  if (!Tablero.filtro) Tablero.filtro = { campana: Datos.campanaActiva(), lotes: reales.map(l => l.ID_Lote), periodo: 'campana', desde: '', hasta: '', generales: true };
  const F = Tablero.filtro;
  F.lotes = F.lotes.filter(id => reales.some(l => l.ID_Lote === id));
  if (!F.lotes.length && reales.length && !F._ninguno) F.lotes = reales.map(l => l.ID_Lote);

  if (!Tablero.datos) {
    UI.pintar(`<p class="vacio">${navigator.onLine ? 'Cargando datos del tablero…' : 'Sin datos todavía. Conéctate a internet una vez para cargar el tablero.'}</p>`, { titulo: '📈 Tablero' });
    Tablero.actualizar(true); return;
  }
  Tablero.actualizar(false);
  const D = calcular(F);
  const P = Tablero.pestana;

  const filtros = `
    <div class="filtros">
      <div class="fila2"><select id="f-camp" aria-label="Campaña">${cs.map(c => `<option ${c.ID_Campana === F.campana ? 'selected' : ''}>${esc(c.ID_Campana)}</option>`).join('')}</select>
      <select id="f-per" aria-label="Periodo">
        ${[['campana', 'Toda la campaña'], ['mes', 'Este mes'], ['3m', 'Últimos 3 meses'], ['rango', 'Elegir fechas…']].map(([v, t]) => `<option value="${v}" ${F.periodo === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select></div>
      ${F.periodo === 'rango' ? `<div class="rango"><input type="date" id="f-desde" value="${esc(F.desde || D.R.desde)}"><span>a</span><input type="date" id="f-hasta" value="${esc(F.hasta || D.R.hasta)}"></div>` : ''}
      <div class="chips">${reales.map(l => `<button class="chip ${F.lotes.includes(l.ID_Lote) ? 'sel' : ''}" data-lote="${esc(l.ID_Lote)}"><i style="background:${colorLote(l.ID_Lote)}"></i>${esc(String(l.Nombre || l.ID_Lote).replace(/^Lote /, ''))}</button>`).join('')}
        <button class="chip todos" data-lote="*">${F.lotes.length === reales.length ? 'Ninguno' : 'Todos'}</button></div>
      ${P !== 'clima' && P !== 'caja' ? `<label class="chk mini-chk"><input type="checkbox" id="f-gen" ${F.generales ? 'checked' : ''}><span>Incluir gastos generales <small class="det">(repartidos por ${D.sinHa ? 'partes iguales' : 'hectárea'})</small></span></label>` : ''}
    </div>`;
  const tabs = `<div class="tabs">${[['resumen', '📊 Resumen'], ['costos', '💸 Costos'], ['ventas', '🥭 Ventas'], ['caja', '📆 Mes a mes'], ['clima', '🌤️ Clima']].map(([k, t]) => `<a class="${P === k ? 'sel' : ''}" href="#/tablero/${k}">${t}</a>`).join('')}</div>`;

  let cuerpo = '';
  if (P === 'resumen') cuerpo = pestResumen(D, F);
  if (P === 'costos') cuerpo = pestCostos(D);
  if (P === 'ventas') cuerpo = pestVentas(D);
  if (P === 'caja') cuerpo = pestCaja(D);
  if (P === 'clima') cuerpo = pestClima(D);

  UI.pintar(`${tabs}${filtros}${cuerpo}
    <p class="pie">${D.R.desde ? `Del ${fechaBonita(D.R.desde)} al ${fechaBonita(D.R.hasta)} · ` : ''}Datos al ${new Date(Tablero.datos.actualizado).toLocaleString('es-PE')}${Datos.cola.length ? ` · incluye ${Datos.cola.length} por enviar` : ''}
    ${Tablero.cargando ? ' · actualizando…' : ''}</p>
    <div class="acciones-tab"><button class="mini" id="t-act">↻ Actualizar</button><button class="mini" id="t-comp">📤 Compartir resumen</button></div>`, { titulo: '📈 Tablero' });

  // eventos de filtros
  const re = () => Vistas.tablero();
  $('#f-camp').onchange = e => { F.campana = e.target.value; re(); };
  $('#f-per').onchange = e => { F.periodo = e.target.value; if (F.periodo === 'rango') { F.desde = D.R.desde; F.hasta = D.R.hasta; } re(); };
  if ($('#f-desde')) { $('#f-desde').onchange = e => { F.desde = e.target.value; re(); }; $('#f-hasta').onchange = e => { F.hasta = e.target.value; re(); }; }
  if ($('#f-gen')) $('#f-gen').onchange = e => { F.generales = e.target.checked; re(); };
  document.querySelectorAll('[data-lote]').forEach(b => b.onclick = () => {
    const id = b.dataset.lote;
    if (id === '*') { F.lotes = F.lotes.length === reales.length ? [] : reales.map(l => l.ID_Lote); F._ninguno = !F.lotes.length; }
    else { F.lotes = F.lotes.includes(id) ? F.lotes.filter(x => x !== id) : F.lotes.concat(id); F._ninguno = !F.lotes.length; }
    re();
  });
  document.querySelectorAll('[data-vt]').forEach(b => b.onclick = () => { Tablero.tablasVisibles[b.dataset.vt] = !Tablero.tablasVisibles[b.dataset.vt]; re(); });
  $('#t-act').onclick = () => Tablero.actualizar(true);
  $('#t-comp').onclick = () => compartir(D, F);
  activarTooltips();
};
Vistas.tablero.refrescable = true;

// ---------------- Pestañas ----------------
function kpi(t, v, sub, cls) { return `<div class="kpi ${cls || ''}"><span>${esc(t)}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`; }
function delta(actual, antes, bueno) {
  if (antes === null || antes === undefined || !isFinite(antes) || antes === 0) return '';
  const d = (actual - antes) / Math.abs(antes); const sube = d >= 0; const bien = bueno === 'sube' ? sube : !sube;
  return `<span class="delta ${bien ? 'bien' : 'mal'}">${sube ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(0)}% vs campaña anterior</span>`;
}

function pestResumen(D, F) {
  const T = D.T;
  const al = alertas();
  // comparación con la campaña anterior (solo viendo la campaña completa)
  let A = null;
  const cs = campanas(); const i = cs.findIndex(c => c.ID_Campana === F.campana);
  if (F.periodo === 'campana' && i > 0) A = calcular(Object.assign({}, F, { campana: cs[i - 1].ID_Campana })).T;
  const margenKg = T.precioKg - T.costoKg;
  return `
    <section class="tarjeta heroe">
      <span>Utilidad ${F.lotes.length === lotesReales().length ? 'del campo' : 'de los lotes elegidos'}</span>
      <b class="${T.utilidad < 0 ? 'neg' : ''}">${fmtS(T.utilidad)}</b>
      <small>Margen ${(T.margen * 100).toFixed(1)}% ${A ? delta(T.utilidad, A.utilidad, 'sube') : ''}</small>
    </section>
    <div class="kpis">
      ${kpi('Ingresos', fmtS(T.ingresos), A ? delta(T.ingresos, A.ingresos, 'sube') : '')}
      ${kpi('Costos', fmtS(T.costo), A ? delta(T.costo, A.costo, 'baja') : '')}
      ${kpi('Kg vendidos', fmtN(T.kg), T.ha ? fmtN(T.kgHa) + ' kg/ha' : 'faltan hectáreas')}
      ${kpi('Precio promedio', T.kg ? 'S/ ' + fmtN(T.precioKg, 2) + '/kg' : '—')}
      ${kpi('Costo por kg', T.kg ? 'S/ ' + fmtN(T.costoKg, 2) : '—', A && A.costoKg ? delta(T.costoKg, A.costoKg, 'baja') : '')}
      ${kpi('Ganancia por kg', T.kg ? 'S/ ' + fmtN(margenKg, 2) : '—', '', margenKg < 0 ? 'mal' : '')}
      ${kpi('Costo por hectárea', T.ha ? fmtS(T.costoHa) : '—', T.ha ? fmtN(T.ha, 1) + ' ha' : 'llena hectáreas en Lotes')}
      ${kpi('Jornales', fmtN(D.jornales, 1), 'días trabajados')}
    </div>
    ${al.length ? `<section class="tarjeta alertas"><h3>Atención</h3>${al.map(a => `<${a.ir ? `a href="${a.ir}"` : 'div'} class="alerta-f ${a.nivel}"><span class="ico-al">${a.icono}</span>${esc(a.txt)}</${a.ir ? 'a' : 'div'}>`).join('')}</section>` : '<section class="tarjeta alertas ok"><span>✅</span> Todo al día: sin pagos, cobros ni stock pendientes.</section>'}
    ${bloque('util-lote', 'Utilidad por lote', 'Ingresos menos costos de cada lote.',
      gBarrasH(D.porLote.map(l => ({ label: l.nombre.replace(/^Lote /, ''), value: l.utilidad, color: l.utilidad < 0 ? C.neg : C.pos, tip: `${l.nombre}: utilidad ${fmtS(l.utilidad)} · ingresos ${fmtS(l.ingresos)} · costos ${fmtS(l.costo)}` })), { titulo: 'Utilidad por lote' }),
      tablaHTML(['Lote', 'Ingresos', 'Costos', 'Utilidad', 'S/ por kg', 'Costo por kg'], D.porLote.map(l => [l.nombre, fmtS(l.ingresos), fmtS(l.costo), fmtS(l.utilidad), l.kg ? fmtN(l.precioKg, 2) : '—', l.kg ? fmtN(l.costoKg, 2) : '—'])))}
    ${bloque('kgha-lote', 'Rendimiento por lote', D.sinHa ? 'Llena las hectáreas en la hoja Lotes para ver kg por hectárea.' : 'Kilos vendidos por hectárea.',
      gBarrasH(D.porLote.map(l => ({ label: l.nombre.replace(/^Lote /, ''), value: D.sinHa ? l.kg : l.kgHa, color: colorLote(l.id), tip: `${l.nombre}: ${fmtN(l.kg)} kg${l.ha ? ' · ' + fmtN(l.kgHa) + ' kg/ha' : ''}` })), { fmt: v => fmtN(v) + (D.sinHa ? ' kg' : ' kg/ha') }),
      tablaHTML(['Lote', 'Hectáreas', 'Kg vendidos', 'Kg por ha'], D.porLote.map(l => [l.nombre, l.ha ? fmtN(l.ha, 2) : '—', fmtN(l.kg), l.ha ? fmtN(l.kgHa) : '—'])))}
  `;
}

function aItems(obj, color, n = 8) {
  const xs = Object.entries(obj).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value);
  if (xs.length > n) { const resto = xs.splice(n - 1); xs.push({ label: 'Otros', value: resto.reduce((s, x) => s + x.value, 0) }); }
  return xs.map(x => Object.assign(x, { color }));
}
function pestCostos(D) {
  const tot = Object.values(D.categorias).reduce((s, v) => s + v, 0);
  const cat = aItems(D.categorias, C.serie1).map(x => Object.assign(x, { tip: `${x.label}: ${fmtS(x.value)} (${tot ? (x.value / tot * 100).toFixed(0) : 0}%)` }));
  return `
    <div class="kpis">${kpi('Costo total', fmtS(D.T.costo))}${kpi('Mano de obra', fmtS(D.T.mano), D.T.costo ? (D.T.mano / D.T.costo * 100).toFixed(0) + '% del costo' : '')}
      ${kpi('Insumos aplicados', fmtS(D.T.insumos), D.T.costo ? (D.T.insumos / D.T.costo * 100).toFixed(0) + '% del costo' : '')}${kpi('Otros gastos', fmtS(D.T.otros + D.T.generales))}</div>
    ${bloque('cat', '¿En qué se va la plata?', 'Costos por categoría.', gBarrasH(cat), tablaHTML(['Categoría', 'Monto', '%'], cat.map(c => [c.label, fmtS(c.value), tot ? (c.value / tot * 100).toFixed(1) + '%' : '—'])))}
    ${bloque('costo-lote', 'Costo por lote', D.sinHa ? 'Costo total de cada lote.' : 'Costo por hectárea de cada lote.',
      gBarrasH(D.porLote.map(l => ({ label: l.nombre.replace(/^Lote /, ''), value: D.sinHa ? l.costo : l.costoHa, color: colorLote(l.id), tip: `${l.nombre}: ${fmtS(l.costo)} · mano de obra ${fmtS(l.mano)} · insumos ${fmtS(l.insumos)} · otros ${fmtS(l.otros + l.generales)}` })), { fmt: v => fmtS(v) + (D.sinHa ? '' : '/ha') }),
      tablaHTML(['Lote', 'Mano de obra', 'Insumos', 'Otros', 'Generales', 'Total', 'Por ha'], D.porLote.map(l => [l.nombre, fmtS(l.mano), fmtS(l.insumos), fmtS(l.otros), fmtS(l.generales), fmtS(l.costo), l.ha ? fmtS(l.costoHa) : '—'])))}
    ${bloque('labor', 'Mano de obra por labor', 'Lo que se pagó en jornales y tareas.', gBarrasH(aItems(D.porLabor, C.serie1)), tablaHTML(['Labor', 'Monto'], aItems(D.porLabor, '', 99).map(x => [x.label, fmtS(x.value)])))}
    ${bloque('prod', 'Insumos usados', 'Costo de lo aplicado (al precio promedio de compra).', gBarrasH(aItems(D.porProducto, C.serie1)), tablaHTML(['Producto', 'Costo'], aItems(D.porProducto, '', 99).map(x => [x.label, fmtS(x.value)])))}
  `;
}

function pestVentas(D) {
  const comp = Object.entries(D.porComprador).map(([k, v]) => ({ id: k, nombre: nombreDe('Compradores', 'ID_Comprador', 'Nombre', k), ...v, precio: v.kg ? v.ingresos / v.kg : 0 })).sort((a, b) => b.precio - a.precio);
  return `
    <div class="kpis">${kpi('Ingresos', fmtS(D.T.ingresos))}${kpi('Kg vendidos', fmtN(D.T.kg))}${kpi('Precio promedio', D.T.kg ? 'S/ ' + fmtN(D.T.precioKg, 2) + '/kg' : '—')}${kpi('Compradores', String(comp.length))}</div>
    ${bloque('precio-comp', '¿Quién paga mejor?', 'Precio promedio por kg de cada comprador.',
      gBarrasH(comp.map(c => ({ label: c.nombre, value: c.precio, color: C.serie1, tip: `${c.nombre}: S/ ${fmtN(c.precio, 2)}/kg · ${fmtN(c.kg)} kg · ${fmtS(c.ingresos)}` })), { fmt: v => 'S/ ' + fmtN(v, 2) }),
      tablaHTML(['Comprador', 'Kg', 'Ingresos', 'S/ por kg'], comp.map(c => [c.nombre, fmtN(c.kg), fmtS(c.ingresos), fmtN(c.precio, 2)])))}
    ${bloque('ing-lote', 'Ingresos por lote', '', gBarrasH(D.porLote.map(l => ({ label: l.nombre.replace(/^Lote /, ''), value: l.ingresos, color: colorLote(l.id), tip: `${l.nombre}: ${fmtS(l.ingresos)} · ${fmtN(l.kg)} kg · S/ ${fmtN(l.precioKg, 2)}/kg` }))),
      tablaHTML(['Lote', 'Kg', 'Ingresos', 'S/ por kg'], D.porLote.map(l => [l.nombre, fmtN(l.kg), fmtS(l.ingresos), l.kg ? fmtN(l.precioKg, 2) : '—'])))}
    ${bloque('kg-mes', 'Kilos vendidos por mes', '', gColumnas(D.listaMeses.map(fechaCorta), [{ nombre: 'Kg', color: C.serie1, valores: D.listaMeses.map(m => D.meses[m].kg) }], { fmt: v => fmtN(v) + ' kg' }),
      tablaHTML(['Mes', 'Kg', 'Ingresos'], D.listaMeses.map(m => [fechaCorta(m), fmtN(D.meses[m].kg), fmtS(D.meses[m].ingresos)])))}
  `;
}

function pestCaja(D) {
  const ser = [{ nombre: 'Ingresos (ventas)', color: C.serie1, valores: D.listaMeses.map(m => D.meses[m].ingresos) },
    { nombre: 'Egresos (planilla, compras y gastos)', color: C.serie2, valores: D.listaMeses.map(m => D.meses[m].egresos) }];
  let acum = 0;
  const filas = D.listaMeses.map(m => { const x = D.meses[m]; acum += x.ingresos - x.egresos; return [fechaCorta(m), fmtS(x.ingresos), fmtS(x.egresos), fmtS(x.ingresos - x.egresos), fmtS(acum)]; });
  const peor = D.listaMeses.reduce((p, m) => (D.meses[m].egresos > (p ? D.meses[p].egresos : -1) ? m : p), null);
  return `
    <p class="ayuda">Plata que entra y sale cada mes en todo el campo. Las compras de insumos cuentan el mes en que se compraron.</p>
    ${bloque('caja', 'Ingresos y egresos por mes', peor ? `Mes con más gasto: <b>${fechaCorta(peor)}</b> (${fmtS(D.meses[peor].egresos)})` : '', leyenda(ser) + gColumnas(D.listaMeses.map(fechaCorta), ser),
      null)}
    <section class="tarjeta"><h3>Detalle por mes</h3>${tablaHTML(['Mes', 'Ingresos', 'Egresos', 'Saldo', 'Acumulado'], filas)}</section>
  `;
}

function pestClima(D) {
  const dias = Tablero.filas('Clima').filter(r => { const f = fechaISO(r.Fecha); return f >= D.R.desde && f <= D.R.hasta; }).sort((a, b) => fechaISO(a.Fecha).localeCompare(fechaISO(b.Fecha)));
  if (!dias.length) return '<p class="vacio">Sin datos de clima para este periodo. Revisa que el módulo Clima esté instalado en el Sheets.</p>';
  // si hay muchos días, agrupar por semana para que se lea mejor
  let grupos = dias.map(d => ({ x: fechaISO(d.Fecha), rs: [d] }));
  const semanal = dias.length > 75;
  if (semanal) {
    const g = {}; dias.forEach(d => { const f = new Date(fechaISO(d.Fecha) + 'T12:00:00'); f.setDate(f.getDate() - ((f.getDay() + 6) % 7)); const k = f.toISOString().slice(0, 10); (g[k] = g[k] || []).push(d); });
    grupos = Object.keys(g).sort().map(k => ({ x: k, rs: g[k] }));
  }
  const prom = (rs, k) => rs.reduce((s, r) => s + num(r[k]), 0) / rs.length;
  const suma = (rs, k) => rs.reduce((s, r) => s + num(r[k]), 0);
  const xs = grupos.map(g => g.x);
  const tmax = grupos.map(g => +prom(g.rs, 'T_Max_C').toFixed(1)), tmin = grupos.map(g => +prom(g.rs, 'T_Min_C').toFixed(1));
  const lluvia = grupos.map(g => +suma(g.rs, 'Lluvia_mm').toFixed(1)), et0 = grupos.map(g => +suma(g.rs, 'ET0_mm').toFixed(1));
  const frescas = dias.filter(d => num(d.T_Min_C) < 18).length;
  const calurosos = dias.filter(d => num(d.T_Max_C) >= 35).length;
  const conLluvia = dias.filter(d => num(d.Lluvia_mm) >= 1).length;
  const serT = [{ nombre: 'Máxima', color: C.serie2, valores: tmax }, { nombre: 'Mínima', color: C.serie1, valores: tmin }];
  // resumen mensual
  const pm = {}; dias.forEach(d => { const k = fechaISO(d.Fecha).slice(0, 7); (pm[k] = pm[k] || []).push(d); });
  const filasMes = Object.keys(pm).sort().map(k => [fechaCorta(k), fmtN(prom(pm[k], 'T_Max_C'), 1) + '°', fmtN(prom(pm[k], 'T_Min_C'), 1) + '°', fmtN(suma(pm[k], 'Lluvia_mm'), 1), fmtN(suma(pm[k], 'ET0_mm'), 0), pm[k].filter(d => num(d.T_Min_C) < 18).length]);
  return `
    <div class="kpis">
      ${kpi('Temperatura promedio', fmtN(prom(dias, 'T_Prom_C'), 1) + ' °C', `máx ${fmtN(Math.max(...dias.map(d => num(d.T_Max_C))), 1)}° · mín ${fmtN(Math.min(...dias.map(d => num(d.T_Min_C))), 1)}°`)}
      ${kpi('Lluvia acumulada', fmtN(suma(dias, 'Lluvia_mm'), 1) + ' mm', conLluvia + ' días con lluvia')}
      ${kpi('Evapotranspiración', fmtN(suma(dias, 'ET0_mm'), 0) + ' mm', 'agua que pierde el cultivo (guía para riego)')}
      ${kpi('Noches frescas', String(frescas), 'días con mínima bajo 18 °C')}
      ${kpi('Días muy calurosos', String(calurosos), 'máxima de 35 °C o más')}
      ${kpi('Días registrados', String(dias.length))}
    </div>
    ${bloque('temp', 'Temperatura', (semanal ? 'Promedio semanal. ' : 'Por día. ') + 'Toca el gráfico para ver cada valor.', leyenda(serT) + gLineas(xs, serT, { unidad: '°' }),
      tablaHTML(['Fecha', 'Máx', 'Mín'], xs.map((x, i) => [fechaCorta(x), tmax[i] + '°', tmin[i] + '°'])))}
    ${bloque('lluvia', 'Lluvia', semanal ? 'Total por semana (mm).' : 'Por día (mm).', gColumnas(xs.map(fechaCorta), [{ nombre: 'Lluvia', color: C.serie1, valores: lluvia }], { fmt: v => fmtN(v, 1) + ' mm' }),
      tablaHTML(['Fecha', 'Lluvia (mm)'], xs.map((x, i) => [fechaCorta(x), lluvia[i]])))}
    ${bloque('et0', 'Evapotranspiración (ET0)', (semanal ? 'Total por semana' : 'Por día') + ' en mm: cuanto más alta, más agua necesita el campo.', gColumnas(xs.map(fechaCorta), [{ nombre: 'ET0', color: C.serie1, valores: et0 }], { fmt: v => fmtN(v, 1) + ' mm' }),
      tablaHTML(['Fecha', 'ET0 (mm)'], xs.map((x, i) => [fechaCorta(x), et0[i]])))}
    <section class="tarjeta"><h3>Resumen por mes</h3>${tablaHTML(['Mes', 'Máx prom', 'Mín prom', 'Lluvia mm', 'ET0 mm', 'Noches <18°'], filasMes)}</section>
  `;
}

// ---------------- Tooltips (toque o mouse) ----------------
function activarTooltips() {
  let tip = document.getElementById('tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'tip'; tip.className = 'tip'; document.body.appendChild(tip); }
  const mostrar = (html, ev) => {
    tip.innerHTML = html; tip.style.display = 'block';
    const x = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, ev.clientX - tip.offsetWidth / 2));
    const y = ev.clientY - tip.offsetHeight - 14;
    tip.style.left = x + 'px'; tip.style.top = (y < 8 ? ev.clientY + 18 : y) + 'px';
  };
  const ocultar = () => { tip.style.display = 'none'; document.querySelectorAll('.cruz').forEach(c => c.setAttribute('visibility', 'hidden')); };
  document.querySelectorAll('.graf .hit').forEach(g => {
    g.addEventListener('pointerenter', e => mostrar(esc(g.dataset.tip).replace(/ · /g, '<br>'), e));
    g.addEventListener('pointermove', e => mostrar(esc(g.dataset.tip).replace(/ · /g, '<br>'), e));
    g.addEventListener('pointerleave', ocultar);
    g.addEventListener('click', e => mostrar(esc(g.dataset.tip).replace(/ · /g, '<br>'), e));
  });
  document.querySelectorAll('svg.lineas').forEach(svg => {
    const d = JSON.parse(decodeURIComponent(svg.dataset.lineas)); const ml = +svg.dataset.ml, aw = +svg.dataset.aw;
    const cruz = svg.querySelector('.cruz');
    const mover = e => {
      const r = svg.getBoundingClientRect(); const esc_ = svg.viewBox.baseVal.width / r.width;
      const px = (e.clientX - r.left) * esc_;
      const i = Math.max(0, Math.min(d.xs.length - 1, Math.round((px - ml) / aw * (d.xs.length - 1))));
      const cx = ml + (d.xs.length === 1 ? aw / 2 : i / (d.xs.length - 1) * aw);
      cruz.setAttribute('x1', cx); cruz.setAttribute('x2', cx); cruz.setAttribute('visibility', 'visible');
      mostrar(`<b>${esc(fechaCorta(d.xs[i]))}</b><br>${d.series.map(s => `${esc(s.n)}: ${s.v[i]}${d.u}`).join('<br>')}`, e);
    };
    const zona = svg.querySelector('.zona');
    zona.addEventListener('pointermove', mover); zona.addEventListener('pointerdown', mover); zona.addEventListener('pointerleave', ocultar);
  });
  document.addEventListener('scroll', ocultar, { once: true, passive: true });
}

// ---------------- Compartir ----------------
async function compartir(D, F) {
  const T = D.T;
  const txt = [`🥭 Campo de mango – ${F.campana}`, `Periodo: ${fechaBonita(D.R.desde)} al ${fechaBonita(D.R.hasta)}`,
    `Lotes: ${D.porLote.map(l => l.nombre.replace(/^Lote /, '')).join(', ')}`, '',
    `Ingresos: ${fmtS(T.ingresos)}`, `Costos: ${fmtS(T.costo)}`, `Utilidad: ${fmtS(T.utilidad)} (margen ${(T.margen * 100).toFixed(1)}%)`,
    `Kg vendidos: ${fmtN(T.kg)}${T.kg ? ` · precio prom. S/ ${fmtN(T.precioKg, 2)}/kg · costo S/ ${fmtN(T.costoKg, 2)}/kg` : ''}`, '',
    ...D.porLote.map(l => `• ${l.nombre}: utilidad ${fmtS(l.utilidad)}${l.kg ? `, ${fmtN(l.kg)} kg` : ''}`)].join('\n');
  try { if (navigator.share) { await navigator.share({ title: 'Resumen del campo', text: txt }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(txt); UI.toast('Resumen copiado. Pégalo en WhatsApp.'); } catch (e) { prompt('Copia el resumen:', txt); }
}
