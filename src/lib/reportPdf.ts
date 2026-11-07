import { formatAmount } from '@/lib/currency'
import type { CellHookData } from 'jspdf-autotable'
import { hexToRgb } from '@/lib/colors'
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
  /** Hora del movimiento (`HH:MM:SS`) si la tiene; desempata el orden del mismo día. */
  time: string | null
  createdAt: string
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
  /** Color (`#rrggbb`) de cada cuenta por id, para su cabecera en la lista de movimientos. */
  accountColors: Record<string, string>
  /** Saldo de cada cuenta (por id, con signo) al inicio del periodo: base del saldo corrido. */
  openingByAccountId: Record<string, number>
  movements: ReportPdfMovement[]
}

function money(value: number): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}$${formatAmount(Math.abs(value))}`
}

type Rgb = [number, number, number]
const RED: Rgb = [185, 28, 28]
const GREEN: Rgb = [21, 128, 61]
const DEFAULT_ACCOUNT_COLOR: Rgb = [55, 65, 81]

/** Verde si entra plata (crédito), rojo si sale (débito), sin color si es 0. */
function signColor(value: number): Rgb | null {
  if (value > 0) return GREEN
  if (value < 0) return RED
  return null
}

function readableOn(color: Rgb): Rgb {
  const [r, g, b] = color
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? [17, 24, 39] : [255, 255, 255]
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
    didParseCell: (hook: CellHookData) => {
      if (hook.section === 'head') {
        hook.cell.styles.halign = 'right'
        return
      }
      const color = [signColor(data.openingBalance), GREEN, RED, signColor(data.netTotal)][hook.column.index]
      if (color) hook.cell.styles.textColor = color
    },
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
      didParseCell: (hook: CellHookData) => {
        if (hook.column.index === 1 && (hook.section === 'head' || hook.section === 'foot')) {
          hook.cell.styles.halign = 'right'
        }
      },
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
      columnStyles: { 1: { halign: 'right', textColor: RED }, 2: { halign: 'right' } },
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
      columnStyles: {
        1: { halign: 'right', textColor: GREEN },
        2: { halign: 'right', textColor: RED },
        3: { halign: 'right' },
      },
      didParseCell: (hook: CellHookData) => {
        if (hook.section === 'head' && hook.column.index > 0) {
          hook.cell.styles.halign = 'right'
        } else if (hook.section === 'body' && hook.column.index === 3) {
          const color = signColor(data.accounts[hook.row.index]?.net ?? 0)
          if (color) hook.cell.styles.textColor = color
        }
      },
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
    y += 18
    for (const group of groups) {
      // Más antiguo primero; mismo criterio de desempate que Transacciones
      // (hora si ambos la tienen, si no created_at) pero ascendente.
      group.sort((x, y2) => {
        if (x.date !== y2.date) return x.date < y2.date ? -1 : 1
        if (x.time && y2.time && x.time !== y2.time) return x.time < y2.time ? -1 : 1
        return x.createdAt.localeCompare(y2.createdAt)
      })
      const accountId = group[0]!.accountId
      const opening = data.openingByAccountId[accountId] ?? 0
      let running = opening
      const balances = group.map((m) => {
        running += m.amount
        return running
      })
      const net = group.reduce((sum, m) => sum + m.amount, 0)
      const accountColor = hexToRgb(data.accountColors[accountId] ?? '') ?? DEFAULT_ACCOUNT_COLOR
      const onAccount = readableOn(accountColor)
      // Evita dejar el título de una cuenta huérfano al final de la página.
      if (y > doc.internal.pageSize.getHeight() - 110) {
        doc.addPage()
        y = 50
      }
      // Cabecera con el color de la cuenta.
      const barWidth = doc.internal.pageSize.getWidth() - margin * 2
      doc.setFillColor(...accountColor)
      doc.roundedRect(margin, y - 12, barWidth, 20, 3, 3, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10.5)
      doc.setTextColor(...onAccount)
      doc.text(group[0]!.account, margin + 8, y + 2)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.text(`Saldo al inicio: ${money(opening)}`, margin + barWidth - 8, y + 2, { align: 'right' })
      doc.setTextColor(0)
      y += 14
      autoTable(doc, {
        ...common,
        startY: y,
        // Una fila nunca se parte entre páginas: el saldo se dibuja en la 2.ª línea de su celda.
        rowPageBreak: 'avoid',
        showFoot: 'lastPage',
        headStyles: { fillColor: accountColor, textColor: onAccount },
        head: [['Fecha', 'Tipo', 'Categoría / contraparte', 'Descripción', 'Monto / saldo']],
        // 2.ª línea en blanco: reserva el alto donde se dibuja el saldo que queda.
        body: group.map(m => [shortDate(m.date), m.type, m.category, m.description, `${money(m.amount)}\n `]),
        foot: [
          ['', '', '', `Neto (${group.length} mov.)`, money(net)],
          ['', '', '', 'Saldo final', money(running)],
        ],
        footStyles: { fillColor: [229, 231, 235] as Rgb, textColor: 0 },
        columnStyles: { 4: { halign: 'right' } },
        didParseCell: (hook: CellHookData) => {
          if (hook.column.index === 4 && (hook.section === 'head' || hook.section === 'foot')) {
            hook.cell.styles.halign = 'right'
          }
          // Débito (sale plata) en rojo, crédito (entra plata) en verde: toda la fila.
          let color: Rgb | null = null
          if (hook.section === 'body') color = signColor(group[hook.row.index]?.amount ?? 0)
          else if (hook.section === 'foot' && hook.column.index >= 3) {
            color = signColor(hook.row.index === 0 ? net : running)
          }
          if (color) hook.cell.styles.textColor = color
        },
        // Saldo de la cuenta DESPUÉS del movimiento, debajo del monto, entre
        // paréntesis (como en Transacciones): verde si es >= 0, rojo si queda negativo.
        didDrawCell: (hook: CellHookData) => {
          if (hook.section !== 'body' || hook.column.index !== 4) return
          const balance = balances[hook.row.index]
          if (balance === undefined) return
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7.5)
          doc.setTextColor(...(balance < 0 ? RED : GREEN))
          doc.text(
            `(${money(balance)})`,
            hook.cell.x + hook.cell.width - hook.cell.padding('right'),
            hook.cell.y + hook.cell.height - 4,
            { align: 'right' },
          )
          doc.setTextColor(0)
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
