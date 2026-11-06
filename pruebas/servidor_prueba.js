/**
 * Servidor de PRUEBAS (no se usa en producción).
 * Sirve la app y simula Google Sheets + Apps Script ejecutando el MISMO Api.gs real
 * contra una copia de la plantilla, recalculando fórmulas con LibreOffice.
 * uso: node servidor_prueba.js [puerto]
 */
const http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const RAIZ = path.join(__dirname, '..');
const PLANTILLA = process.env.PLANTILLA || path.join(RAIZ, 'plantilla', 'Campo_Mango_BaseDatos.xlsx');
const TMP = fs.mkdtempSync('/tmp/campo-');
const PUERTO = +process.argv[2] || 8080;
const CLAVE = 'clave-prueba';

// ---------- estado de la "hoja" ----------
execFileSync('python', [path.join(__dirname, 'hoja.py'), 'exportar', PLANTILLA, TMP + '/inicio.json']);
const revivir = v => (v && typeof v === 'object' && v.__fecha) ? new Date(v.__fecha + 'T00:00:00') : v;
const estado = {};
for (const [n, filas] of Object.entries(JSON.parse(fs.readFileSync(TMP + '/inicio.json')))) estado[n] = filas.map(f => f.map(revivir));
// limpiar filas vacías al final
for (const n in estado) { while (estado[n].length > 1 && estado[n][estado[n].length - 1].every(v => v === null || v === '')) estado[n].pop(); }
let calc = null, sucio = true;

function recalcular() {
  if (!sucio && calc) return;
  const ser = v => v instanceof Date ? { __fecha: v.toISOString().slice(0, 10) } : v;
  const out = {};
  for (const n in estado) out[n] = estado[n].map(f => f.map(ser));
  fs.writeFileSync(TMP + '/estado.json', JSON.stringify(out));
  execFileSync('python', [path.join(__dirname, 'hoja.py'), 'recalcular', PLANTILLA, TMP + '/estado.json', TMP + '/calc.json'], { env: Object.assign({}, process.env) });
  calc = {};
  for (const [n, filas] of Object.entries(JSON.parse(fs.readFileSync(TMP + '/calc.json')))) calc[n] = filas.map(f => f.map(revivir));
  sucio = false;
}

function col2n(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function Hoja(nombre) {
  const filas = estado[nombre];
  const ancho = () => Math.max(...filas.map(f => { let i = f.length; while (i > 0 && (f[i - 1] === null || f[i - 1] === '')) i--; return i; }), 1);
  const val = (r, c) => {
    const raw = (filas[r - 1] || [])[c - 1];
    if (typeof raw === 'string' && raw.startsWith('=')) { recalcular(); return ((calc[nombre] || [])[r - 1] || [])[c - 1] ?? ''; }
    if (nombre === 'Resumen') { recalcular(); return ((calc[nombre] || [])[r - 1] || [])[c - 1] ?? ''; }
    return raw ?? '';
  };
  const poner = (r, c, v) => { while (filas.length < r) filas.push([]); filas[r - 1][c - 1] = v; sucio = true; };
  function Rango(r, c, nr, nc) {
    return {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => val(r + i, c + j))),
      getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = val(r + i, c + j); return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v ?? ''); })),
      getDisplayValue: () => String(val(r, c) ?? ''),
      getValue: () => val(r, c),
      setValues: vs => vs.forEach((f, i) => f.forEach((v, j) => poner(r + i, c + j, v))),
      setValue: v => poner(r, c, v),
      setFormula: f => poner(r, c, f)
    };
  }
  return {
    getLastRow: () => { let i = filas.length; while (i > 1 && (filas[i - 1] || []).every(v => v === null || v === '' || v === undefined)) i--; return i; },
    getLastColumn: () => ancho(),
    getDataRange() { return Rango(1, 1, this.getLastRow(), ancho()); },
    getRange(a, b, c, d) {
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
        const c1 = col2n(m[1]), r1 = +m[2], c2 = m[3] ? col2n(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
        return Rango(r1, c1, r2 - r1 + 1, c2 - c1 + 1);
      }
      return Rango(a, b, c || 1, d || 1);
    }
  };
}

const props = { API_CLAVE: CLAVE };
const fotos = [];
const ctx = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => estado[n] ? Hoja(n) : null, insertSheet: n => { estado[n] = [[]]; sucio = true; return Hoja(n); } }), flush: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k], setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ t, setMimeType() { return this; } }) },
  Utilities: {
    formatDate: (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); },
    getUuid: () => require('crypto').randomUUID(), base64Decode: b => Buffer.from(b, 'base64'), newBlob: (b, m, n) => ({ b, m, n })
  },
  DriveApp: { getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({ createFile: blob => { fotos.push(blob.n); return { getUrl: () => 'https://drive.google.com/prueba/' + blob.n }; } }) },
  Logger: { log: console.log }, console
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(RAIZ, 'apps-script', 'Api.gs'), 'utf8'), ctx);

let offline = false; // simular falta de señal de la API
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (u.pathname === '/_offline') { offline = u.searchParams.get('v') === '1'; res.end('ok'); return; }
  if (u.pathname === '/_sembrar' && req.method === 'POST') { // solo pruebas: {hoja, filas} o {hoja, celdas:[[fila,col,valor]]}
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const j = JSON.parse(b); const h = estado[j.hoja];
      (j.filas || []).forEach(f => h.push(f.map(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : v)));
      (j.celdas || []).forEach(([r, c, v]) => { h[r - 1][c - 1] = v; });
      if (j.insertar) h.splice(j.insertar.fila - 1, 0, j.insertar.valores);
      sucio = true; res.end('ok');
    }); return;
  }
  if (u.pathname === '/_estado') { res.writeHead(200, cors); res.end(JSON.stringify({ estado, fotos })); return; }
  if (u.pathname === '/api') {
    if (offline) { req.destroy(); return; }
    if (req.method === 'GET') {
      const out = ctx.doGet({ parameter: Object.fromEntries(u.searchParams) });
      res.writeHead(200, cors); res.end(out.t); return;
    }
    let body = ''; req.on('data', d => body += d); req.on('end', () => {
      const out = ctx.doPost({ postData: { contents: body } });
      res.writeHead(200, cors); res.end(out.t);
    }); return;
  }
  let p = path.join(RAIZ, 'docs', u.pathname === '/' ? 'index.html' : u.pathname);
  if (!p.startsWith(path.join(RAIZ, 'docs')) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PUERTO, () => console.log('Prueba en http://localhost:' + PUERTO));
