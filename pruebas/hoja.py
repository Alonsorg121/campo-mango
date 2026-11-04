"""Ayudante de pruebas: convierte la plantilla .xlsx <-> JSON y recalcula con LibreOffice.
uso: python hoja.py exportar plantilla.xlsx salida.json
     python hoja.py recalcular plantilla.xlsx estado.json salida_valores.json
"""
import sys, json, datetime, subprocess, os, tempfile, shutil
from openpyxl import load_workbook

RECALC = os.environ.get('RECALC', '')

def ser(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return {'__fecha': v.strftime('%Y-%m-%d')}
    return v

def exportar(xlsx, out):
    wb = load_workbook(xlsx)
    d = {}
    for ws in wb.worksheets:
        d[ws.title] = [[ser(c.value) for c in row] for row in ws.iter_rows(min_row=1, max_row=max(ws.max_row, 1))]
    json.dump(d, open(out, 'w'), ensure_ascii=False)

def recalcular(xlsx, estado, out):
    est = json.load(open(estado))
    tmp = tempfile.mkdtemp()
    f = os.path.join(tmp, 'x.xlsx')
    shutil.copy(xlsx, f)
    wb = load_workbook(f)
    for nombre, filas in est.items():
        if nombre not in wb.sheetnames or nombre in ('LEEME',):
            continue
        ws = wb[nombre]
        if nombre == 'Resumen':
            continue
        for r in range(2, ws.max_row + 1):
            for c in range(1, ws.max_column + 1):
                ws.cell(r, c).value = None
        for r, fila in enumerate(filas[1:], 2):
            for c, v in enumerate(fila, 1):
                if isinstance(v, dict) and '__fecha' in v:
                    v = datetime.datetime.strptime(v['__fecha'], '%Y-%m-%d')
                ws.cell(r, c).value = v
    if 'Resumen' in est and est['Resumen'] and len(est['Resumen']) > 1:
        wb['Resumen']['B2'] = est['Resumen'][1][1]
    wb.save(f)
    subprocess.run(['python', RECALC, f, '60'], check=True, capture_output=True)
    wb2 = load_workbook(f, data_only=True)
    res = {}
    for ws in wb2.worksheets:
        res[ws.title] = [[ser(c.value) for c in row] for row in ws.iter_rows(min_row=1, max_row=max(ws.max_row, 1))]
    json.dump(res, open(out, 'w'), ensure_ascii=False)
    shutil.rmtree(tmp)

if __name__ == '__main__':
    if sys.argv[1] == 'exportar':
        exportar(sys.argv[2], sys.argv[3])
    else:
        recalcular(sys.argv[2], sys.argv[3], sys.argv[4])
