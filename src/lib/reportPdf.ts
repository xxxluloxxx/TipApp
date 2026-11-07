import { formatAmount } from '@/lib/currency'
import { parseDateOnly } from '@/lib/date'

// Exporta el reporte del periodo elegido a un PDF de texto (no captura de
// pantalla): jsPDF + autotable se cargan on-demand para no inflar el bundle
// inicial.

export interface ReportPdfMovement {
  date: string
  type: 'Gasto' | 'Ingreso' | 'Transf. enviada' | 'Transf. recibida' | 'Deuda'
  category: string
  accountId: string
  account: string
  description: string
  /** Con signo: gastos negativos, ingresos positivos; en transferencias, el monto movido. */
  amount: number
}

export interface ReportPdfData {
  periodLabel: string
  rangeText: string
  /** Suma de las cuentas con saldo positivo al inicio del periodo. */
  openingBalance: number
  openingAccounts: Array<{ name: string, balance: number }>
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
  // `columnStyles` solo alinea el cuerpo: las cabeceras de las columnas
  // numéricas se alinean aparte para que queden sobre sus valores.
  const alignHead = (rightColumns: number[]) => ({
    didParseCell: (hook: { section: string, column: { index: number }, cell: { styles: { halign: string } } }) => {
      if (hook.section === 'head' && rightColumns.includes(hook.column.index)) {
        hook.cell.styles.halign = 'right'
      }
    },
  })
  const common = {
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [55, 65, 81] as [number, number, number] },
  }

  section('Resumen')
  autoTable(doc, {
    ...common,
    startY: y,
    head: [['Saldo al inicio', 'Ingresos', 'Gastos', 'Balance del periodo']],
    body: [[money(data.openingBalance), money(data.incomeTotal), money(data.expenseTotal), money(data.netTotal)]],
    columnStyles: { 0: { halign: 'right' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    ...alignHead([0, 1, 2, 3]),
  })
  afterTable()

  if (data.openingAccounts.length > 0) {
    section('Saldo al inicio por cuenta (solo cuentas en positivo)')
    autoTable(doc, {
      ...common,
      startY: y,
      head: [['Cuenta', 'Saldo']],
      body: [
        ...data.openingAccounts.map(a => [a.name, money(a.balance)]),
      ],
      foot: [['Total', money(data.openingBalance)]],
      footStyles: { fillColor: [229, 231, 235] as [number, number, number], textColor: 0 },
      columnStyles: { 1: { halign: 'right' } },
      ...alignHead([1]),
    })
    afterTable()
  }

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
      ...alignHead([1, 2]),
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
      ...alignHead([1, 2, 3]),
    })
    afterTable()
  }

  // Movimientos agrupados por cuenta (una tabla por cuenta). Las transferencias
  // aparecen en las dos cuentas: como enviada en el origen y recibida en el destino.
  if (data.movements.length > 0) {
    const byAccount = new Map<string, ReportPdfMovement[]>()
    for (const movement of data.movements) {
      const list = byAccount.get(movement.accountId) ?? []
      list.push(movement)
      byAccount.set(movement.accountId, list)
    }
    const order = new Map(data.accounts.map((a, index) => [a.name, index]))
    const groups = [...byAccount.values()].sort((a, b) =>
      (order.get(a[0]!.account) ?? 999) - (order.get(b[0]!.account) ?? 999),
    )

    section(`Movimientos por cuenta (${data.movements.length})`)
    y += 4
    for (const group of groups) {
      const net = group.reduce((sum, m) => sum + m.amount, 0)
      // Evita dejar el título de una cuenta huérfano al final de la página.
      if (y > doc.internal.pageSize.getHeight() - 110) {
        doc.addPage()
        y = 50
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10.5)
      doc.text(group[0]!.account, margin, y)
      doc.setFont('helvetica', 'normal')
      y += 5
      autoTable(doc, {
        ...common,
        startY: y,
        head: [['Fecha', 'Tipo', 'Categoría / contraparte', 'Descripción', 'Monto']],
        body: group.map(m => [shortDate(m.date), m.type, m.category, m.description, money(m.amount)]),
        foot: [['', '', '', `Neto (${group.length} mov.)`, money(net)]],
        footStyles: { fillColor: [229, 231, 235] as [number, number, number], textColor: 0 },
        columnStyles: { 4: { halign: 'right' } },
        ...alignHead([4]),
        didParseCell: (hook: { section: string, column: { index: number }, cell: { styles: { halign: string } } }) => {
          if (hook.column.index === 4 && (hook.section === 'head' || hook.section === 'foot')) {
            hook.cell.styles.halign = 'right'
          }
        },
      })
      afterTable()
    }
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
