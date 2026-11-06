# Instalación – App del campo de mango

Tiempo total: unos 20 minutos, una sola vez.

## 1. Base de datos (Google Sheets)
1. Sube `plantilla/Campo_Mango_BaseDatos.xlsx` a tu Google Drive.
2. Ábrelo y elige **Archivo > Guardar como Hojas de cálculo de Google**. Desde ahora usa solo esa versión.
3. En la hoja **Lotes**, llena las celdas amarillas: hectáreas, número de plantas, año de siembra y riego.
4. Borra las filas de ejemplo (las que dicen EJEMPLO o EJ-0001) cuando empieces con datos reales.

## 2. Puente entre la app y el Sheets (Apps Script)
1. En el Google Sheets, entra a **Extensiones > Apps Script**.
2. Renombra el archivo `Código.gs` como **Api** y pega todo el contenido de `apps-script/Api.gs`.
3. Crea otro archivo con **+ > Secuencia de comandos**, llámalo **Clima** y pega `apps-script/Clima.gs`.
4. Guarda (ícono de disquete).
5. Arriba, elige la función **apiConfigurar** y presiona **Ejecutar**. Acepta los permisos: Google muestra "app no verificada", así que toca *Configuración avanzada > Ir a…*, porque es tu propio código.
   En el **Registro de ejecución** aparece tu **CLAVE**. Cópiala.
6. Elige la función **instalar** (del archivo Clima) y presiona **Ejecutar**. Esto activa el clima automático.
7. Ve a **Implementar > Nueva implementación**:
   - Tipo: **Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   - Presiona **Implementar** y copia la **URL** (termina en `/exec`).

> Nadie puede leer ni escribir sin la CLAVE. No la publiques.

## 3. Abrir la app
1. Abre la dirección de la app (GitHub Pages) en el celular o la laptop.
2. En **Ajustes**, pega la **URL** y la **CLAVE**, y toca *Guardar y probar conexión*.
3. Toca **Copiar enlace de configuración** y envíaselo por WhatsApp a tu papá. Al abrirlo, su app queda configurada sola.
4. En el celular: menú del navegador (⋮) > **Agregar a la pantalla de inicio**. Así queda como una app con ícono y funciona sin señal.

## Actualizar a una versión nueva
- **App:** se suben los archivos nuevos de `docs/` a GitHub y se cambia el número en `docs/version.js`. En los celulares aparece el aviso *"Hay una nueva versión · Tocar para actualizar"*. Los registros pendientes no se pierden.
- **Api.gs:** se pega el código nuevo y luego **Implementar > Gestionar implementaciones > ✏️ > Versión: Nueva versión > Implementar**. La URL no cambia.
- **Los datos no se tocan en ningún caso**: viven en el Google Sheets.

## Si algo falla
- *"Clave incorrecta"*: revisa la clave en Ajustes.
- *"API sin configurar"*: ejecuta `apiConfigurar` en Apps Script.
- *Un registro con "Error"*: entra a **Últimos registros**, lee el mensaje y toca *Reintentar*.
- *Cambié Api.gs y no se nota*: falta crear una **Nueva versión** de la implementación.
