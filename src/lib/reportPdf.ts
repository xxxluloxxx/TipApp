import { formatAmount } from '@/lib/currency'
import { parseDateOnly } from '@/lib/date'

// Exporta el reporte del periodo elegido a un PDF de texto (no captura de
// pantalla): jsPDF + autotable se cargan on-demand para no inflar el bundle
// inicial.

export interface ReportPdfMovement {
  date: string
  type: 'Gasto' | 'Ingreso'
  category: string
  account: string
  description: string
  amount: number
}

export interface ReportPdfData {
  periodLabel: string
  rangeText: string
  incomeTotal: number
  expenseTotal: number
  netTotal: number
  categories: Array<{ name: string, amount: number, percent: string }>
  accounts: Array<{ name: string, incomes: number, expenses: number, net: number }>
  insights: Array<{ label: string, value: string }>
  movements: ReportPdfMovement[]
}

function money(value: number): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}$${formatAmount(Math.abs(value))}`
}

function shortDate(value: string): string {
  const d = parseDateOnly(value)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function fileSafe(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .split('')
    .filter(ch => /[a-z0-9]/.test(ch))
    .join('')
}

export async function exportReportPdf(data: ReportPdfData): Promise<string> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 40
  let y = 50

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('TipApp - Reporte', margin, y)
  y += 20
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(data.periodLabel, margin, y)
  y += 14
  doc.setTextColor(110)
  doc.text(data.rangeText, margin, y)
  doc.setTextColor(0)
  y += 22

  const section = (title: string) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(title, margin, y)
    doc.setFont('helvetica', 'normal')
    y += 6
  }
  const afterTable = () => {
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 22
  }
  const common = {
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [55, 65, 81] as [number, number, number] },
  }

  section('Resumen')
  autoTable(doc, {
    ...common,
    startY: y,
    head: [['Ingresos', 'Gastos', 'Balance']],
    body: [[money(data.incomeTotal), money(data.expenseTotal), money(data.netTotal)]],
  })
  afterTable()

  if (data.insights.length > 0) {
    section('Hallazgos')
    autoTable(doc, {
      ...common,
      startY: y,
      body: data.insights.map(i => [i.label, i.value]),
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 150 } },
    })
    afterTable()
  }

  if (data.categories.length > 0) {
    section('Gastos por categoría')
    autoTable(doc, {
      ...common,
      startY: y,
      head: [['Categoría', 'Monto', '%']],
      body: data.categories.map(c => [c.name, money(c.amount), c.percent]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    })
    afterTable()
  }

  if (data.accounts.length > 0) {
    section('Movimiento por cuenta')
    autoTable(doc, {
      ...common,
      startY: y,
      head: [['Cuenta', 'Ingresos', 'Gastos', 'Neto']],
      body: data.accounts.map(a => [a.name, money(a.incomes), money(a.expenses), money(a.net)]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    })
    afterTable()
  }

  if (data.movements.length > 0) {
    section(`Movimientos (${data.movements.length})`)
    autoTable(doc, {
      ...common,
      startY: y,
      head: [['Fecha', 'Tipo', 'Categoría', 'Cuenta', 'Descripción', 'Monto']],
      body: data.movements.map(m => [
        shortDate(m.date),
        m.type,
        m.category,
        m.account,
        m.description,
        money(m.type === 'Gasto' ? -m.amount : m.amount),
      ]),
      columnStyles: { 5: { halign: 'right' } },
    })
  }

  const pages = doc.getNumberOfPages()
  doc.setFontSize(8)
  doc.setTextColor(120)
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.text(
      `Página ${i} de ${pages}`,
      doc.internal.pageSize.getWidth() - margin,
      doc.internal.pageSize.getHeight() - 20,
      { align: 'right' },
    )
  }

  const filename = `reporte-${fileSafe(data.rangeText)}.pdf`
  doc.save(filename)
  return filename
}
