/**
 * ClayCode generator for Node.js Lambda.
 *
 * Ports the rectangle-based ClayCode rendering from
 * https://github.com/marcomaida/claycode (MIT + Commons Clause)
 * using only built-in Node.js and SVG — no Pixi.js required.
 *
 * Pipeline:
 *   text → UTF-8 bits → CRC-16 → BigInt → tree → SVG rounded rects
 */

// ---------------------------------------------------------------------------
// CRC-16 (CAN standard 0x4599 polynomial)
// ---------------------------------------------------------------------------
const CRC_POLY = [1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1] as const

const computeCRC = (inputBits: number[], poly: readonly number[]): number[] => {
  const inp = [...inputBits, ...Array<number>(poly.length - 1).fill(0)]
  for (let i = 0; i <= inp.length - poly.length; i++) {
    if (inp[i] === 1) {
      for (let j = 0; j < poly.length; j++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- loop bounds safe
        inp[i + j] = inp[i + j]! ^ poly[j]!
      }
    }
  }
  return inp.slice(inp.length - poly.length + 1)
}

// ---------------------------------------------------------------------------
// Text → bits (UTF-8) with CRC appended
// ---------------------------------------------------------------------------
const textToBits = (text: string): number[] => {
  const bytes = Buffer.from(text, 'utf8')
  const bits: number[] = []
  for (const byte of bytes) {
    for (let j = 7; j >= 0; j--) bits.push((byte >> j) & 1)
  }
  return [...bits, ...computeCRC(bits, CRC_POLY)]
}

// ---------------------------------------------------------------------------
// BigInt tree construction  (BitTreeConverter port)
// ---------------------------------------------------------------------------
interface CNode {
  children: CNode[]
  /** 1 (self) + sum of all descendant counts */
  numDescendants: number
  depth: number
}

/**
 * Prepend a leading 1-bit and interpret the resulting binary string as BigInt.
 * Equivalent to the original `bitArrayToInt` which reverses and sums.
 */
const bitArrayToInt = (bits: number[]): bigint =>
  BigInt('0b1' + bits.join(''))

/** Binary search for ⌊√x⌋ using BigInt arithmetic. */
const isqrt = (x: bigint): bigint => {
  if (x === 1n) return 1n
  let l = 0n
  let r = x
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- binary search terminates when mid^2 == x
  while (true) {
    const mid = l + (r - l) / 2n
    if (mid * mid <= x && (mid + 1n) * (mid + 1n) > x) return mid
    if (mid * mid <= x) l = mid
    else r = mid
  }
}

/**
 * Decompose x into a sequence of integers k_i such that sum(k_i^2) = x - 1,
 * taking the largest perfect-square-root at each step.
 */
const squareDecompose = (x: bigint): bigint[] => {
  const result: bigint[] = []
  let rem = x - 1n
  while (rem > 0n) {
    const k = isqrt(rem)
    result.push(k)
    rem -= k * k
  }
  return result
}

/** Recursively build the tree from a BigInt encoding. */
const buildNode = (n: bigint, depth: number): CNode => {
  const node: CNode = { children: [], numDescendants: 1, depth }
  if (n === 1n) return node
  const decomp = squareDecompose(n)
  node.children = decomp.map((childN) => buildNode(childN, depth + 1))
  node.numDescendants = 1 + node.children.reduce((s, c) => s + c.numDescendants, 0)
  return node
}

const bitsToTree = (bits: number[]): CNode => buildNode(bitArrayToInt(bits), 0)

// ---------------------------------------------------------------------------
// SVG rounded-rectangle ClayCode renderer  (draw_rectangle_claycode.js port)
// ---------------------------------------------------------------------------
type Color = 'white' | 'black'
const INVERSE: Record<Color, Color> = { white: 'black', black: 'white' }

interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly color: Color
}

const renderNode = (node: CNode, x: number, y: number, w: number, h: number, color: Color): Rect[] => {
  const result: Rect[] = [{ x, y, w, h, color }]
  if (node.children.length === 0) return result

  const childColor = INVERSE[color]
  const parentRelSpace = Math.pow(1 / node.numDescendants, 0.65)
  const n = node.children.length

  if (w >= h) {
    // Horizontal layout
    const interMargin = (parentRelSpace * w) / (1 + n)
    const sideMargin = (parentRelSpace * h) / 2
    const childH = h * (1 - parentRelSpace)
    let cx = x + interMargin
    const cy = y + sideMargin
    for (const child of node.children) {
      const weight = child.numDescendants / (node.numDescendants - 1)
      const childW = w * (1 - parentRelSpace) * weight
      result.push(...renderNode(child, cx, cy, childW, childH, childColor))
      cx += childW + interMargin
    }
  } else {
    // Vertical layout
    const sideMargin = (parentRelSpace * w) / 2
    const interMargin = (parentRelSpace * h) / (1 + n)
    const childW = w * (1 - parentRelSpace)
    const cx = x + sideMargin
    let cy = y + interMargin
    for (const child of node.children) {
      const weight = child.numDescendants / (node.numDescendants - 1)
      const childH = h * (1 - parentRelSpace) * weight
      result.push(...renderNode(child, cx, cy, childW, childH, childColor))
      cy += childH + interMargin
    }
  }

  return result
}

const rectToSvg = ({ x, y, w, h, color }: Rect): string => {
  const rx = Math.min(Math.min(w, h) / 5, 15)
  return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${rx.toFixed(2)}" fill="${color}"/>`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a ClayCode SVG for a given download code.
 *
 * @param downloadCode - 5-digit string, e.g. "12345"
 * @param size - output dimension in pixels (square), e.g. 200
 * @returns SVG string suitable for sharp.composite()
 */
export const generateClaycodeSvg = (downloadCode: string, size: number): string => {
  const bits = textToBits(downloadCode)
  const root = bitsToTree(bits)

  // Black root on white SVG background: outer boundary is visible on white receipt paper.
  // renderNode starts black (full square), alternates white/black at each level.
  const rects = renderNode(root, 0, 0, size, size, 'black')

  const body = rects.map(rectToSvg).join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" style="background:white">\n  ${body}\n</svg>`
}
