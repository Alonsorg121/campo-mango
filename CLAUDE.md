# Guía para la IA que modifique esta app

App para registrar la producción de un campo de mango familiar en Tambogrande, Piura, Perú. Tiene 5 lotes: Ataulfo, Kent, Edward, Haden y Keitt, más el lote GENERAL para gastos comunes.
El usuario principal es una persona mayor que la usa en el celular, a veces sin señal. Prioriza: botones grandes, pocos campos, español sencillo.

## Arquitectura (no cambiarla sin motivo)
```
docs/ (PWA estática, GitHub Pages)  ──fetch──>  Apps Script Web App (apps-script/Api.gs)  ──>  Google Sheets (BASE DE DATOS)
     IndexedDB: cola offline + copia de datos                                      Clima.gs llena las hojas Clima/Clima_Hoy
```
- **La base de datos es el Google Sheets.** La app no guarda datos permanentes propios: solo una cola de pendientes y una copia de lectura.
- Sin frameworks ni compilación: HTML, CSS y JS puros. Se edita y se sube tal cual.

## Archivos
- `docs/forms.js`: **formularios declarativos**. Para agregar o quitar campos, casi siempre basta con tocar este archivo. Los tipos de campo están documentados al inicio.
- `docs/tablero.js`: Tablero con filtros (campaña, periodo, lotes, gastos generales) y pestañas Resumen/Costos/Ventas/Mes a mes/Clima. Calcula todo en el celular desde `accion=tablero`; gráficos SVG propios (colores fijos por lote, paleta validada para daltonismo; cada gráfico tiene vista de tabla).
- `docs/app.js`: almacenamiento (DB), datos y cola (Datos), sincronización (Sync), vistas y rutas `#/...`.
- `docs/sw.js` + `docs/version.js`: modo offline. **Sube `APP_VERSION` en cada cambio**; si no, los celulares siguen con la versión anterior.
- `apps-script/Api.gs`: `doGet` (`accion=datos|ping`) y `doPost` (`ops: agregar|editar`). Escribe **por nombre de columna**.
- `apps-script/Clima.gs`: clima diario de Open-Meteo para la ubicación del campo (coordenadas aproximadas en el repositorio público; las exactas están solo en el Apps Script del usuario).
- `plantilla/crear_plantilla.py`: genera el .xlsx base (hojas, encabezados, Resumen y listas).
- `pruebas/`: servidor que ejecuta el **Api.gs real** contra una copia del Sheets (recalculada con LibreOffice), más pruebas Playwright.

## Reglas para NO perder información
1. Nunca renombres hojas ni encabezados existentes. Para algo nuevo, **agrega la columna al FINAL** de la hoja, en el Sheets real y en `crear_plantilla.py`. La hoja Resumen usa letras de columna fijas.
2. Los IDs los genera la app (`PREFIJO-xxxx`). La API ignora un ID repetido (idempotencia), lo que permite reintentar sin crear duplicados. No cambies esa lógica.
3. La cola offline (`IndexedDB 'campo-mango' > cola`) debe seguir siendo compatible entre versiones. Si cambias su formato, migra los ítems viejos.
4. Las columnas calculadas se escriben como fórmulas en `API_FORMULAS` (Api.gs) con la sintaxis `{Columna}` y `{Hoja.Columna}`.
5. Hojas nuevas que la app escriba: agrégalas a `API_REGISTROS` o `API_CATALOGOS_EDITABLES`. Para campos editables después de creados, usa `API_CAMPOS_EDITABLES`.
6. Cambios en Api.gs: el usuario debe pegarlos y crear **Nueva versión** de la implementación. Díselo siempre.

## Cómo probar
```bash
cd pruebas
export RECALC=<ruta a recalc.py de LibreOffice>   # recalcula fórmulas
node servidor_prueba.js 8080 &                       # app + API simulada en http://localhost:8080
node prueba_app.js /tmp/capturas                     # flujo completo (incluye modo sin señal)
node prueba_version_foto.js                          # fotos y actualización de versión
```
Clave de prueba: `clave-prueba`.

## Historial de versiones
- 1.0.0 (nov 2026): formularios de jornal (grupal), labor, aplicación, compra, gasto, venta (kg/jaba), cobro, plan de fertilización y catálogos; vistas de pagar planilla, resumen, stock, por cobrar, clima e historial; modo offline.
- 1.1.0 (nov 2026): Ajustes con URL y clave ocultas; PIN de administrador local (hash SHA-256 en `config.pinHash`) para ver o cambiar la conexión y copiar el enlace de configuración. Prueba: `pruebas/prueba_pin.js`.
- 1.2.0 (nov 2026): Tablero y reportes (requiere Api.gs 1.1.0 con `accion=tablero`). Opción de pedir PIN para ver el Tablero. Prueba: `pruebas/prueba_tablero.js`.
