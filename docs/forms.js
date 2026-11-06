/**
 * FORMULARIOS DE LA APP
 * Cada formulario escribe en una hoja del Google Sheets. "n" es el nombre EXACTO de la columna.
 * Para agregar un campo nuevo: crea la columna al FINAL de la hoja en el Sheets y agrégala aquí.
 *
 * Tipos de campo (t):
 *  fecha     → fecha (por defecto hoy)
 *  campana   → campaña activa (oculto, se puede cambiar en Ajustes)
 *  select    → lista desde un catálogo: fuente (hoja), valor (columna que se guarda), texto (columna que se muestra)
 *  multi     → elegir VARIOS de un catálogo; crea un registro por cada uno (ej. jornal de varios trabajadores)
 *  opciones  → botones grandes con opciones fijas
 *  num       → número
 *  texto     → texto corto      | nota → texto largo
 *  foto      → cámara del celular (se guarda en Google Drive)
 *  oculto    → valor fijo que no se muestra
 * grupo del formulario: 'campo' | 'evaluacion' | 'plata' (pantalla de inicio) o menu: 'mas'.
 * rellena(registroElegido, valores) → en un select, completa otros campos al elegir (ej. venta desde una cosecha).
 * Otras propiedades: req (obligatorio), def (valor por defecto), si (mostrar solo si...), etiqueta (texto o función)
 */
const FORMULARIOS = [
  {
    id: 'jornal', grupo: 'campo', titulo: 'Jornal / tarea', icono: '👷', tabla: 'Planilla', prefijo: 'PL',
    ayuda: 'Marca a todos los que trabajaron: se crea un registro por cada uno.',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Campana', t: 'campana' },
      { n: 'Trabajador', t: 'multi', fuente: 'Trabajadores', valor: 'ID_Trabajador', texto: 'Nombres',
        filtro: r => String(r.Activo || 'Sí') !== 'No', req: true, etiqueta: 'Trabajadores' },
      { n: 'Lote', t: 'select', fuente: 'Lotes', valor: 'ID_Lote', texto: 'Nombre', req: true },
      { n: 'Labor', t: 'select', fuente: 'Catalogo_Labores', valor: 'Labor', texto: 'Labor', req: true },
      { n: 'Modalidad', t: 'opciones', opciones: ['Jornal', 'Tarea'], def: 'Jornal', req: true },
      { n: 'Cantidad', t: 'num', def: 1, req: true, etiqueta: f => f.Modalidad === 'Tarea' ? 'Número de tareas' : 'Días trabajados' },
      { n: 'Tarifa', t: 'num', req: true, etiqueta: f => f.Modalidad === 'Tarea' ? 'Pago por tarea (S/)' : 'Jornal por día (S/)',
        defDesde: { campo: 'Trabajador', fuente: 'Trabajadores', valor: 'ID_Trabajador', columna: 'Jornal_Base' } },
      { n: 'Pagado', t: 'oculto', def: 'No' },
      { n: 'Observaciones', t: 'texto' }
    ],
    // Si no se escribe la tarifa a mano, cada trabajador usa su propio jornal base.
    total: f => (f.Trabajador || []).reduce((s, id) => {
      const t = (Datos.catalogo('Trabajadores') || []).find(r => r.ID_Trabajador === id);
      const tarifa = !f._manual_Tarifa && t && t.Jornal_Base ? num(t.Jornal_Base) : num(f.Tarifa);
      return s + num(f.Cantidad) * tarifa;
    }, 0),
    totalEtiqueta: 'Total a pagar'
  },
  {
    id: 'labor', grupo: 'campo', titulo: 'Labor del día', icono: '📝', tabla: 'Bitacora_Labores', prefijo: 'BL',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Campana', t: 'campana' },
      { n: 'Lote', t: 'select', fuente: 'Lotes', valor: 'ID_Lote', texto: 'Nombre', req: true },
      { n: 'Labor', t: 'select', fuente: 'Catalogo_Labores', valor: 'Labor', texto: 'Labor', req: true },
      { n: 'Detalle', t: 'texto', etiqueta: '¿Qué se hizo?' },
      { n: 'Responsable', t: 'texto' },
      { n: 'N_Trabajadores', t: 'num', etiqueta: 'N° de trabajadores' },
      { n: 'Foto', t: 'foto' },
      { n: 'Observaciones', t: 'nota' }
    ]
  },
  {
    id: 'aplicacion', grupo: 'campo', titulo: 'Aplicación de insumo', icono: '🧪', tabla: 'Aplicaciones', prefijo: 'AP',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Campana', t: 'campana' },
      { n: 'Lote', t: 'select', fuente: 'Lotes', valor: 'ID_Lote', texto: 'Nombre', req: true },
      { n: 'Producto', t: 'select', fuente: 'Productos', valor: 'ID_Producto', texto: 'Nombre', req: true },
      { n: 'Cantidad', t: 'num', req: true, etiqueta: f => 'Cantidad usada' + unidadDe(f.Producto) },
      { n: 'Dosis', t: 'texto', etiqueta: 'Dosis (ej. 4%, 2 L/200 L)' },
      { n: 'Metodo', t: 'opciones', opciones: ['Foliar', 'Edáfico', 'Fertirriego', 'Drench', 'Trampa/cebo'], etiqueta: 'Método' },
      { n: 'Aplicador', t: 'select', fuente: 'Trabajadores', valor: 'ID_Trabajador', texto: 'Nombres' },
      { n: 'Observaciones', t: 'nota' }
    ]
  },
  {
    id: 'compra', grupo: 'plata', titulo: 'Compra de insumo', icono: '🛒', tabla: 'Compras_Insumos', prefijo: 'CI',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Campana', t: 'campana' },
      { n: 'Producto', t: 'select', fuente: 'Productos', valor: 'ID_Producto', texto: 'Nombre', req: true },
      { n: 'Proveedor', t: 'select', fuente: 'Proveedores', valor: 'ID_Proveedor', texto: 'Nombre' },
      { n: 'Cantidad', t: 'num', req: true, etiqueta: f => 'Cantidad' + unidadDe(f.Producto) },
      { n: 'Unidad', t: 'oculto', desde: f => unidadDe(f.Producto, true) },
      { n: 'Precio_Unitario', t: 'num', req: true, etiqueta: f => 'Precio por ' + (unidadDe(f.Producto, true) || 'unidad') + ' (S/)' },
      { n: 'Tipo_Comprobante', t: 'opciones', opciones: ['Factura', 'Boleta', 'Ticket', 'Sin comprobante'], etiqueta: 'Comprobante' },
      { n: 'N_Comprobante', t: 'texto', etiqueta: 'N° de comprobante', si: f => f.Tipo_Comprobante && f.Tipo_Comprobante !== 'Sin comprobante' },
      { n: 'Foto_Comprobante', t: 'foto', etiqueta: 'Foto del comprobante' }
    ],
    total: f => num(f.Cantidad) * num(f.Precio_Unitario)
  },
  {
    id: 'gasto', grupo: 'plata', titulo: 'Gasto', icono: '💸', tabla: 'Costos', prefijo: 'CO',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Campana', t: 'campana' },
      { n: 'Categoria', t: 'select', fuente: 'Categorias_Costo', valor: 'Categoria', texto: 'Categoria', req: true, etiqueta: 'Categoría' },
      { n: 'Concepto', t: 'texto', req: true, etiqueta: '¿En qué se gastó?' },
      { n: 'Monto', t: 'num', req: true, etiqueta: 'Monto (S/)' },
      { n: 'Lote', t: 'select', fuente: 'Lotes', valor: 'ID_Lote', texto: 'Nombre', def: 'GENERAL', req: true, etiqueta: 'Lote (GENERAL si es de todo el campo)' },
      { n: 'Proveedor', t: 'select', fuente: 'Proveedores', valor: 'ID_Proveedor', texto: 'Nombre' },
      { n: 'Tipo_Comprobante', t: 'opciones', opciones: ['Factura', 'Boleta', 'Recibo por honorarios', 'Ticket', 'Sin comprobante'], etiqueta: 'Comprobante' },
      { n: 'N_Comprobante', t: 'texto', etiqueta: 'N° de comprobante', si: f => f.Tipo_Comprobante && f.Tipo_Comprobante !== 'Sin comprobante' },
      { n: 'Foto_Comprobante', t: 'foto', etiqueta: 'Foto del comprobante' }
    ]
  },
  {
    id: 'venta', grupo: 'plata', titulo: 'Venta', icono: '🥭', tabla: 'Ventas', prefijo: 'VE',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Campana', t: 'campana' },
      { n: 'ID_Cosecha', t: 'select', fuente: '@cosechasSinVender', valor: 'ID', texto: '_texto', etiqueta: '¿De qué cosecha? (opcional: llena lote y kilos)',
        rellena: c => ({ Lote: c.Lote, Unidad: 'Kg', Cantidad: Math.round(kgNetosCosecha(c)) }) },
      { n: 'Lote', t: 'select', fuente: 'Lotes', valor: 'ID_Lote', texto: 'Nombre', req: true },
      { n: 'Comprador', t: 'select', fuente: 'Compradores', valor: 'ID_Comprador', texto: 'Nombre', req: true },
      { n: 'Unidad', t: 'opciones', opciones: ['Kg', 'Jaba'], def: 'Kg', req: true, etiqueta: 'Vende por' },
      { n: 'Cantidad', t: 'num', req: true, etiqueta: f => f.Unidad === 'Jaba' ? 'Número de jabas' : 'Kilos' },
      { n: 'Kg_por_Jaba', t: 'num', etiqueta: 'Kilos por jaba (aprox.)', si: f => f.Unidad === 'Jaba', req: f => f.Unidad === 'Jaba' },
      { n: 'Precio_Unitario', t: 'num', req: true, etiqueta: f => f.Unidad === 'Jaba' ? 'Precio por jaba (S/)' : 'Precio por kg (S/)' },
      { n: 'Kg_Descarte', t: 'num', etiqueta: 'Kilos de descarte' },
      { n: 'Tipo_Comprobante', t: 'opciones', opciones: ['Factura', 'Boleta', 'Ticket', 'Sin comprobante'], etiqueta: 'Comprobante' },
      { n: 'N_Comprobante', t: 'texto', etiqueta: 'N° de comprobante', si: f => f.Tipo_Comprobante && f.Tipo_Comprobante !== 'Sin comprobante' },
      { n: 'Foto_Comprobante', t: 'foto', etiqueta: 'Foto (guía, ticket de balanza o comprobante)' },
      { n: 'Observaciones', t: 'nota' }
    ],
    total: f => num(f.Cantidad) * num(f.Precio_Unitario)
  },
  {
    id: 'cobro', grupo: 'plata', titulo: 'Cobro / adelanto', icono: '💰', tabla: 'Cobros', prefijo: 'CB',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Comprador', t: 'select', fuente: 'Compradores', valor: 'ID_Comprador', texto: 'Nombre', req: true },
      { n: 'Tipo', t: 'opciones', opciones: ['Adelanto', 'Pago parcial', 'Liquidación final'], req: true },
      { n: 'Monto', t: 'num', req: true, etiqueta: 'Monto recibido (S/)' },
      { n: 'Medio_Pago', t: 'opciones', opciones: ['Efectivo', 'Transferencia', 'Yape/Plin', 'Cheque'], etiqueta: 'Medio de pago' },
      { n: 'ID_Venta', t: 'select', fuente: '@ventasDelComprador', valor: 'ID_Venta', texto: '_texto', etiqueta: 'Venta (opcional)' },
      { n: 'Observaciones', t: 'nota' }
    ]
  },
  {
    id: 'riego', grupo: 'campo', titulo: 'Riego', icono: '💧', tabla: 'Riego', prefijo: 'RG',
    ayuda: 'Si no sabes los m³, basta con las horas. El pago del regador va en Jornal y el costo del turno en Gasto.',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Campana', t: 'campana' },
      { n: 'Lote', t: 'select', fuente: 'Lotes', valor: 'ID_Lote', texto: 'Nombre', req: true },
      { n: 'Horas', t: 'num', req: f => !f.M3, etiqueta: 'Horas de riego' },
      { n: 'M3', t: 'num', etiqueta: 'Metros cúbicos (m³), si los sabes' },
      { n: 'Observaciones', t: 'nota' }
    ]
  },
  {
    id: 'cosecha', grupo: 'campo', titulo: 'Cosecha', icono: '🧺', tabla: 'Cosecha', prefijo: 'CS',
    ayuda: 'Lo que salió del lote. La venta se registra aparte (y puede tomar estos kilos).',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Campana', t: 'campana' },
      { n: 'Lote', t: 'select', fuente: 'Lotes', valor: 'ID_Lote', texto: 'Nombre', req: true },
      { n: 'Unidad', t: 'opciones', opciones: ['Jaba', 'Kg'], def: 'Jaba', req: true, etiqueta: 'Se contó en' },
      { n: 'Cantidad', t: 'num', req: true, etiqueta: f => f.Unidad === 'Kg' ? 'Kilos cosechados' : 'Jabas cosechadas' },
      { n: 'Kg_por_Jaba', t: 'num', etiqueta: 'Kilos por jaba (aprox.)', si: f => f.Unidad === 'Jaba', req: f => f.Unidad === 'Jaba' },
      { n: 'Kg_Descarte', t: 'num', etiqueta: 'Kilos de descarte en campo' },
      { n: 'Causa_Descarte', t: 'opciones', opciones: ['Mosca de la fruta', 'Antracnosis', 'Quemado de sol', 'Golpes', 'Tamaño chico', 'Otra'], etiqueta: 'Causa principal del descarte',
        si: f => num(f.Kg_Descarte) > 0, req: f => num(f.Kg_Descarte) > 0 },
      { n: 'Foto', t: 'foto' },
      { n: 'Observaciones', t: 'nota' }
    ],
    total: f => kgNetosCosecha(f), totalEtiqueta: 'Kilos buenos', totalFmt: v => num(v).toLocaleString('es-PE') + ' kg'
  },
  {
    id: 'floracion', grupo: 'evaluacion', titulo: 'Floración', icono: '🌼', tabla: 'Floracion', prefijo: 'FL',
    ayuda: 'Una vez por semana en temporada, por lote. Un cálculo a ojo está bien.',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Campana', t: 'campana' },
      { n: 'Lote', t: 'select', fuente: 'Lotes', valor: 'ID_Lote', texto: 'Nombre', req: true },
      { n: 'Etapa', t: 'opciones', opciones: ['Inducción', 'Brotación floral', 'Floración', 'Cuajado', 'Llenado de fruto'], req: true },
      { n: 'Pct_Plantas', t: 'opciones', opciones: ['10', '25', '50', '75', '90', '100'], etiqueta: '% de plantas con flor (aprox.)',
        si: f => ['Brotación floral', 'Floración'].includes(f.Etapa), req: f => ['Brotación floral', 'Floración'].includes(f.Etapa) },
      { n: 'Cuajado', t: 'opciones', opciones: ['Poco', 'Normal', 'Mucho'], etiqueta: '¿Cuánto fruto quedó?', si: f => ['Cuajado', 'Llenado de fruto'].includes(f.Etapa) },
      { n: 'Foto', t: 'foto' },
      { n: 'Observaciones', t: 'nota' }
    ]
  },
  {
    id: 'sanidad', grupo: 'evaluacion', titulo: 'Plagas y enfermedades', icono: '🐛', tabla: 'Sanidad', prefijo: 'SN',
    ayuda: 'Lo que se VE en el campo. Lo que se aplica va en "Aplicación de insumo".',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Campana', t: 'campana' },
      { n: 'Lote', t: 'select', fuente: 'Lotes', valor: 'ID_Lote', texto: 'Nombre', req: true },
      { n: 'Plaga', t: 'opciones', opciones: ['Mosca de la fruta', 'Trips', 'Oídio', 'Antracnosis', 'Queresa', 'Otra'], req: true },
      { n: 'Trampas', t: 'num', etiqueta: 'Trampas revisadas', si: f => f.Plaga === 'Mosca de la fruta', req: f => f.Plaga === 'Mosca de la fruta' },
      { n: 'Capturas', t: 'num', etiqueta: 'Moscas capturadas (total)', si: f => f.Plaga === 'Mosca de la fruta', req: f => f.Plaga === 'Mosca de la fruta' },
      { n: 'Dias_Exposicion', t: 'num', def: 7, etiqueta: 'Días desde la última revisión', si: f => f.Plaga === 'Mosca de la fruta' },
      { n: 'Pct_Afectado', t: 'num', etiqueta: '% de plantas afectadas (aprox.)', si: f => f.Plaga && f.Plaga !== 'Mosca de la fruta' },
      { n: 'Nivel', t: 'opciones', opciones: ['Bajo', 'Medio', 'Alto'], req: true, etiqueta: '¿Cómo lo ves?' },
      { n: 'Foto', t: 'foto' },
      { n: 'Observaciones', t: 'nota' }
    ]
  },
  {
    id: 'analisis', titulo: 'Análisis de suelo / foliar', icono: '🧾', tabla: 'Analisis', prefijo: 'AN', menu: 'mas',
    campos: [
      { n: 'Fecha', t: 'fecha', req: true },
      { n: 'Campana', t: 'campana' },
      { n: 'Lote', t: 'select', fuente: 'Lotes', valor: 'ID_Lote', texto: 'Nombre', req: true },
      { n: 'Tipo', t: 'opciones', opciones: ['Suelo', 'Foliar', 'Agua'], req: true },
      { n: 'Laboratorio', t: 'texto' },
      { n: 'Resumen', t: 'nota', etiqueta: 'Resultado principal (ej. pH 7.8, falta potasio)' },
      { n: 'Foto', t: 'foto', etiqueta: 'Foto del resultado' }
    ]
  },
  {
    id: 'plan', titulo: 'Plan de fertilización', icono: '📅', tabla: 'Plan_Fertilizacion', prefijo: 'PF', menu: 'mas',
    campos: [
      { n: 'Campana', t: 'campana' },
      { n: 'Lote', t: 'select', fuente: 'Lotes', valor: 'ID_Lote', texto: 'Nombre', req: true },
      { n: 'Fase', t: 'opciones', opciones: ['Post-cosecha', 'Poda', 'Inducción', 'Floración', 'Cuajado', 'Llenado de fruto', 'Cosecha'], req: true },
      { n: 'Producto', t: 'select', fuente: 'Productos', valor: 'ID_Producto', texto: 'Nombre', req: true },
      { n: 'Mes_Programado', t: 'opciones', opciones: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'], etiqueta: 'Mes' },
      { n: 'Cantidad_Programada', t: 'num', req: true, etiqueta: f => 'Cantidad programada' + unidadDe(f.Producto) }
    ]
  },
  // ---- Catálogos (agregar nuevos) ----
  {
    id: 'nuevo-trabajador', titulo: 'Nuevo trabajador', icono: '🧑‍🌾', tabla: 'Trabajadores', prefijo: 'T', catalogo: true, menu: 'mas',
    campos: [
      { n: 'Nombres', t: 'texto', req: true, etiqueta: 'Nombres y apellidos' },
      { n: 'DNI', t: 'texto' },
      { n: 'Celular', t: 'texto' },
      { n: 'Modalidad_Habitual', t: 'opciones', opciones: ['Jornal', 'Tarea'], def: 'Jornal', etiqueta: 'Forma de pago habitual' },
      { n: 'Jornal_Base', t: 'num', etiqueta: 'Jornal por día (S/)' },
      { n: 'Activo', t: 'oculto', def: 'Sí' }
    ]
  },
  {
    id: 'nuevo-producto', titulo: 'Nuevo insumo', icono: '🧴', tabla: 'Productos', prefijo: 'PR', catalogo: true, menu: 'mas',
    campos: [
      { n: 'Nombre', t: 'texto', req: true, etiqueta: 'Nombre comercial' },
      { n: 'Tipo', t: 'opciones', opciones: ['Fertilizante', 'Foliar', 'Fitosanitario', 'Regulador de crecimiento', 'Inductor floral', 'Enmienda', 'Otro'], req: true },
      { n: 'Ingrediente_Activo', t: 'texto', etiqueta: 'Ingrediente activo' },
      { n: 'Unidad', t: 'opciones', opciones: ['kg', 'L', 'saco', 'unidad'], req: true },
      { n: 'Stock_Minimo', t: 'num', etiqueta: 'Avisar cuando quede menos de' }
    ]
  },
  {
    id: 'nuevo-comprador', titulo: 'Nuevo comprador', icono: '🤝', tabla: 'Compradores', prefijo: 'C', catalogo: true, menu: 'mas',
    campos: [
      { n: 'Nombre', t: 'texto', req: true },
      { n: 'Tipo', t: 'opciones', opciones: ['Acopiador local', 'Empacadora/exportadora', 'Mercado nacional', 'Exportación directa'], req: true },
      { n: 'RUC', t: 'texto' },
      { n: 'Celular', t: 'texto' }
    ]
  },
  {
    id: 'nuevo-proveedor', titulo: 'Nuevo proveedor', icono: '🏪', tabla: 'Proveedores', prefijo: 'P', catalogo: true, menu: 'mas',
    campos: [
      { n: 'Nombre', t: 'texto', req: true },
      { n: 'RUC', t: 'texto' },
      { n: 'Celular', t: 'texto' },
      { n: 'Rubro', t: 'texto' }
    ]
  }
];

function num(v) { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; }

/** Kilos buenos de una cosecha: cosechado − descarte en campo. */
function kgNetosCosecha(c) {
  const kg = c.Unidad === 'Kg' ? num(c.Cantidad) : num(c.Cantidad) * num(c.Kg_por_Jaba);
  return Math.max(0, kg - num(c.Kg_Descarte));
}

function unidadDe(idProducto, solo) {
  const p = (Datos.catalogo('Productos') || []).find(r => r.ID_Producto === idProducto);
  const u = p && p.Unidad ? p.Unidad : '';
  return solo ? u : (u ? ' (' + u + ')' : '');
}
