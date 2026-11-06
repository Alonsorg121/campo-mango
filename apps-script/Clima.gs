/**
 * MÓDULO CLIMA – Campo de mango (Tambogrande, Piura)
 * Registra automáticamente el clima de cada día en la hoja "Clima"
 * y actualiza el pronóstico del día en la hoja "Clima_Hoy".
 * Fuente de datos: Open-Meteo (https://open-meteo.com), sin clave de API.
 *
 * INSTALACIÓN (una sola vez):
 *  1. En tu Google Sheets: Extensiones > Apps Script.
 *  2. Borra lo que aparezca, pega TODO este código y guarda (ícono de disquete).
 *  3. Arriba, elige la función "instalar" y presiona Ejecutar. Acepta los permisos.
 *     Carga el histórico desde el inicio de la campaña y programa la actualización automática.
 *  Listo: cada 3 horas se actualiza solo, aunque tengas la computadora y el celular apagados.
 */

// Ubicación del campo (tomada de Google Maps)
const LAT = -4.88;   // pon aquí la latitud exacta de tu campo
const LON = -80.27;  // pon aquí la longitud exacta de tu campo

const FECHA_INICIO_HISTORICO = '2026-04-01'; // inicio de la campaña 2026-2027
const ZONA = 'America/Lima';
const HOJA = 'Clima';
const HOJA_HOY = 'Clima_Hoy';
const VARS = [
  'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean',
  'precipitation_sum', 'relative_humidity_2m_mean',
  'et0_fao_evapotranspiration', 'wind_speed_10m_max'
].join(',');

/** Crea el activador automático (cada 3 horas) y hace la primera carga. */
function instalar() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'registrarClima')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('registrarClima').timeBased().everyHours(3).create();
  cargarHistorico();
  registrarClima();
  SpreadsheetApp.getActive().toast('Clima instalado: se actualiza solo cada 3 horas.', 'Clima', 8);
}

/** Menú "Clima" en el Google Sheets para actualizar a mano si quieres. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Clima')
    .addItem('Actualizar ahora', 'registrarClima')
    .addItem('Cargar histórico de la campaña', 'cargarHistorico')
    .addToUi();
}

/** Guarda los días completos que falten (últimos 7 días) y actualiza el clima de hoy. */
function registrarClima() {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + LAT + '&longitude=' + LON
    + '&daily=' + VARS + '&timezone=' + encodeURIComponent(ZONA)
    + '&past_days=7&forecast_days=1';
  const d = pedir_(url).daily;
  const hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  guardarDias_(d, hoy, 'Open-Meteo (pronóstico/registro)');

  const i = d.time.indexOf(hoy);
  if (i >= 0) {
    const sh = hoja_(HOJA_HOY);
    const f = fila_(d, i, 'Pronóstico del día');
    f[f.length - 1] = new Date(); // columna Actualizado
    sh.getRange(2, 1, 1, f.length).setValues([f]);
  }
}

/** Llena el histórico desde FECHA_INICIO_HISTORICO hasta hace 6 días. */
function cargarHistorico() {
  const fin = new Date(Date.now() - 6 * 24 * 3600 * 1000);
  const finTxt = Utilities.formatDate(fin, ZONA, 'yyyy-MM-dd');
  const url = 'https://archive-api.open-meteo.com/v1/archive'
    + '?latitude=' + LAT + '&longitude=' + LON
    + '&start_date=' + FECHA_INICIO_HISTORICO + '&end_date=' + finTxt
    + '&daily=' + VARS + '&timezone=' + encodeURIComponent(ZONA);
  const d = pedir_(url).daily;
  guardarDias_(d, '9999-12-31', 'Open-Meteo (histórico)');
}

// ---------------- funciones internas ----------------

function guardarDias_(d, hoy, fuente) {
  const sh = hoja_(HOJA);
  const existentes = new Set();
  const n = sh.getLastRow();
  if (n > 1) {
    sh.getRange(2, 1, n - 1, 1).getValues().forEach(r => {
      if (r[0] && typeof r[0].getTime === 'function') existentes.add(Utilities.formatDate(r[0], ZONA, 'yyyy-MM-dd'));
      else if (r[0]) existentes.add(String(r[0]).slice(0, 10));
    });
  }
  const filas = [];
  d.time.forEach((t, i) => {
    if (t < hoy && !existentes.has(t) && d.temperature_2m_max[i] !== null) {
      const f = fila_(d, i, fuente);
      f[f.length - 1] = fuente;
      filas.push(f);
    }
  });
  if (filas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, filas.length, filas[0].length).setValues(filas);
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).sort({ column: 1, ascending: true });
  }
}

// Columnas: Fecha | T_Max | T_Min | T_Prom | Lluvia_mm | Humedad_Prom | ET0_mm | Viento_Max_kmh | Fuente/Actualizado
function fila_(d, i, extra) {
  const v = k => (d[k] && d[k][i] !== undefined && d[k][i] !== null) ? d[k][i] : '';
  const tmax = v('temperature_2m_max'), tmin = v('temperature_2m_min');
  let tprom = v('temperature_2m_mean');
  if (tprom === '' && tmax !== '' && tmin !== '') tprom = Math.round((tmax + tmin) / 2 * 10) / 10;
  return [
    Utilities.parseDate(d.time[i], ZONA, 'yyyy-MM-dd'),
    tmax, tmin, tprom,
    v('precipitation_sum'), v('relative_humidity_2m_mean'),
    v('et0_fao_evapotranspiration'), v('wind_speed_10m_max'),
    extra
  ];
}

function pedir_(url) {
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Error de Open-Meteo: ' + r.getContentText());
  return JSON.parse(r.getContentText());
}

function hoja_(nombre) {
  const sh = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!sh) throw new Error('No existe la hoja "' + nombre + '". No le cambies el nombre.');
  return sh;
}
