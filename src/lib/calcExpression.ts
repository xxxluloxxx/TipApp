// Mini evaluador para el teclado de la calculadora: la expresión es texto con
// dígitos, coma decimal y los operadores + / − (ej. "1200−180+5,5").

const OPERATORS = ['+', '−']

export function isOperator(ch: string): boolean {
  return OPERATORS.includes(ch)
}

/** Agrega una tecla a la expresión respetando las reglas del teclado. */
export function pressKey(expr: string, key: string): string {
  const last = expr.slice(-1)
  const currentNumber = expr.split(/[+−]/).pop() ?? ''

  if (isOperator(key)) {
    if (expr === '') return key === '−' ? '−' : expr
    if (isOperator(last)) return expr.slice(0, -1) + key
    return expr + key
  }
  if (key === ',') {
    if (currentNumber.includes(',')) return expr
    return expr + (currentNumber === '' ? '0,' : ',')
  }
  // Dígito: máximo 2 decimales y 10 dígitos enteros por número.
  const [intPart = '', decPart] = currentNumber.split(',')
  if (decPart !== undefined && decPart.length >= 2) return expr
  if (decPart === undefined && intPart.length >= 10) return expr
  // Evita ceros a la izquierda ("007").
  if (currentNumber === '0' && key === '0') return expr
  if (currentNumber === '0') return expr.slice(0, -1) + key
  return expr + key
}

export function backspace(expr: string): string {
  return expr.slice(0, -1)
}

/** Resultado de la expresión, o `null` si está vacía o incompleta. */
export function evaluate(expr: string): number | null {
  if (!expr) return null
  let normalized = expr
  while (isOperator(normalized.slice(-1))) normalized = normalized.slice(0, -1)
  if (!normalized) return null
  if (normalized.startsWith('−')) normalized = '0' + normalized
  let total = 0
  let sign = 1
  let token = ''
  const flush = () => {
    if (token) total += sign * Number(token.replace(',', '.'))
    token = ''
  }
  for (const ch of normalized) {
    if (isOperator(ch)) {
      flush()
      sign = ch === '+' ? 1 : -1
    } else {
      token += ch
    }
  }
  flush()
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : null
}

export function hasOperator(expr: string): boolean {
  return /[+−]/.test(expr.slice(1))
}
