from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter
from openpyxl.comments import Comment
import datetime as dt

wb = Workbook()
F = "Arial"
HDR = PatternFill("solid", fgColor="2E7D32")
EX = PatternFill("solid", fgColor="FFF8E1")
YEL = PatternFill("solid", fgColor="FFFF00")
CALC = PatternFill("solid", fgColor="E8F5E9")
thin = Side(style="thin", color="BDBDBD")
BR = Border(left=thin, right=thin, top=thin, bottom=thin)
N = 5000  # filas para validaciones/rangos

def table(name, cols, rows=(), calc=(), widths=None, example=True):
    ws = wb.create_sheet(name)
    for i, c in enumerate(cols, 1):
        cell = ws.cell(1, i, c)
        cell.font = Font(name=F, bold=True, color="FFFFFF")
        cell.fill = CALC if False else HDR
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BR
        ws.column_dimensions[get_column_letter(i)].width = (widths or {}).get(c, max(12, len(c) + 3))
    for r, row in enumerate(rows, 2):
        for i, v in enumerate(row, 1):
            cell = ws.cell(r, i, v)
            cell.font = Font(name=F)
            cell.border = BR
            if cols[i-1] in calc:
                cell.fill = CALC
            elif example:
                cell.fill = EX
            if isinstance(v, (dt.date, dt.datetime)):
                cell.number_format = "dd/mm/yyyy"
    for i, c in enumerate(cols, 1):
        if c in calc:
            ws.cell(1, i).fill = PatternFill("solid", fgColor="1B5E20")
            ws.cell(1, i).comment = Comment("Columna calculada (no se escribe a mano).", "Claude")
    ws.freeze_panes = "A2"
    ws.row_dimensions[1].height = 30
    return ws

def col(ws, header):
    for c in ws[1]:
        if c.value == header:
            return get_column_letter(c.column)
    raise KeyError(header)

def rng(ws, header):
    L = col(ws, header)
    return f"'{ws.title}'!${L}$2:${L}${N}"

def dv_list(ws, header, source, allow_blank=True):
    dv = DataValidation(type="list", formula1=source, allow_blank=allow_blank)
    dv.error = "Elige un valor de la lista"
    ws.add_data_validation(dv)
    L = col(ws, header)
    dv.add(f"{L}2:{L}{N}")

def money(ws, headers, fmt='"S/ "#,##0.00'):
    for h in headers:
        L = col(ws, h)
        for r in range(2, ws.max_row + 1):
            ws[f"{L}{r}"].number_format = fmt

d = dt.date

# ---------------- LEEME ----------------
ws0 = wb.active
ws0.title = "LEEME"

# ---------------- CATÁLOGOS ----------------
lotes = table("Lotes",
    ["ID_Lote","Nombre","Variedad","Hectareas","N_Plantas","Anio_Siembra","Sistema_Riego","Observaciones"],
    [["ATAULFO","Lote Ataulfo","Ataulfo",None,None,None,None,""],
     ["KENT","Lote Kent","Kent",None,None,None,None,""],
     ["EDWARD","Lote Edward","Edward",None,None,None,None,""],
     ["HADEN","Lote Haden","Haden",None,None,None,None,""],
     ["KEITT","Lote Keitt","Keitt",None,None,None,None,""],
     ["GENERAL","Gastos generales del campo","-",None,None,None,None,"Usar para gastos que no son de un solo lote (se reparten por hectárea)"]],
    example=False, widths={"Nombre":26,"Observaciones":50})
for r in range(2, 7):
    for h in ["Hectareas","N_Plantas","Anio_Siembra","Sistema_Riego"]:
        lotes[f"{col(lotes,h)}{r}"].fill = YEL
dv_list(lotes, "Sistema_Riego", '"Gravedad,Goteo,Microaspersión,Mixto"')

camp = table("Campanas",
    ["ID_Campana","Nombre","Fecha_Inicio","Fecha_Fin","Estado"],
    [["2026-2027","Campaña 2026-2027",d(2026,4,1),d(2027,3,31),"Activa"]],
    example=False, widths={"Nombre":22})
dv_list(camp, "Estado", '"Activa,Cerrada"')

trab = table("Trabajadores",
    ["ID_Trabajador","Nombres","DNI","Celular","Modalidad_Habitual","Jornal_Base","Activo"],
    [["T001","Juan Pérez (EJEMPLO)","","","Jornal",50,"Sí"]],
    widths={"Nombres":28})
money(trab, ["Jornal_Base"])
dv_list(trab, "Modalidad_Habitual", '"Jornal,Tarea"')
dv_list(trab, "Activo", '"Sí,No"')

catlab = table("Catalogo_Labores",
    ["Labor","Fase","Descripcion"],
    [["Poda","Poda","Poda de producción, sanitaria o de formación"],
     ["Limpieza / deshierbo","Mantenimiento","Control de malezas y limpieza de calles"],
     ["Riego","Mantenimiento","Riego por turno o goteo"],
     ["Mantenimiento de canales","Mantenimiento","Limpieza de canales y acequias"],
     ["Fertilización edáfica","Nutrición","Aplicación al suelo"],
     ["Fertilización foliar","Nutrición","Aplicación foliar"],
     ["Aplicación de paclobutrazol","Inducción","Regulador de crecimiento"],
     ["Inducción floral","Inducción","Nitrato de potasio u otros inductores"],
     ["Control fitosanitario","Sanidad","Plagas y enfermedades (oídio, antracnosis, trips, etc.)"],
     ["Control de mosca de la fruta","Sanidad","Trampas, cebos, recojo de fruta caída"],
     ["Monitoreo de plagas","Sanidad","Evaluación en campo"],
     ["Cosecha","Cosecha","Recojo de fruta"],
     ["Acarreo / carga","Cosecha","Traslado de jabas y carga al camión"],
     ["Otra labor","Otros","Especificar en observaciones"]],
    example=False, widths={"Labor":30,"Descripcion":55})

catcos = table("Categorias_Costo",
    ["Categoria","Ejemplos"],
    [["Riego y agua","Tarifa de agua (junta de usuarios), combustible de motobomba, energía"],
     ["Maquinaria y transporte","Tractor, flete, combustible, alquiler de equipos"],
     ["Servicios y trámites","SENASA, certificaciones, asesoría técnica, análisis de suelo"],
     ["Materiales y herramientas","Jabas, tijeras, mochilas, mantenimiento de herramientas"],
     ["Otros","Cualquier otro gasto"]],
    example=False, widths={"Categoria":28,"Ejemplos":70})

prov = table("Proveedores",
    ["ID_Proveedor","Nombre","RUC","Celular","Rubro"],
    [["P001","Agroveterinaria (EJEMPLO)","","","Insumos agrícolas"]], widths={"Nombre":30})

comp = table("Compradores",
    ["ID_Comprador","Nombre","Tipo","RUC","Celular","Total_Vendido","Total_Cobrado","Saldo_por_Cobrar"],
    [["C001","Acopiador (EJEMPLO)","Acopiador local","","",
      '=SUMIFS(Ventas!$L$2:$L$%d,Ventas!$E$2:$E$%d,A2)' % (N,N),
      '=SUMIFS(Cobros!$E$2:$E$%d,Cobros!$C$2:$C$%d,A2)' % (N,N),
      '=F2-G2']],
    calc=("Total_Vendido","Total_Cobrado","Saldo_por_Cobrar"), widths={"Nombre":28,"Tipo":26})
dv_list(comp, "Tipo", '"Acopiador local,Empacadora/exportadora,Mercado nacional,Exportación directa"')
money(comp, ["Total_Vendido","Total_Cobrado","Saldo_por_Cobrar"])

prod = table("Productos",
    ["ID_Producto","Nombre","Tipo","Ingrediente_Activo","Unidad","Stock_Minimo",
     "Cant_Comprada","Cant_Aplicada","Stock_Actual","Precio_Promedio","Alerta_Stock"],
    [["PR001","Nitrato de potasio (EJEMPLO)","Fertilizante","KNO3","kg",50,
      '=SUMIFS(Compras_Insumos!$F$2:$F$%d,Compras_Insumos!$D$2:$D$%d,A2)' % (N,N),
      '=SUMIFS(Aplicaciones!$F$2:$F$%d,Aplicaciones!$E$2:$E$%d,A2)' % (N,N),
      '=G2-H2',
      '=IFERROR(SUMIFS(Compras_Insumos!$I$2:$I$%d,Compras_Insumos!$D$2:$D$%d,A2)/G2,0)' % (N,N),
      '=IF(I2<=F2,"COMPRAR","OK")']],
    calc=("Cant_Comprada","Cant_Aplicada","Stock_Actual","Precio_Promedio","Alerta_Stock"),
    widths={"Nombre":30,"Ingrediente_Activo":20})
dv_list(prod, "Tipo", '"Fertilizante,Foliar,Fitosanitario,Regulador de crecimiento,Inductor floral,Enmienda,Otro"')
dv_list(prod, "Unidad", '"kg,L,saco,unidad"')
money(prod, ["Precio_Promedio"])

# ---------------- REGISTROS ----------------
LOT = rng(lotes, "ID_Lote"); CAMP = rng(camp, "ID_Campana")
COMPROB = '"Factura,Boleta,Recibo por honorarios,Ticket,Sin comprobante"'

pl = table("Planilla",
    ["ID","Fecha","Campana","Trabajador","Lote","Labor","Modalidad","Cantidad","Tarifa","Total","Pagado","Fecha_Pago","Observaciones"],
    [["EJ-0001",d(2026,11,4),"2026-2027","T001","KENT","Limpieza / deshierbo","Jornal",1,50,"=H2*I2","No",None,"Cantidad = días (jornal) o tareas"]],
    calc=("Total",), widths={"Labor":26,"Observaciones":34})
dv_list(pl,"Campana",CAMP); dv_list(pl,"Trabajador",rng(trab,"ID_Trabajador")); dv_list(pl,"Lote",LOT)
dv_list(pl,"Labor",rng(catlab,"Labor")); dv_list(pl,"Modalidad",'"Jornal,Tarea"'); dv_list(pl,"Pagado",'"Sí,No"')
money(pl, ["Tarifa","Total"])

bit = table("Bitacora_Labores",
    ["ID","Fecha","Campana","Lote","Labor","Detalle","Responsable","N_Trabajadores","Foto","Observaciones"],
    [["EJ-0001",d(2026,11,4),"2026-2027","KENT","Control de mosca de la fruta","Revisión de trampas","Papá",2,"",""]],
    widths={"Labor":28,"Detalle":34,"Observaciones":30})
dv_list(bit,"Campana",CAMP); dv_list(bit,"Lote",LOT); dv_list(bit,"Labor",rng(catlab,"Labor"))

ci = table("Compras_Insumos",
    ["ID","Fecha","Campana","Producto","Proveedor","Cantidad","Unidad","Precio_Unitario","Total","Tipo_Comprobante","N_Comprobante","Foto_Comprobante"],
    [["EJ-0001",d(2026,11,4),"2026-2027","PR001","P001",100,"kg",4.5,"=F2*H2","Factura","F001-000123",""]],
    calc=("Total",))
dv_list(ci,"Campana",CAMP); dv_list(ci,"Producto",rng(prod,"ID_Producto")); dv_list(ci,"Proveedor",rng(prov,"ID_Proveedor"))
dv_list(ci,"Unidad",'"kg,L,saco,unidad"'); dv_list(ci,"Tipo_Comprobante",COMPROB)
money(ci, ["Precio_Unitario","Total"])

ap = table("Aplicaciones",
    ["ID","Fecha","Campana","Lote","Producto","Cantidad","Dosis","Metodo","Aplicador","Costo_Estimado","Observaciones"],
    [["EJ-0001",d(2026,11,4),"2026-2027","KENT","PR001",40,"4% foliar","Foliar","T001",
      '=F2*IFERROR(INDEX(Productos!$J$2:$J$%d,MATCH(E2,Productos!$A$2:$A$%d,0)),0)' % (N,N),""]],
    calc=("Costo_Estimado",), widths={"Dosis":16,"Observaciones":30})
dv_list(ap,"Campana",CAMP); dv_list(ap,"Lote",LOT); dv_list(ap,"Producto",rng(prod,"ID_Producto"))
dv_list(ap,"Metodo",'"Edáfico,Foliar,Fertirriego,Drench,Trampa/cebo"'); dv_list(ap,"Aplicador",rng(trab,"ID_Trabajador"))
money(ap, ["Costo_Estimado"])

plan = table("Plan_Fertilizacion",
    ["ID","Campana","Lote","Fase","Producto","Mes_Programado","Cantidad_Programada","Cantidad_Aplicada","Avance"],
    [["EJ-0001","2026-2027","KENT","Inducción","PR001","Junio",80,
      '=SUMIFS(Aplicaciones!$F$2:$F$%d,Aplicaciones!$C$2:$C$%d,B2,Aplicaciones!$D$2:$D$%d,C2,Aplicaciones!$E$2:$E$%d,E2)' % (N,N,N,N),
      '=IFERROR(H2/G2,0)']],
    calc=("Cantidad_Aplicada","Avance"))
dv_list(plan,"Campana",CAMP); dv_list(plan,"Lote",LOT); dv_list(plan,"Producto",rng(prod,"ID_Producto"))
dv_list(plan,"Fase",'"Post-cosecha,Poda,Inducción,Floración,Cuajado,Llenado de fruto,Cosecha"')
dv_list(plan,"Mes_Programado",'"Enero,Febrero,Marzo,Abril,Mayo,Junio,Julio,Agosto,Septiembre,Octubre,Noviembre,Diciembre"')
plan["I2"].number_format = "0%"

cos = table("Costos",
    ["ID","Fecha","Campana","Lote","Categoria","Concepto","Monto","Proveedor","Tipo_Comprobante","N_Comprobante","Foto_Comprobante"],
    [["EJ-0001",d(2026,11,4),"2026-2027","GENERAL","Riego y agua","Tarifa de agua - turno noviembre",120,"P001","Recibo por honorarios","",""]],
    widths={"Concepto":34})
dv_list(cos,"Campana",CAMP); dv_list(cos,"Lote",LOT); dv_list(cos,"Categoria",rng(catcos,"Categoria"))
dv_list(cos,"Proveedor",rng(prov,"ID_Proveedor")); dv_list(cos,"Tipo_Comprobante",COMPROB)
money(cos, ["Monto"])

ve = table("Ventas",
    ["ID_Venta","Fecha","Campana","Lote","Comprador","Unidad","Cantidad","Kg_por_Jaba","Kg_Totales","Kg_Descarte","Precio_Unitario","Total","Tipo_Comprobante","N_Comprobante","Foto_Comprobante","Observaciones"],
    [["EJ-0001",d(2026,11,4),"2026-2027","KENT","C001","Jaba",100,22,
      '=IF(F2="Kg",G2,G2*H2)',0,25,"=G2*K2","Factura","","","Precio por jaba"]],
    calc=("Kg_Totales","Total"), widths={"Observaciones":26})
dv_list(ve,"Campana",CAMP); dv_list(ve,"Lote",LOT); dv_list(ve,"Comprador",rng(comp,"ID_Comprador"))
dv_list(ve,"Unidad",'"Kg,Jaba"'); dv_list(ve,"Tipo_Comprobante",COMPROB)
money(ve, ["Precio_Unitario","Total"])

cob = table("Cobros",
    ["ID","Fecha","Comprador","ID_Venta","Monto","Tipo","Medio_Pago","Observaciones"],
    [["EJ-0001",d(2026,11,4),"C001","EJ-0001",1500,"Adelanto","Transferencia","ID_Venta es opcional (adelantos antes de la venta)"]],
    widths={"Observaciones":44})
dv_list(cob,"Comprador",rng(comp,"ID_Comprador")); dv_list(cob,"ID_Venta",rng(ve,"ID_Venta"))
dv_list(cob,"Tipo",'"Adelanto,Pago parcial,Liquidación final"'); dv_list(cob,"Medio_Pago",'"Efectivo,Transferencia,Yape/Plin,Cheque"')
money(cob, ["Monto"])

# ---------------- CLIMA ----------------
CLC = ["Fecha","T_Max_C","T_Min_C","T_Prom_C","Lluvia_mm","Humedad_Prom_pct","ET0_mm","Viento_Max_kmh","Fuente"]
cl = table("Clima", CLC, [], widths={"Fuente":30})
clh = table("Clima_Hoy", CLC[:-1] + ["Actualizado"], [], widths={"Actualizado":20})
for ws_ in (cl, clh):
    ws_.cell(1,1).comment = Comment("Esta hoja la llena sola el script de clima. No escribas aquí.", "Claude")
    ws_.sheet_properties.tabColor = "0288D1"

# ---------------- RESUMEN ----------------
rs = wb.create_sheet("Resumen", 1)
rs["A1"] = "RESUMEN POR LOTE Y CAMPAÑA"; rs["A1"].font = Font(name=F, bold=True, size=14, color="2E7D32")
rs["A2"] = "Campaña:"; rs["A2"].font = Font(name=F, bold=True)
rs["B2"] = "2026-2027"; rs["B2"].fill = YEL; rs["B2"].font = Font(name=F, bold=True, color="0000FF")
rs["C2"] = "← escribe aquí la campaña que quieres ver"; rs["C2"].font = Font(name=F, italic=True, color="757575")
dvr = DataValidation(type="list", formula1=CAMP); rs.add_data_validation(dvr); dvr.add("B2")
heads = ["Lote","Hectáreas","Ingresos (S/)","Mano de obra (S/)","Insumos aplicados (S/)","Otros costos (S/)",
         "Gastos generales prorrateados (S/)","Costo total (S/)","Utilidad (S/)","Costo por ha (S/)",
         "Kg vendidos","Costo por kg (S/)","Precio promedio por kg (S/)","Saldo por cobrar del lote"]
heads = heads[:13]
for i,h in enumerate(heads,1):
    c = rs.cell(4,i,h); c.font = Font(name=F,bold=True,color="FFFFFF"); c.fill = HDR
    c.alignment = Alignment(wrap_text=True,horizontal="center",vertical="center"); c.border = BR
    rs.column_dimensions[get_column_letter(i)].width = 16
rs.column_dimensions["A"].width = 14
rs.row_dimensions[4].height = 45
S = lambda sh, c: f"{sh}!${c}$2:${c}${N}"
ids = ["ATAULFO","KENT","EDWARD","HADEN","KEITT"]
for k, lid in enumerate(ids):
    r = 5 + k
    f = {
     "A": lid,
     "B": f"=IFERROR(INDEX(Lotes!$D$2:$D$20,MATCH(A{r},Lotes!$A$2:$A$20,0)),0)",
     "C": f"=SUMIFS({S('Ventas','L')},{S('Ventas','D')},A{r},{S('Ventas','C')},$B$2)",
     "D": f"=SUMIFS({S('Planilla','J')},{S('Planilla','E')},A{r},{S('Planilla','C')},$B$2)",
     "E": f"=SUMIFS({S('Aplicaciones','J')},{S('Aplicaciones','D')},A{r},{S('Aplicaciones','C')},$B$2)",
     "F": f"=SUMIFS({S('Costos','G')},{S('Costos','D')},A{r},{S('Costos','C')},$B$2)",
     "G": f"=IFERROR($B$12*B{r}/SUM($B$5:$B$9),0)",
     "H": f"=SUM(D{r}:G{r})",
     "I": f"=C{r}-H{r}",
     "J": f"=IFERROR(H{r}/B{r},0)",
     "K": f"=SUMIFS({S('Ventas','I')},{S('Ventas','D')},A{r},{S('Ventas','C')},$B$2)",
     "L": f"=IFERROR(H{r}/K{r},0)",
     "M": f"=IFERROR(C{r}/K{r},0)",
    }
    for c, v in f.items():
        rs[f"{c}{r}"] = v
r = 10
rs[f"A{r}"] = "TOTAL"
for c in "BCDEFGHIK":
    rs[f"{c}{r}"] = f"=SUM({c}5:{c}9)"
rs[f"J{r}"] = f"=IFERROR(H{r}/B{r},0)"; rs[f"L{r}"] = f"=IFERROR(H{r}/K{r},0)"; rs[f"M{r}"] = f"=IFERROR(C{r}/K{r},0)"
for rr in range(5, 11):
    for i in range(1, 14):
        c = rs.cell(rr, i); c.font = Font(name=F, bold=(rr==10)); c.border = BR
        if i in (3,4,5,6,7,8,9,10,12,13): c.number_format = '"S/ "#,##0.00;[Red]-"S/ "#,##0.00;-'
        elif i in (2,): c.number_format = '0.00;-0.00;-'
        elif i == 11: c.number_format = '#,##0;-#,##0;-'
    if rr == 10:
        for i in range(1,14): rs.cell(rr,i).fill = CALC
rs["A12"] = "Gastos generales:"; rs["A12"].font = Font(name=F, bold=True)
rs["B12"] = (f"=SUMIFS({S('Planilla','J')},{S('Planilla','E')},\"GENERAL\",{S('Planilla','C')},$B$2)"
             f"+SUMIFS({S('Costos','G')},{S('Costos','D')},\"GENERAL\",{S('Costos','C')},$B$2)"
             f"+SUMIFS({S('Aplicaciones','J')},{S('Aplicaciones','D')},\"GENERAL\",{S('Aplicaciones','C')},$B$2)")
rs["B12"].number_format = '"S/ "#,##0.00'; rs["B12"].font = Font(name=F)
rs["C12"] = "Se reparten entre los lotes según sus hectáreas (llena las hectáreas en la hoja Lotes)."
rs["C12"].font = Font(name=F, italic=True, color="757575")
rs["A14"] = "Saldo total por cobrar:"; rs["A14"].font = Font(name=F, bold=True)
rs["B14"] = f"=SUM(Compradores!$H$2:$H${N})"; rs["B14"].number_format = '"S/ "#,##0.00'; rs["B14"].font = Font(name=F)
rs["A15"] = "Insumos con stock bajo:"; rs["A15"].font = Font(name=F, bold=True)
rs["B15"] = f'=COUNTIF(Productos!$K$2:$K${N},"COMPRAR")'; rs["B15"].font = Font(name=F)
rs["A17"] = "Clima de la campaña:"; rs["A17"].font = Font(name=F, bold=True)
ini = "INDEX(Campanas!$C$2:$C$50,MATCH($B$2,Campanas!$A$2:$A$50,0))"
fin = "INDEX(Campanas!$D$2:$D$50,MATCH($B$2,Campanas!$A$2:$A$50,0))"
crit = f'Clima!$A$2:$A${N},">="&{ini},Clima!$A$2:$A${N},"<="&{fin}'
clima_rows = [("Temperatura promedio (°C)", f"=IFERROR(AVERAGEIFS(Clima!$D$2:$D${N},{crit}),\"-\")", '0.0'),
              ("Temperatura máxima promedio (°C)", f"=IFERROR(AVERAGEIFS(Clima!$B$2:$B${N},{crit}),\"-\")", '0.0'),
              ("Temperatura mínima promedio (°C)", f"=IFERROR(AVERAGEIFS(Clima!$C$2:$C${N},{crit}),\"-\")", '0.0'),
              ("Lluvia acumulada (mm)", f"=SUMIFS(Clima!$E$2:$E${N},{crit})", '0.0'),
              ("Evapotranspiración acumulada ET0 (mm)", f"=SUMIFS(Clima!$G$2:$G${N},{crit})", '0.0'),
              ("Días registrados", f"=COUNTIFS({crit})", '0')]
for k,(lab,fm,nf) in enumerate(clima_rows):
    r = 18 + k
    rs[f"A{r}"] = lab; rs[f"A{r}"].font = Font(name=F)
    rs[f"D{r}"] = fm; rs[f"D{r}"].font = Font(name=F); rs[f"D{r}"].number_format = nf
    rs[f"D{r}"].fill = CALC
rs["A25"] = "Esta hoja solo calcula. La app la muestra en Resumen por lote."; rs["A25"].font = Font(name=F, italic=True, color="757575")
rs.freeze_panes = "B5"

# ---------------- LEEME contenido ----------------
txt = [
 ("CAMPO DE MANGO: BASE DE DATOS DE LA APP", "t"),
 ("", ""),
 ("CÓMO SE USA ESTE ARCHIVO", "h"),
 ("1. Cada hoja es una tabla de la app. La fila 1 tiene los encabezados: no los cambies de nombre ni los muevas.", ""),
 ("2. Las celdas AMARILLAS las llenas tú: hectáreas, número de plantas, año de siembra y riego de cada lote (hoja Lotes).", ""),
 ("3. Las filas color crema son EJEMPLOS (EJEMPLO / EJ-0001). Bórralas cuando empiecen a registrar datos reales.", ""),
 ("4. Las columnas con encabezado verde oscuro y celdas verde claro se CALCULAN SOLAS. No se escriben.", ""),
 ("5. La hoja Resumen muestra ingresos, costos, utilidad, costo por ha y costo por kg de cada lote en la campaña elegida.", ""),
 ("", ""),
 ("MÓDULOS", "h"),
 ("Catálogos (se llenan una vez): Lotes, Campanas, Trabajadores, Productos, Proveedores, Compradores, Catalogo_Labores, Categorias_Costo", ""),
 ("Registro diario: Planilla (jornal o tarea), Bitacora_Labores, Compras_Insumos, Aplicaciones, Costos, Ventas, Cobros", ""),
 ("Planificación: Plan_Fertilizacion (lo programado frente a lo aplicado, con % de avance)", ""),
 ("Gastos que no son de un lote (agua, flete general, SENASA): usa el lote GENERAL; se reparten por hectárea.", ""),
 ("Adelantos de compradores: regístralos en Cobros con Tipo = Adelanto (la venta es opcional). El saldo por comprador está en Compradores.", ""),
 ("", ""),
 ("CONEXIÓN CON LA APP", "h"),
 ("Este archivo es la BASE DE DATOS. La app (celular/laptop) escribe y lee aquí mediante el código Api.gs (Extensiones > Apps Script).", ""),
 ("Pasos completos de instalación: archivo INSTALACION.md del proyecto.", ""),
 ("REGLAS PARA NO PERDER INFORMACIÓN", "h"),
 ("• No cambies el nombre de las hojas ni de los encabezados (fila 1). La app escribe por nombre de columna.", ""),
 ("• Si necesitas una columna nueva, agrégala AL FINAL de la hoja (nunca en medio): la hoja Resumen usa las posiciones actuales.", ""),
 ("• Puedes corregir datos a mano aquí cuando quieras; la app mostrará lo corregido en la siguiente sincronización.", ""),
 ("• Haz una copia de seguridad de vez en cuando: Archivo > Descargar > Microsoft Excel.", ""),
 ("", ""),
 ("MÓDULO CLIMA (automático)", "h"),
 ("Hojas: Clima (un registro por día) y Clima_Hoy (pronóstico del día, se actualiza cada 3 horas). Se llenan solas: no escribas en ellas.", ""),
 ("1. En el Google Sheets: Extensiones > Apps Script. Pega el código del archivo Clima_AppsScript.gs y guarda.", ""),
 ("2. La ubicación del campo ya está puesta (-4.884565, -80.268667).", ""),
 ("3. Elige la función 'instalar' y presiona Ejecutar (acepta los permisos de Google). Carga el histórico desde el 1 de abril de 2026 y desde ahí funciona solo, cada 3 horas.", ""),
 ("4. En el Sheets aparece un menú 'Clima' para actualizar a mano si lo necesitas.", ""),
 ("5. La app muestra el clima automáticamente en la pantalla de inicio y en la sección Clima.", ""),
 ("Datos: temperatura máxima, mínima y promedio, lluvia, humedad, evapotranspiración (ET0, útil para el riego) y viento. Fuente: Open-Meteo (modelo satelital; no es una estación en tu campo).", ""),
 ("", ""),
 ("Nota: precios y cantidades de los ejemplos son referenciales, solo para mostrar el formato.", "n"),
]
ws0.column_dimensions["A"].width = 125
for i,(t,s) in enumerate(txt,1):
    c = ws0.cell(i,1,t); c.alignment = Alignment(wrap_text=True, vertical="top")
    if s=="t": c.font = Font(name=F,bold=True,size=15,color="2E7D32")
    elif s=="h": c.font = Font(name=F,bold=True,size=11,color="FFFFFF"); c.fill = HDR
    elif s=="n": c.font = Font(name=F,italic=True,color="757575")
    else: c.font = Font(name=F)

# Order
order = ["LEEME","Resumen","Lotes","Campanas","Trabajadores","Productos","Proveedores","Compradores",
         "Planilla","Bitacora_Labores","Compras_Insumos","Aplicaciones","Plan_Fertilizacion","Costos","Ventas","Cobros",
         "Clima_Hoy","Clima","Catalogo_Labores","Categorias_Costo"]
wb._sheets = [wb[n] for n in order]
for n in ["Planilla","Bitacora_Labores","Compras_Insumos","Aplicaciones","Plan_Fertilizacion","Costos","Ventas","Cobros"]:
    wb[n].sheet_properties.tabColor = "1565C0"
for n in ["Lotes","Campanas","Trabajadores","Productos","Proveedores","Compradores","Catalogo_Labores","Categorias_Costo"]:
    wb[n].sheet_properties.tabColor = "2E7D32"
wb["Resumen"].sheet_properties.tabColor = "F9A825"
wb.save("Campo_Mango_BaseDatos.xlsx")
print("ok")
