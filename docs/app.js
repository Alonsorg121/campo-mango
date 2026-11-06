/**
 * APP CAMPO DE MANGO
 * - Datos: copia local de lo último leído del Google Sheets (para usar sin señal).
 * - Cola: registros guardados en el celular que aún no se enviaron al Sheets.
 * - Sync: envía la cola y vuelve a leer el Sheets cuando hay internet.
 * - Vistas: pantallas de la app (inicio, formularios, consultas, ajustes).
 */

// ======================================================================
// Almacenamiento local (IndexedDB)
// ======================================================================
const DB = (() => {
  let dbp;
  function abrir() {
    if (!dbp) dbp = new Promise((ok, mal) => {
      const r = indexedDB.open('campo-mango', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('cola')) db.createObjectStore('cola', { keyPath: 'uid' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => mal(r.error);
    });
    return dbp;
  }
  async function tx(store, modo, fn) {
    const db = await abrir();
    return new Promise((ok, mal) => {
      const t = db.transaction(store, modo);
      const s = t.objectStore(store);
      const res = fn(s);
      t.oncomplete = () => ok(res && res.result !== undefined ? res.result : res);
      t.onerror = () => mal(t.error);
    });
  }
  return {
    get: async k => { const r = await tx('kv', 'readonly', s => s.get(k)); return r ? r.v : undefined; },
    set: (k, v) => tx('kv', 'readwrite', s => s.put({ k, v })),
    colaTodo: () => tx('cola', 'readonly', s => s.getAll()),
    colaPoner: item => tx('cola', 'readwrite', s => s.put(item)),
    colaQuitar: uid => tx('cola', 'readwrite', s => s.delete(uid))
  };
})();

// ======================================================================
// Datos (catálogos + recientes) y cola de envío
// ======================================================================
const Datos = {
  srv: null,      // última respuesta del Sheets
  cola: [],       // pendientes
  config: { api: '', clave: '', campana: '' },

  async cargar() {
    this.srv = (await DB.get('datos')) || null;
    this.cola = ((await DB.colaTodo()) || []).sort((a, b) => a.creado - b.creado);
    this.config = Object.assign(this.config, (await DB.get('config')) || {});
  },
  async guardarConfig() { await DB.set('config', this.config); },

  /** Catálogo con los agregados pendientes incluidos (para usarlos sin señal). */
  catalogo(nombre) {
    const base = (this.srv && this.srv.catalogos && this.srv.catalogos[nombre]) || [];
    const pend = this.cola.filter(c => c.op === 'agregar' && c.tabla === nombre).map(c => Object.assign({ _pendiente: true }, c.registro));
    return base.concat(pend);
  },
  recientes(tabla) {
    const base = (this.srv && this.srv.recientes && this.srv.recientes[tabla]) || [];
    const pend = this.cola.filter(c => c.op === 'agregar' && c.tabla === tabla).map(c => Object.assign({ _pendiente: true, _error: c.error }, c.registro));
    return base.concat(pend);
  },
  campanaActiva() {
    if (this.config.campana) return this.config.campana;
    const cs = this.catalogo('Campanas');
    const a = cs.find(c => c.Estado === 'Activa') || cs[cs.length - 1];
    return a ? a.ID_Campana : '';
  },
  async encolar(item) {
    item.uid = item.uid || nuevoId('OP');
    item.creado = Date.now();
    await DB.colaPoner(item);
    this.cola.push(item);
  }
};

function nuevoId(prefijo) {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return prefijo + '-' + t + r;
}

// ======================================================================
// Sincronización con el Google Sheets
// ======================================================================
const Sync = {
  enCurso: false,
  ultimoError: '',
  async ejecutar(silencioso) {
    if (this.enCurso || !Datos.config.api) return;
    if (!navigator.onLine) { UI.estado(); return; }
    this.enCurso = true; UI.estado();
    try {
      // 1) enviar pendientes en lotes (pocos si llevan fotos)
      let pend = Datos.cola.filter(c => !c.error);
      while (pend.length) {
        const lote = [];
        let pesoFotos = 0;
        for (const c of pend) {
          const f = c.fotos ? Object.keys(c.fotos).length : 0;
          if (lote.length && (lote.length >= 25 || pesoFotos + f > 3)) break;
          lote.push(c); pesoFotos += f;
        }
        const resp = await this.post({ k: Datos.config.clave, ops: lote.map(c => ({ uid: c.uid, op: c.op, tabla: c.tabla, registro: c.registro, fotos: c.fotos, id: c.id, campos: c.campos })) });
        for (const r of resp.resultados || []) {
          const item = Datos.cola.find(c => c.uid === r.uid);
          if (!item) continue;
          if (r.ok) {
            await DB.colaQuitar(item.uid);
            Datos.cola = Datos.cola.filter(c => c.uid !== item.uid);
          } else {
            item.error = r.error; await DB.colaPoner(item);
          }
        }
        pend = Datos.cola.filter(c => !c.error);
        if (lote.every(l => Datos.cola.includes(l) && !l.error)) break; // nada avanzó
      }
      // 2) leer datos actualizados
      const d = await this.get('datos');
      Datos.srv = d; await DB.set('datos', d);
      if (typeof Tablero !== 'undefined' && Tablero.datos) Tablero.actualizar(true);
      this.ultimoError = '';
      if (!silencioso) UI.toast('Datos sincronizados ✓');
    } catch (e) {
      this.ultimoError = String(e.message || e);
      if (!silencioso) UI.toast('No se pudo sincronizar: ' + this.ultimoError);
    } finally {
      this.enCurso = false; UI.estado(); UI.refrescar();
    }
  },
  async get(accion) {
    const u = Datos.config.api + (Datos.config.api.includes('?') ? '&' : '?') + 'accion=' + accion + '&k=' + encodeURIComponent(Datos.config.clave);
    const r = await fetch(u, { redirect: 'follow' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Error');
    return j;
  },
  async post(body) {
    const r = await fetch(Datos.config.api, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Error');
    return j;
  }
};

// ======================================================================
// Utilidades
// ======================================================================
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const soles = n => 'S/ ' + num(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoy = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fechaBonita = s => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return d + '/' + m + '/' + y; };
const nombreDe = (fuente, valor, col, id) => { const r = Datos.catalogo(fuente).find(x => String(x[valor]) === String(id)); return r ? r[col] : id; };

async function comprimirFoto(file) {
  const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(file); });
  const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c.toDataURL('image/jpeg', 0.7);
}

// ======================================================================
// Interfaz
// ======================================================================
const UI = {
  vistaActual: null,
  toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('ver');
    clearTimeout(this._t); this._t = setTimeout(() => t.classList.remove('ver'), 3500);
  },
  estado() {
    const el = $('#estado'); if (!el) return;
    const n = Datos.cola.length, err = Datos.cola.filter(c => c.error).length;
    let txt, cls;
    if (!Datos.config.api) { txt = 'Sin configurar'; cls = 'mal'; }
    else if (Sync.enCurso) { txt = 'Sincronizando…'; cls = 'proc'; }
    else if (!navigator.onLine) { txt = n ? `Sin señal · ${n} por enviar` : 'Sin señal'; cls = 'off'; }
    else if (err) { txt = `${err} con error`; cls = 'mal'; }
    else if (n) { txt = `${n} por enviar`; cls = 'proc'; }
    else { txt = 'Al día ✓'; cls = 'ok'; }
    el.textContent = txt; el.className = 'estado ' + cls;
  },
  refrescar() { if (this.vistaActual && this.vistaActual.refrescable) Router.ir(); },
  pintar(html, opts = {}) {
    $('#main').innerHTML = html;
    $('#titulo').textContent = opts.titulo || 'Campo de mango';
    $('#atras').style.visibility = opts.atras === false ? 'hidden' : 'visible';
    window.scrollTo(0, 0);
  }
};

// ======================================================================
// Rutas (#/...)
// ======================================================================
const Router = {
  ir() {
    const h = location.hash.replace(/^#\/?/, '') || '';
    const [vista, arg] = h.split('/');
    const fn = Vistas[vista || 'inicio'] || Vistas.inicio;
    UI.vistaActual = fn;
    fn(arg ? decodeURIComponent(arg) : undefined);
  }
};
window.addEventListener('hashchange', () => Router.ir());

// ======================================================================
// Vistas
// ======================================================================
const Vistas = {};

Vistas.inicio = () => {
  if (!Datos.config.api) { location.hash = '#/ajustes'; return; }
  const c = Datos.srv && Datos.srv.climaHoy;
  const clima = c ? `<a class="clima-mini" href="#/clima">
      <div class="clima-t">${Math.round(num(c.T_Max_C))}° <small>/ ${Math.round(num(c.T_Min_C))}°</small></div>
      <div>Hoy · lluvia ${num(c.Lluvia_mm).toFixed(1)} mm · ET0 ${num(c.ET0_mm).toFixed(1)} mm</div></a>` : '';
  const grupo = (g, titulo) => { const fs = FORMULARIOS.filter(f => f.grupo === g); return fs.length ? `<h2 class="sec">${titulo}</h2>
    <div class="grid">${fs.map(f => `<a class="btn-grande" href="#/form/${f.id}"><span class="ico">${f.icono}</span>${esc(f.titulo)}</a>`).join('')}</div>` : ''; };
  const pendientePago = (Datos.srv && Datos.srv.planillaPendiente || []).length;
  UI.pintar(`
    ${clima}
    ${grupo('campo', '🌱 Campo')}
    ${grupo('evaluacion', '🔍 Evaluaciones')}
    ${grupo('plata', '💰 Plata')}
    <h2 class="sec">Consultar</h2>
    <div class="grid">
      <a class="btn-grande sec2 destacado" href="#/tablero"><span class="ico">📈</span>Tablero y reportes</a>
      <a class="btn-grande sec2" href="#/pagar"><span class="ico">🧾</span>Pagar planilla${pendientePago ? `<span class="badge">${pendientePago}</span>` : ''}</a>
      <a class="btn-grande sec2" href="#/stock"><span class="ico">📦</span>Stock de insumos</a>
      <a class="btn-grande sec2" href="#/cobrar"><span class="ico">📒</span>Por cobrar</a>
      <a class="btn-grande sec2" href="#/clima"><span class="ico">🌤️</span>Clima</a>
      <a class="btn-grande sec2" href="#/historial"><span class="ico">🕘</span>Últimos registros</a>
    </div>
    <h2 class="sec">Más</h2>
    <div class="lista-links">
      ${FORMULARIOS.filter(f => f.menu === 'mas').map(f => `<a href="#/form/${f.id}">${f.icono} ${esc(f.titulo)}</a>`).join('')}
      <a href="#/ajustes">⚙️ Ajustes</a>
    </div>
    <p class="pie">Actualizado: ${Datos.srv ? new Date(Datos.srv.actualizado).toLocaleString('es-PE') : 'nunca'} · v${self.APP_VERSION}</p>
  `, { atras: false });
};
Vistas.inicio.refrescable = true;

// ---------------- Formularios ----------------
Vistas.form = (id) => {
  const F = FORMULARIOS.find(f => f.id === id);
  if (!F) { location.hash = '#/'; return; }
  const v = {}; // valores
  F.campos.forEach(c => {
    if (c.t === 'fecha') v[c.n] = hoy();
    else if (c.t === 'campana') v[c.n] = Datos.campanaActiva();
    else if (c.t === 'multi') v[c.n] = [];
    else if (c.def !== undefined) v[c.n] = c.def;
  });

  const opcionesDe = (c) => {
    if (c.fuente === '@ventasDelComprador') {
      return Datos.recientes('Ventas').filter(r => r.Comprador === v.Comprador)
        .map(r => ({ v: r.ID_Venta, t: `${fechaBonita(r.Fecha)} · ${r.Cantidad} ${r.Unidad} · ${soles(num(r.Cantidad) * num(r.Precio_Unitario))}` }));
    }
    if (c.fuente === '@cosechasSinVender') {
      const usadas = new Set(Datos.recientes('Ventas').map(r => r.ID_Cosecha).filter(Boolean));
      return Datos.recientes('Cosecha').filter(r => !usadas.has(r.ID) || r.ID === v.ID_Cosecha).slice(-15).reverse()
        .map(r => ({ v: r.ID, t: `${fechaBonita(r.Fecha)} · ${nombreDe('Lotes', 'ID_Lote', 'Nombre', r.Lote)} · ${Math.round(kgNetosCosecha(r)).toLocaleString('es-PE')} kg` }));
    }
    return Datos.catalogo(c.fuente).filter(c.filtro || (() => true)).map(r => ({ v: r[c.valor], t: r[c.texto] + (r._pendiente ? ' (nuevo)' : '') }));
  };
  const etq = c => (typeof c.etiqueta === 'function' ? c.etiqueta(v) : c.etiqueta) || c.n.replace(/_/g, ' ');
  const req = c => typeof c.req === 'function' ? c.req(v) : !!c.req;

  function campoHTML(c) {
    if (c.t === 'oculto' || c.t === 'campana') return '';
    if (c.si && !c.si(v)) return '';
    const l = `<label class="etq">${esc(etq(c))}${req(c) ? ' <b class="req">*</b>' : ''}</label>`;
    const val = v[c.n] ?? '';
    switch (c.t) {
      case 'fecha': return `<div class="campo">${l}<input type="date" data-n="${c.n}" value="${esc(val)}"></div>`;
      case 'num': return `<div class="campo">${l}<input type="number" inputmode="decimal" step="any" data-n="${c.n}" value="${esc(val)}"></div>`;
      case 'texto': return `<div class="campo">${l}<input type="text" data-n="${c.n}" value="${esc(val)}"></div>`;
      case 'nota': return `<div class="campo">${l}<textarea rows="2" data-n="${c.n}">${esc(val)}</textarea></div>`;
      case 'select': {
        const ops = opcionesDe(c);
        if (!ops.length && !String(c.fuente).startsWith('@')) return `<div class="campo">${l}<div class="aviso">No hay datos en ${esc(c.fuente)}. Sincroniza o agrégalos en "Más".</div></div>`;
        return `<div class="campo">${l}<select data-n="${c.n}"><option value="">— Elegir —</option>${ops.map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(val) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></div>`;
      }
      case 'multi': {
        const ops = opcionesDe(c);
        return `<div class="campo">${l}<div class="multi">${ops.map(o => `<label class="chk"><input type="checkbox" data-multi="${c.n}" value="${esc(o.v)}" ${val.includes(o.v) ? 'checked' : ''}> ${esc(o.t)}</label>`).join('') || '<div class="aviso">No hay trabajadores. Agrégalos en "Más".</div>'}</div></div>`;
      }
      case 'opciones': return `<div class="campo">${l}<div class="ops">${c.opciones.map(o => `<button type="button" class="op ${val === o ? 'sel' : ''}" data-op="${c.n}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>`;
      case 'foto': return `<div class="campo">${l}<label class="foto-btn">${v['_foto_' + c.n] ? `<img src="${v['_foto_' + c.n]}">` : '📷 Tomar foto'}<input type="file" accept="image/*" capture="environment" data-foto="${c.n}" hidden></label></div>`;
    }
    return '';
  }

  function render() {
    const fmtTot = F.totalFmt || soles;
    const tot = F.total ? `<div class="total">${esc(F.totalEtiqueta || 'Total')}: <b>${fmtTot(F.total(v))}</b></div>` : '';
    UI.pintar(`
      <form id="frm" class="frm" autocomplete="off">
        ${F.ayuda ? `<p class="ayuda">${esc(F.ayuda)}</p>` : ''}
        ${F.campos.map(campoHTML).join('')}
        ${tot}
        <button class="guardar" type="submit">Guardar</button>
      </form>`, { titulo: F.icono + ' ' + F.titulo });
    const frm = $('#frm');
    frm.addEventListener('input', e => {
      const n = e.target.dataset.n; if (!n) return;
      v[n] = e.target.value;
      v['_manual_' + n] = true;
      if (e.target.tagName === 'SELECT') {
        const campo = F.campos.find(c => c.n === n);
        if (campo && campo.rellena && v[n]) {
          const r = campo.fuente === '@cosechasSinVender' ? Datos.recientes('Cosecha').find(x => x.ID === v[n]) : null;
          if (r) Object.assign(v, campo.rellena(r, v));
        }
        aplicarDefDesde(n); render(); return;
      }
      const t = $('.total b'); if (t && F.total) t.textContent = (F.totalFmt || soles)(F.total(v));
    });
    frm.addEventListener('change', e => {
      const m = e.target.dataset.multi;
      if (m) {
        v[m] = [...frm.querySelectorAll(`[data-multi="${m}"]:checked`)].map(x => x.value);
        aplicarDefDesde(m);
        const t = $('.total b'); if (t && F.total) t.textContent = (F.totalFmt || soles)(F.total(v));
        const tar = frm.querySelector('[data-n="Tarifa"]'); if (tar && v.Tarifa !== undefined) tar.value = v.Tarifa;
      }
    });
    frm.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => {
      v[b.dataset.op] = v[b.dataset.op] === b.dataset.v && !F.campos.find(c => c.n === b.dataset.op).req ? '' : b.dataset.v;
      render();
    }));
    frm.querySelectorAll('[data-foto]').forEach(inp => inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      try { v['_foto_' + inp.dataset.foto] = await comprimirFoto(inp.files[0]); render(); }
      catch (e) { UI.toast('No se pudo leer la foto'); }
    }));
    frm.addEventListener('submit', e => { e.preventDefault(); guardar(); });
  }

  function aplicarDefDesde(n) {
    F.campos.filter(c => c.defDesde && c.defDesde.campo === n).forEach(c => {
      const d = c.defDesde; const sel = Array.isArray(v[n]) ? v[n][0] : v[n];
      const r = Datos.catalogo(d.fuente).find(x => String(x[d.valor]) === String(sel));
      if (r && r[d.columna] !== '' && r[d.columna] !== undefined) v[c.n] = r[d.columna];
    });
  }

  async function guardar() {
    // validar
    for (const c of F.campos) {
      if (c.si && !c.si(v)) continue;
      const x = v[c.n];
      if (req(c) && (x === undefined || x === '' || (Array.isArray(x) && !x.length))) { UI.toast('Falta: ' + etq(c)); return; }
    }
    // construir registro(s)
    const base = {};
    const fotos = {};
    F.campos.forEach(c => {
      if (c.si && !c.si(v)) return;
      if (c.t === 'foto') { const d = v['_foto_' + c.n]; if (d) fotos[c.n] = { b64: d.split(',')[1], mime: 'image/jpeg' }; return; }
      if (c.desde) { base[c.n] = c.desde(v); return; }
      let x = v[c.n];
      if (x === undefined || x === '') return;
      if (c.t === 'num') x = num(x);
      base[c.n] = x;
    });
    const multi = F.campos.find(c => c.t === 'multi');
    const lista = multi ? base[multi.n].map(id => {
      const r = Object.assign({}, base, { [multi.n]: id });
      // si la tarifa no se escribió a mano, cada trabajador lleva su propio jornal base
      F.campos.filter(c => c.defDesde && c.defDesde.campo === multi.n && !v['_manual_' + c.n]).forEach(c => {
        const d = c.defDesde; const fila = Datos.catalogo(d.fuente).find(x => String(x[d.valor]) === String(id));
        if (fila && fila[d.columna] !== '' && fila[d.columna] !== undefined) r[c.n] = num(fila[d.columna]);
      });
      return r;
    }) : [base];
    const hoja = F.tabla;
    for (const reg of lista) {
      const clave = claveDe(hoja);
      reg[clave] = nuevoId(F.prefijo);
      await Datos.encolar({ op: 'agregar', tabla: hoja, registro: reg, fotos: Object.keys(fotos).length ? fotos : undefined });
    }
    UI.toast(lista.length > 1 ? `Guardados ${lista.length} registros ✓` : 'Guardado ✓');
    UI.estado();
    Sync.ejecutar(true);
    location.hash = F.catalogo ? '#/' : '#/historial/' + hoja;
  }

  render();
};

function claveDe(hoja) {
  return ({ Ventas: 'ID_Venta', Trabajadores: 'ID_Trabajador', Productos: 'ID_Producto', Proveedores: 'ID_Proveedor', Compradores: 'ID_Comprador' })[hoja] || 'ID';
}

// ---------------- Pagar planilla ----------------
Vistas.pagar = () => {
  const yaMarcados = new Set(Datos.cola.filter(c => c.op === 'editar' && c.tabla === 'Planilla').map(c => c.id));
  const pend = (Datos.srv && Datos.srv.planillaPendiente || []).filter(r => !yaMarcados.has(r.ID))
    .concat(Datos.recientes('Planilla').filter(r => r._pendiente && r.Pagado !== 'Sí'));
  const porT = {};
  pend.forEach(r => { (porT[r.Trabajador] = porT[r.Trabajador] || []).push(r); });
  const bloques = Object.keys(porT).map(t => {
    const filas = porT[t]; const tot = filas.reduce((s, r) => s + num(r.Cantidad) * num(r.Tarifa), 0);
    return `<div class="tarjeta">
      <label class="chk grande"><input type="checkbox" data-t="${esc(t)}" ${filas.some(r => r._pendiente) ? 'disabled' : ''}> <b>${esc(nombreDe('Trabajadores', 'ID_Trabajador', 'Nombres', t))}</b> <span class="der">${soles(tot)}</span></label>
      <div class="det">${filas.map(r => `${fechaBonita(r.Fecha)} · ${esc(r.Labor)} · ${r.Cantidad} × ${soles(r.Tarifa)}${r._pendiente ? ' <i>(por enviar)</i>' : ''}`).join('<br>')}</div>
    </div>`;
  }).join('');
  const total = pend.reduce((s, r) => s + num(r.Cantidad) * num(r.Tarifa), 0);
  UI.pintar(pend.length ? `
    <div class="total">Total pendiente: <b>${soles(total)}</b></div>
    ${bloques}
    <button class="guardar" id="pagar">Marcar seleccionados como pagados</button>
    <p class="pie">Los registros “por enviar” se podrán pagar cuando se sincronicen.</p>`
    : `<p class="vacio">No hay jornales pendientes de pago 🎉</p>`, { titulo: '🧾 Pagar planilla' });
  const b = $('#pagar');
  if (b) b.onclick = async () => {
    const sel = [...document.querySelectorAll('[data-t]:checked')].map(x => x.dataset.t);
    if (!sel.length) { UI.toast('Elige al menos un trabajador'); return; }
    let n = 0;
    for (const t of sel) for (const r of porT[t]) {
      if (r._pendiente) continue;
      await Datos.encolar({ op: 'editar', tabla: 'Planilla', id: r.ID, campos: { Pagado: 'Sí', Fecha_Pago: hoy() } }); n++;
    }
    UI.toast(`${n} jornales marcados como pagados ✓`);
    UI.estado(); Sync.ejecutar(true); Router.ir();
  };
};
Vistas.pagar.refrescable = true;

// ---------------- Resumen ----------------
Vistas.resumen = () => {
  const r = Datos.srv && Datos.srv.resumen;
  if (!r) { UI.pintar('<p class="vacio">Aún no hay datos. Sincroniza con internet.</p>', { titulo: '📊 Resumen' }); return; }
  const [enc, ...filas] = r.tabla;
  const col = n => enc.findIndex(h => h.startsWith(n));
  const tarjetas = filas.filter(f => f[0]).map(f => `
    <div class="tarjeta ${f[0] === 'TOTAL' ? 'tot' : ''}">
      <h3>${esc(f[0] === 'TOTAL' ? 'Todo el campo' : nombreDe('Lotes', 'ID_Lote', 'Nombre', f[0]))}</h3>
      <div class="kv"><span>Ingresos</span><b>${esc(f[col('Ingresos')])}</b></div>
      <div class="kv"><span>Costo total</span><b>${esc(f[col('Costo total')])}</b></div>
      <div class="kv"><span>Utilidad</span><b class="${String(f[col('Utilidad')]).includes('-') ? 'neg' : 'pos'}">${esc(f[col('Utilidad')])}</b></div>
      <div class="kv"><span>Mano de obra · Insumos · Otros</span><span>${esc(f[col('Mano')])} · ${esc(f[col('Insumos')])} · ${esc(f[col('Otros')])}</span></div>
      <div class="kv"><span>Kg vendidos</span><span>${esc(f[col('Kg vendidos')])}</span></div>
      <div class="kv"><span>Costo por ha · por kg</span><span>${esc(f[col('Costo por ha')])} · ${esc(f[col('Costo por kg')])}</span></div>
      <div class="kv"><span>Precio promedio por kg</span><span>${esc(f[col('Precio promedio')])}</span></div>
    </div>`).join('');
  const extra = (r.extra || []).filter(f => f[0] && (f[1] || f[3])).map(f => `<div class="kv"><span>${esc(f[0])}</span><b>${esc(f[1] || f[3])}</b></div>`).join('');
  UI.pintar(`<p class="ayuda">Campaña <b>${esc(r.campana)}</b> · según el último sincronizado.</p>${tarjetas}<div class="tarjeta">${extra}</div>`, { titulo: '📊 Resumen por lote' });
};
Vistas.resumen.refrescable = true;

// ---------------- Stock ----------------
Vistas.stock = () => {
  const ps = Datos.catalogo('Productos');
  UI.pintar(ps.length ? ps.map(p => `
    <div class="tarjeta fila ${p.Alerta_Stock === 'COMPRAR' ? 'alerta' : ''}">
      <div><b>${esc(p.Nombre)}</b><div class="det">${esc(p.Tipo || '')}${p._pendiente ? ' · nuevo' : ''}</div></div>
      <div class="der grande">${p.Stock_Actual === undefined || p.Stock_Actual === '' ? '—' : num(p.Stock_Actual).toLocaleString('es-PE')} ${esc(p.Unidad || '')}
        ${p.Alerta_Stock === 'COMPRAR' ? '<div class="tag">Comprar</div>' : ''}</div>
    </div>`).join('') + '<p class="pie">Stock = compras − aplicaciones, al último sincronizado.</p>'
    : '<p class="vacio">No hay insumos registrados.</p>', { titulo: '📦 Stock de insumos' });
};
Vistas.stock.refrescable = true;

// ---------------- Por cobrar ----------------
Vistas.cobrar = () => {
  const cs = Datos.catalogo('Compradores');
  const tot = cs.reduce((s, c) => s + num(c.Saldo_por_Cobrar), 0);
  UI.pintar(`<div class="total">Total por cobrar: <b>${soles(tot)}</b></div>` + cs.map(c => `
    <div class="tarjeta fila">
      <div><b>${esc(c.Nombre)}</b><div class="det">${esc(c.Tipo || '')} · vendido ${soles(c.Total_Vendido)} · cobrado ${soles(c.Total_Cobrado)}</div></div>
      <div class="der grande ${num(c.Saldo_por_Cobrar) > 0 ? 'neg' : ''}">${soles(c.Saldo_por_Cobrar)}</div>
    </div>`).join(''), { titulo: '📒 Por cobrar' });
};
Vistas.cobrar.refrescable = true;

// ---------------- Clima ----------------
Vistas.clima = () => {
  const h = Datos.srv && Datos.srv.climaHoy; const dias = (Datos.srv && Datos.srv.clima || []).slice().reverse();
  UI.pintar(`
    ${h ? `<div class="tarjeta clima-hoy">
      <div class="clima-t">${num(h.T_Max_C).toFixed(1)}° <small>máx</small> · ${num(h.T_Min_C).toFixed(1)}° <small>mín</small></div>
      <div class="kv"><span>Temperatura promedio</span><b>${num(h.T_Prom_C).toFixed(1)} °C</b></div>
      <div class="kv"><span>Lluvia</span><b>${num(h.Lluvia_mm).toFixed(1)} mm</b></div>
      <div class="kv"><span>Humedad</span><b>${Math.round(num(h.Humedad_Prom_pct))} %</b></div>
      <div class="kv"><span>Evapotranspiración (ET0)</span><b>${num(h.ET0_mm).toFixed(1)} mm</b></div>
      <div class="kv"><span>Viento máx.</span><b>${Math.round(num(h.Viento_Max_kmh))} km/h</b></div>
    </div>` : '<p class="vacio">Aún no hay clima. Instala el módulo de clima en el Sheets.</p>'}
    ${dias.length ? `<h2 class="sec">Últimos días</h2><table class="tabla"><tr><th>Fecha</th><th>Máx</th><th>Mín</th><th>Lluvia</th><th>ET0</th></tr>
      ${dias.map(d => `<tr><td>${fechaBonita(d.Fecha)}</td><td>${num(d.T_Max_C).toFixed(1)}°</td><td>${num(d.T_Min_C).toFixed(1)}°</td><td>${num(d.Lluvia_mm).toFixed(1)}</td><td>${num(d.ET0_mm).toFixed(1)}</td></tr>`).join('')}</table>` : ''}
  `, { titulo: '🌤️ Clima del campo' });
};
Vistas.clima.refrescable = true;

// ---------------- Historial ----------------
Vistas.historial = (tabla) => {
  const F = FORMULARIOS.filter(f => !f.catalogo);
  const t = tabla || 'Planilla';
  const rs = Datos.recientes(t).slice().reverse();
  const desc = r => {
    switch (t) {
      case 'Planilla': return `${esc(nombreDe('Trabajadores', 'ID_Trabajador', 'Nombres', r.Trabajador))} · ${esc(r.Labor)} · ${r.Cantidad} × ${soles(r.Tarifa)}`;
      case 'Ventas': return `${esc(nombreDe('Compradores', 'ID_Comprador', 'Nombre', r.Comprador))} · ${r.Cantidad} ${esc(r.Unidad)} · ${soles(num(r.Cantidad) * num(r.Precio_Unitario))}`;
      case 'Aplicaciones': return `${esc(nombreDe('Productos', 'ID_Producto', 'Nombre', r.Producto))} · ${r.Cantidad} · ${esc(r.Metodo || '')}`;
      case 'Compras_Insumos': return `${esc(nombreDe('Productos', 'ID_Producto', 'Nombre', r.Producto))} · ${r.Cantidad} × ${soles(r.Precio_Unitario)}`;
      case 'Costos': return `${esc(r.Categoria)} · ${esc(r.Concepto)} · ${soles(r.Monto)}`;
      case 'Cobros': return `${esc(nombreDe('Compradores', 'ID_Comprador', 'Nombre', r.Comprador))} · ${esc(r.Tipo)} · ${soles(r.Monto)}`;
      case 'Bitacora_Labores': return `${esc(r.Labor)} · ${esc(r.Detalle || '')}`;
      case 'Cosecha': return `${r.Cantidad} ${esc(r.Unidad === 'Kg' ? 'kg' : 'jabas')} · ${Math.round(kgNetosCosecha(r)).toLocaleString('es-PE')} kg buenos${num(r.Kg_Descarte) ? ' · descarte ' + r.Kg_Descarte + ' kg (' + esc(r.Causa_Descarte || '') + ')' : ''}`;
      case 'Riego': return `${r.Horas ? r.Horas + ' h' : ''}${r.M3 ? ' · ' + r.M3 + ' m³' : ''}`;
      case 'Floracion': return `${esc(r.Etapa)}${r.Pct_Plantas ? ' · ' + r.Pct_Plantas + '% con flor' : ''}${r.Cuajado ? ' · cuajado ' + esc(r.Cuajado) : ''}`;
      case 'Sanidad': return `${esc(r.Plaga)} · nivel ${esc(r.Nivel)}${r.Capturas ? ' · ' + r.Capturas + ' moscas en ' + r.Trampas + ' trampas' : ''}${r.Pct_Afectado ? ' · ' + r.Pct_Afectado + '% afectado' : ''}`;
      case 'Analisis': return `${esc(r.Tipo)} · ${esc(r.Resumen || '')}`;
      case 'Plan_Fertilizacion': return `${esc(nombreDe('Productos', 'ID_Producto', 'Nombre', r.Producto))} · ${esc(r.Fase)} · ${r.Cantidad_Programada}`;
    }
    return esc(JSON.stringify(r));
  };
  UI.pintar(`
    <div class="tabs">${F.map(f => `<a class="${f.tabla === t ? 'sel' : ''}" href="#/historial/${f.tabla}">${f.icono} ${esc(f.titulo)}</a>`).join('')}</div>
    ${rs.length ? rs.map(r => `<div class="tarjeta ${r._error ? 'alerta' : ''}">
      <div class="det">${fechaBonita(r.Fecha)} ${r.Lote ? '· ' + esc(nombreDe('Lotes', 'ID_Lote', 'Nombre', r.Lote)) : ''}
        ${r._pendiente ? `<span class="tag ${r._error ? '' : 'proc'}">${r._error ? 'Error' : 'Por enviar'}</span>` : ''}</div>
      <div>${desc(r)}</div>
      ${r._error ? `<div class="err">${esc(r._error)} <button class="mini" data-reint="${esc(r.ID || r.ID_Venta)}">Reintentar</button> <button class="mini" data-borrar="${esc(r.ID || r.ID_Venta)}">Descartar</button></div>` : ''}
    </div>`).join('') : '<p class="vacio">Sin registros todavía.</p>'}
    <p class="pie">Para corregir un registro ya enviado, edítalo en el Google Sheets.</p>
  `, { titulo: '🕘 Últimos registros' });
  const buscar = id => Datos.cola.find(c => c.registro && (c.registro.ID === id || c.registro.ID_Venta === id));
  document.querySelectorAll('[data-reint]').forEach(b => b.onclick = async () => { const c = buscar(b.dataset.reint); if (c) { delete c.error; await DB.colaPoner(c); Sync.ejecutar(); } });
  document.querySelectorAll('[data-borrar]').forEach(b => b.onclick = async () => {
    const c = buscar(b.dataset.borrar); if (!c || !confirmar('¿Descartar este registro? No se enviará.')) return;
    await DB.colaQuitar(c.uid); Datos.cola = Datos.cola.filter(x => x !== c); UI.estado(); Router.ir();
  });
};
Vistas.historial.refrescable = true;

function confirmar(msg) { return window.confirm(msg); }

// ---------------- Ajustes ----------------
// ---------------- PIN de administrador (protege la conexión en este dispositivo) ----------------
const Pin = {
  desbloqueadoHasta: 0,
  async hash(pin) {
    const d = new TextEncoder().encode('campo-mango:' + pin);
    const h = await crypto.subtle.digest('SHA-256', d);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  },
  tiene() { return !!Datos.config.pinHash; },
  /** Pide el PIN (si existe). Devuelve true si se puede continuar. Queda desbloqueado 5 minutos. */
  async verificar(motivo) {
    if (!this.tiene() || Date.now() < this.desbloqueadoHasta) return true;
    const pin = await pedirPin(motivo || 'Ingresa el PIN de administrador');
    if (pin === null) return false;
    if (await this.hash(pin) !== Datos.config.pinHash) { UI.toast('PIN incorrecto'); return false; }
    this.desbloqueadoHasta = Date.now() + 5 * 60 * 1000;
    return true;
  }
};

function pedirPin(titulo, confirmarTxt) {
  return new Promise(ok => {
    const capa = document.createElement('div');
    capa.className = 'capa';
    capa.innerHTML = `<form class="modal"><h3>🔒 ${esc(titulo)}</h3>
      <input type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="PIN" id="pin-in">
      <div class="modal-bts"><button type="button" class="mini" id="pin-no">Cancelar</button><button type="submit" class="guardar chico">${esc(confirmarTxt || 'Aceptar')}</button></div></form>`;
    document.body.appendChild(capa);
    const inp = capa.querySelector('#pin-in'); setTimeout(() => inp.focus(), 50);
    const fin = v => { capa.remove(); ok(v); };
    capa.querySelector('#pin-no').onclick = () => fin(null);
    capa.querySelector('form').onsubmit = e => { e.preventDefault(); fin(inp.value.trim()); };
  });
}

const ocultarUrl = u => { const m = String(u).match(/\/s\/([^/]+)\//); return m ? 'script.google.com/…' + m[1].slice(-6) + '/exec' : (u ? '••••••' : '—'); };

// ---------------- Ajustes ----------------
let ajustesEditar = false; // solo se activa después de pasar el PIN (no por la URL)
Vistas.ajustes = () => {
  const cs = Datos.catalogo('Campanas');
  const configurada = !!Datos.config.api;
  const editar = !configurada || ajustesEditar;
  ajustesEditar = false;
  const formConexion = `
    <form id="aj" class="frm">
      ${!configurada ? '<p class="ayuda">Primera vez: pega la URL de la API y la clave (las obtienes al instalar el Apps Script). O abre el enlace de configuración que te enviaron.</p>' : ''}
      <div class="campo"><label class="etq">URL de la API (Apps Script)</label><input type="url" id="api" value="${esc(Datos.config.api)}" placeholder="https://script.google.com/macros/s/.../exec" autocomplete="off"></div>
      <div class="campo"><label class="etq">Clave</label>
        <div class="con-ojo"><input type="password" id="clave" value="${esc(Datos.config.clave)}" autocomplete="off"><button type="button" class="ojo" id="ojo" aria-label="Mostrar clave">👁</button></div></div>
      <button class="guardar" type="submit">Guardar y probar conexión</button>
      ${configurada ? '<a class="mini centro" href="#/ajustes">Cancelar</a>' : ''}
    </form>`;
  const tarjetaConexion = `
    <div class="tarjeta">
      <div class="kv"><span>Conexión</span><b>${Sync.ultimoError ? '⚠️ con problemas' : '✓ conectada'}</b></div>
      <div class="kv"><span>API</span><span>${esc(ocultarUrl(Datos.config.api))}</span></div>
      <div class="kv"><span>Clave</span><span>••••••••</span></div>
      <button class="mini" id="ver-con">🔒 Ver o cambiar conexión</button>
      <button class="mini" id="enlace">🔒 Copiar enlace de configuración</button>
    </div>
    <div class="tarjeta">
      <div class="kv"><span>PIN de administrador</span><b>${Pin.tiene() ? '✓ activado' : 'sin PIN'}</b></div>
      ${Pin.tiene() ? '' : '<div class="det">Crea un PIN para que nadie más pueda ver la conexión ni copiar el enlace desde este celular.</div>'}
      <button class="mini" id="pin">${Pin.tiene() ? 'Cambiar o quitar PIN' : 'Crear PIN'}</button>
      ${Pin.tiene() ? `<label class="chk mini-chk"><input type="checkbox" id="pin-tab" ${Datos.config.pinTablero ? 'checked' : ''}> Pedir PIN para ver el Tablero (montos de plata)</label>` : ''}
    </div>`;
  UI.pintar(`
    ${editar ? formConexion : tarjetaConexion}
    ${configurada && !editar && cs.length ? `<div class="tarjeta"><div class="campo"><label class="etq">Campaña para los registros</label><select id="camp"><option value="">Automática (activa)</option>${cs.map(c => `<option ${Datos.config.campana === c.ID_Campana ? 'selected' : ''}>${esc(c.ID_Campana)}</option>`).join('')}</select></div></div>` : ''}
    <div class="tarjeta">
      <div class="kv"><span>Versión de la app</span><b>${self.APP_VERSION}</b></div>
      <div class="kv"><span>Versión de la API</span><b>${esc(Datos.srv ? Datos.srv.version : '—')}</b></div>
      <div class="kv"><span>Registros por enviar</span><b>${Datos.cola.length}</b></div>
      ${Sync.ultimoError ? `<div class="err">Último error: ${esc(Sync.ultimoError)}</div>` : ''}
      ${configurada ? '<button class="mini" id="sinc">Sincronizar ahora</button>' : ''}
    </div>`, { titulo: '⚙️ Ajustes', atras: configurada });

  if (editar) {
    $('#ojo').onclick = () => { const c = $('#clave'); c.type = c.type === 'password' ? 'text' : 'password'; };
    $('#aj').onsubmit = async e => {
      e.preventDefault();
      Datos.config.api = $('#api').value.trim(); Datos.config.clave = $('#clave').value.trim();
      await Datos.guardarConfig();
      try { await Sync.get('ping'); UI.toast('Conexión correcta ✓'); await Sync.ejecutar(true); location.hash = '#/'; }
      catch (err) { UI.toast('No conecta: ' + (err.message || err)); }
    };
  } else {
    $('#ver-con').onclick = async () => { if (await Pin.verificar('PIN para ver la conexión')) { ajustesEditar = true; Vistas.ajustes(); } };
    $('#enlace').onclick = async () => {
      if (!(await Pin.verificar('PIN para copiar el enlace'))) return;
      const u = location.origin + location.pathname + '#/config?api=' + encodeURIComponent(Datos.config.api) + '&k=' + encodeURIComponent(Datos.config.clave);
      try { await navigator.clipboard.writeText(u); UI.toast('Enlace copiado. Envíalo y bórralo del chat cuando lo usen.'); } catch (e) { prompt('Copia este enlace:', u); }
    };
    $('#pin').onclick = async () => {
      if (Pin.tiene() && !(await Pin.verificar('PIN actual'))) return;
      const p1 = await pedirPin(Pin.tiene() ? 'Nuevo PIN (vacío = quitar PIN)' : 'Crea un PIN (4 a 12 números)', 'Siguiente');
      if (p1 === null) return;
      if (p1 === '' && Pin.tiene()) { delete Datos.config.pinHash; delete Datos.config.pinTablero; await Datos.guardarConfig(); UI.toast('PIN quitado'); Vistas.ajustes(); return; }
      if (!/^\d{4,12}$/.test(p1)) { UI.toast('El PIN debe tener de 4 a 12 números'); return; }
      const p2 = await pedirPin('Repite el PIN', 'Guardar');
      if (p2 !== p1) { UI.toast('Los PIN no coinciden'); return; }
      Datos.config.pinHash = await Pin.hash(p1); await Datos.guardarConfig();
      Pin.desbloqueadoHasta = 0;
      UI.toast('PIN guardado ✓'); Vistas.ajustes();
    };
    const pt = $('#pin-tab');
    if (pt) pt.onchange = async () => {
      if (!(await Pin.verificar('PIN para cambiar esta opción'))) { pt.checked = !pt.checked; return; }
      Datos.config.pinTablero = pt.checked; await Datos.guardarConfig(); UI.toast(pt.checked ? 'El Tablero pedirá PIN ✓' : 'El Tablero ya no pide PIN');
    };
    const camp = $('#camp');
    if (camp) camp.onchange = async () => { Datos.config.campana = camp.value; await Datos.guardarConfig(); UI.toast('Campaña guardada ✓'); };
  }
  const sinc = $('#sinc'); if (sinc) sinc.onclick = () => Sync.ejecutar();
};

// Enlace de configuración: #/config?api=...&k=...
Vistas.config = () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (q.get('api')) { Datos.config.api = q.get('api'); Datos.config.clave = q.get('k') || ''; Datos.guardarConfig().then(() => { UI.toast('App configurada ✓'); Sync.ejecutar(true); }); }
  history.replaceState(null, '', location.pathname + '#/');
  Router.ir();
};
// el router separa por "/", así que "config?api=..." llega como vista "config?api=..."
const _ir = Router.ir;
Router.ir = function () { if (location.hash.startsWith('#/config')) return Vistas.config(); return _ir.call(Router); };

// ======================================================================
// Inicio
// ======================================================================
(async function iniciar() {
  $('#atras').onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/'; };
  await Datos.cargar();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  UI.estado(); Router.ir();
  window.addEventListener('online', () => { UI.estado(); Sync.ejecutar(true); });
  window.addEventListener('offline', () => UI.estado());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Sync.ejecutar(true); });
  setInterval(() => Sync.ejecutar(true), 120000);
  Sync.ejecutar(true);

  // Modo offline y actualizaciones de versión
  if ('serviceWorker' in navigator) {
    const habiaVersion = !!navigator.serviceWorker.controller;
    const reg = await navigator.serviceWorker.register('sw.js').catch(() => null);
    if (reg) {
      const avisar = w => {
        const b = $('#nueva'); b.hidden = false;
        b.onclick = () => { w.postMessage('activar'); };
      };
      if (reg.waiting && habiaVersion) avisar(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => { if (w.state === 'installed' && habiaVersion) avisar(w); });
      });
      let recargado = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (habiaVersion && !recargado) { recargado = true; location.reload(); } });
      setInterval(() => reg.update().catch(() => {}), 3600000);
    }
  }
})();
