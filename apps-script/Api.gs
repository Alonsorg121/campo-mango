/**
 * API – Campo de mango
 * Puente entre la app (celular/laptop) y este Google Sheets (la base de datos).
 *
 * La app NUNCA guarda datos propios: todo vive en las hojas de este archivo.
 * Escribe siempre por NOMBRE de columna (no por posición), así se pueden agregar columnas nuevas
 * al final de una hoja sin romper nada.
 *
 * INSTALACIÓN (una sola vez) – ver INSTALACION.md:
 *  1. Extensiones > Apps Script > agrega un archivo "Api" y pega este código. Guarda.
 *  2. Ejecuta la función apiConfigurar (acepta permisos). En "Registro de ejecución" verás tu CLAVE.
 *  3. Implementar > Nueva implementación > Tipo: Aplicación web.
 *     Ejecutar como: Yo. Quién tiene acceso: Cualquier usuario. Copia la URL.
 *  4. Abre la app y pega la URL y la CLAVE en la pantalla de configuración.
 *
 * Para actualizar este código sin cambiar la URL:
 *  Implementar > Gestionar implementaciones > (lápiz) > Versión: Nueva versión > Implementar.
 */

const API_VERSION = '1.1.0';

// Tablas que la app puede leer como catálogos (listas para elegir).
const API_CATALOGOS = ['Lotes', 'Campanas', 'Trabajadores', 'Productos', 'Proveedores',
  'Compradores', 'Catalogo_Labores', 'Categorias_Costo'];

// Tablas de registros (la app agrega filas). Se devuelven las últimas N filas.
const API_REGISTROS = ['Planilla', 'Bitacora_Labores', 'Compras_Insumos', 'Aplicaciones',
  'Plan_Fertilizacion', 'Costos', 'Ventas', 'Cobros'];

// Catálogos que la app también puede ampliar (agregar trabajador, producto, etc.).
const API_CATALOGOS_EDITABLES = ['Trabajadores', 'Productos', 'Proveedores', 'Compradores'];

// Campos que se pueden modificar después de creados (por ejemplo, marcar jornal como pagado).
const API_CAMPOS_EDITABLES = {
  Planilla: ['Pagado', 'Fecha_Pago']
};

const API_RECIENTES = 40;
const API_CARPETA_FOTOS = 'Campo Mango - Fotos';

/**
 * Columnas calculadas: al agregar una fila, se escribe esta fórmula.
 * {Columna}        → celda de la misma fila en esa columna
 * {Hoja.Columna}   → rango completo de esa columna en otra hoja (ej. Ventas!$L$2:$L$5000)
 */
const API_FORMULAS = {
  Planilla: { Total: '={Cantidad}*{Tarifa}' },
  Compras_Insumos: { Total: '={Cantidad}*{Precio_Unitario}' },
  Aplicaciones: {
    Costo_Estimado: '={Cantidad}*IFERROR(INDEX({Productos.Precio_Promedio},MATCH({Producto},{Productos.ID_Producto},0)),0)'
  },
  Plan_Fertilizacion: {
    Cantidad_Aplicada: '=SUMIFS({Aplicaciones.Cantidad},{Aplicaciones.Campana},{Campana},{Aplicaciones.Lote},{Lote},{Aplicaciones.Producto},{Producto})',
    Avance: '=IFERROR({Cantidad_Aplicada}/{Cantidad_Programada},0)'
  },
  Ventas: {
    Kg_Totales: '=IF({Unidad}="Kg",{Cantidad},{Cantidad}*{Kg_por_Jaba})',
    Total: '={Cantidad}*{Precio_Unitario}'
  },
  Productos: {
    Cant_Comprada: '=SUMIFS({Compras_Insumos.Cantidad},{Compras_Insumos.Producto},{ID_Producto})',
    Cant_Aplicada: '=SUMIFS({Aplicaciones.Cantidad},{Aplicaciones.Producto},{ID_Producto})',
    Stock_Actual: '={Cant_Comprada}-{Cant_Aplicada}',
    Precio_Promedio: '=IFERROR(SUMIFS({Compras_Insumos.Total},{Compras_Insumos.Producto},{ID_Producto})/{Cant_Comprada},0)',
    Alerta_Stock: '=IF({Stock_Actual}<={Stock_Minimo},"COMPRAR","OK")'
  },
  Compradores: {
    Total_Vendido: '=SUMIFS({Ventas.Total},{Ventas.Comprador},{ID_Comprador})',
    Total_Cobrado: '=SUMIFS({Cobros.Monto},{Cobros.Comprador},{ID_Comprador})',
    Saldo_por_Cobrar: '={Total_Vendido}-{Total_Cobrado}'
  }
};

// Columnas que son fecha (se guardan como fecha real en el Sheets).
const API_COLUMNAS_FECHA = ['Fecha', 'Fecha_Pago', 'Fecha_Inicio', 'Fecha_Fin'];
// Columnas de foto: la app manda la imagen y aquí se guarda en Drive (se escribe el enlace).
const API_COLUMNAS_FOTO = ['Foto', 'Foto_Comprobante'];

// ======================================================================
// Configuración
// ======================================================================

/** Ejecutar una vez. Crea la clave secreta que usa la app. */
function apiConfigurar() {
  const props = PropertiesService.getScriptProperties();
  let clave = props.getProperty('API_CLAVE');
  if (!clave) {
    clave = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('API_CLAVE', clave);
  }
  Logger.log('CLAVE de la app: ' + clave);
  Logger.log('Ahora: Implementar > Nueva implementación > Aplicación web (Ejecutar como: Yo; Acceso: Cualquier usuario).');
  return clave;
}

/** Si quieres invalidar la clave anterior (por ejemplo, se perdió un celular). */
function apiCambiarClave() {
  PropertiesService.getScriptProperties().deleteProperty('API_CLAVE');
  return apiConfigurar();
}

// ======================================================================
// Entradas web
// ======================================================================

function doGet(e) {
  return apiResponder_(() => {
    apiVerificarClave_(e.parameter.k);
    const accion = e.parameter.accion || 'datos';
    if (accion === 'ping') return { version: API_VERSION };
    if (accion === 'datos') return apiDatos_();
    if (accion === 'tablero') return apiTablero_();
    throw new Error('Acción desconocida: ' + accion);
  });
}

function doPost(e) {
  return apiResponder_(() => {
    const body = JSON.parse(e.postData.contents || '{}');
    apiVerificarClave_(body.k);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const resultados = (body.ops || []).map(op => {
        try {
          if (op.op === 'agregar') return Object.assign({ uid: op.uid, ok: true }, apiAgregar_(op));
          if (op.op === 'editar') return Object.assign({ uid: op.uid, ok: true }, apiEditar_(op));
          throw new Error('Operación desconocida: ' + op.op);
        } catch (err) {
          return { uid: op.uid, ok: false, error: String(err.message || err) };
        }
      });
      SpreadsheetApp.flush();
      return { resultados: resultados };
    } finally {
      lock.releaseLock();
    }
  });
}

function apiResponder_(fn) {
  let out;
  try {
    out = Object.assign({ ok: true, version: API_VERSION }, fn());
  } catch (err) {
    out = { ok: false, error: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function apiVerificarClave_(k) {
  const clave = PropertiesService.getScriptProperties().getProperty('API_CLAVE');
  if (!clave) throw new Error('API sin configurar: ejecuta apiConfigurar en Apps Script.');
  if (k !== clave) throw new Error('Clave incorrecta');
}

// ======================================================================
// Lectura
// ======================================================================

function apiDatos_() {
  const ss = SpreadsheetApp.getActive();
  const catalogos = {};
  API_CATALOGOS.forEach(n => { catalogos[n] = apiLeerTabla_(ss, n, 0); });
  const recientes = {};
  API_REGISTROS.forEach(n => { recientes[n] = apiLeerTabla_(ss, n, API_RECIENTES); });

  const out = { catalogos: catalogos, recientes: recientes, actualizado: new Date().toISOString() };

  // Planilla pendiente de pago (todas, no solo las recientes)
  out.planillaPendiente = apiLeerTabla_(ss, 'Planilla', 0).filter(r => String(r.Pagado || '').toLowerCase() !== 'sí' && String(r.Pagado || '').toLowerCase() !== 'si');

  if (ss.getSheetByName('Clima_Hoy')) out.climaHoy = apiLeerTabla_(ss, 'Clima_Hoy', 1)[0] || null;
  if (ss.getSheetByName('Clima')) out.clima = apiLeerTabla_(ss, 'Clima', 10);

  const rs = ss.getSheetByName('Resumen');
  if (rs) {
    out.resumen = {
      campana: rs.getRange('B2').getDisplayValue(),
      tabla: rs.getRange('A4:M10').getDisplayValues(),
      extra: rs.getRange('A12:D23').getDisplayValues()
    };
  }
  return out;
}

/**
 * Datos completos para el TABLERO: todas las filas de los registros (solo columnas de datos,
 * los totales los calcula la app) y todo el clima. Formato compacto: {enc: [...], filas: [[...]]}.
 */
function apiTablero_() {
  const ss = SpreadsheetApp.getActive();
  const tablas = {};
  ['Planilla', 'Aplicaciones', 'Compras_Insumos', 'Costos', 'Ventas', 'Cobros', 'Plan_Fertilizacion', 'Clima'].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (!sh) return;
    const datos = sh.getDataRange().getValues();
    if (!datos.length) return;
    const enc = datos[0].map(String);
    const filas = datos.slice(1).filter(f => f[0] !== '' && f[0] !== null).map(f => f.map(apiSerializar_));
    tablas[n] = { enc: enc, filas: filas };
  });
  return { tablas: tablas, actualizado: new Date().toISOString() };
}

/** Devuelve filas como objetos {Columna: valor}. ultimas = 0 → todas. */
function apiLeerTabla_(ss, nombre, ultimas) {
  const sh = ss.getSheetByName(nombre);
  if (!sh) return [];
  const datos = sh.getDataRange().getValues();
  if (datos.length < 2) return [];
  const enc = datos[0].map(String);
  let filas = datos.slice(1).filter(f => f[0] !== '' && f[0] !== null);
  if (ultimas) filas = filas.slice(-ultimas);
  return filas.map(f => {
    const o = {};
    enc.forEach((h, i) => { if (h) o[h] = apiSerializar_(f[i]); });
    return o;
  });
}

function apiSerializar_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Lima', 'yyyy-MM-dd');
  return v;
}

// ======================================================================
// Escritura
// ======================================================================

function apiAgregar_(op) {
  const nombre = op.tabla;
  if (API_REGISTROS.indexOf(nombre) < 0 && API_CATALOGOS_EDITABLES.indexOf(nombre) < 0) {
    throw new Error('No se puede escribir en la hoja ' + nombre);
  }
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(nombre);
  if (!sh) throw new Error('No existe la hoja ' + nombre);

  const enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const clave = enc[0];
  const reg = Object.assign({}, op.registro || {});
  if (!reg[clave]) throw new Error('Falta ' + clave);

  // Idempotente: si ya existe ese ID (reintento sin señal), no se duplica.
  const fila0 = apiBuscarFila_(sh, reg[clave]);
  if (fila0) return { id: reg[clave], duplicado: true };

  // Fotos → Drive
  Object.keys(op.fotos || {}).forEach(campo => {
    if (API_COLUMNAS_FOTO.indexOf(campo) >= 0 && op.fotos[campo]) {
      reg[campo] = apiGuardarFoto_(op.fotos[campo], nombre + '_' + reg[clave] + '_' + campo);
    }
  });

  const formulas = API_FORMULAS[nombre] || {};
  const valores = enc.map(h => {
    if (!h || formulas[h]) return '';
    return apiConvertir_(h, reg[h]);
  });
  const fila = sh.getLastRow() + 1;
  sh.getRange(fila, 1, 1, enc.length).setValues([valores]);
  Object.keys(formulas).forEach(h => {
    const c = enc.indexOf(h);
    if (c >= 0) sh.getRange(fila, c + 1).setFormula(apiFormula_(ss, formulas[h], enc, fila));
  });
  return { id: reg[clave] };
}

function apiEditar_(op) {
  const permitidos = API_CAMPOS_EDITABLES[op.tabla] || [];
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(op.tabla);
  if (!sh) throw new Error('No existe la hoja ' + op.tabla);
  const fila = apiBuscarFila_(sh, op.id);
  if (!fila) throw new Error('No se encontró el registro ' + op.id);
  const enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  Object.keys(op.campos || {}).forEach(h => {
    if (permitidos.indexOf(h) < 0) throw new Error('No se puede editar ' + h);
    const c = enc.indexOf(h);
    if (c >= 0) sh.getRange(fila, c + 1).setValue(apiConvertir_(h, op.campos[h]));
  });
  return { id: op.id };
}

function apiBuscarFila_(sh, id) {
  const n = sh.getLastRow();
  if (n < 2) return 0;
  const ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function apiConvertir_(col, v) {
  if (v === undefined || v === null) return '';
  if (API_COLUMNAS_FECHA.indexOf(col) >= 0 && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const p = v.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  return v;
}

function apiFormula_(ss, plantilla, enc, fila) {
  return plantilla.replace(/\{([A-Za-z_]+)(?:\.([A-Za-z_]+))?\}/g, (m, a, b) => {
    if (b) { // otra hoja
      const sh = ss.getSheetByName(a);
      if (!sh) throw new Error('Fórmula: no existe la hoja ' + a);
      const e2 = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
      const c = e2.indexOf(b);
      if (c < 0) throw new Error('Fórmula: no existe la columna ' + a + '.' + b);
      const L = apiLetra_(c + 1);
      return a + '!$' + L + '$2:$' + L + '$5000';
    }
    const c = enc.indexOf(a);
    if (c < 0) throw new Error('Fórmula: no existe la columna ' + a);
    return apiLetra_(c + 1) + fila;
  });
}

function apiLetra_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function apiGuardarFoto_(foto, nombre) {
  const it = DriveApp.getFoldersByName(API_CARPETA_FOTOS);
  const carpeta = it.hasNext() ? it.next() : DriveApp.createFolder(API_CARPETA_FOTOS);
  const blob = Utilities.newBlob(Utilities.base64Decode(foto.b64), foto.mime || 'image/jpeg', nombre + '.jpg');
  const archivo = carpeta.createFile(blob);
  return archivo.getUrl();
}
