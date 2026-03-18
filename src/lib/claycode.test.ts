import { describe, expect, it } from 'vitest'
import { generateClaycodeSvg } from './claycode'

describe('generateClaycodeSvg', () => {
  it('should return a valid SVG string', () => {
    const svg = generateClaycodeSvg('12345', 200)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('should output the requested size', () => {
    const svg = generateClaycodeSvg('00000', 200)
    expect(svg).toContain('width="200"')
    expect(svg).toContain('height="200"')
  })

  it('should contain at least a background rect', () => {
    const svg = generateClaycodeSvg('99999', 200)
    expect(svg).toContain('<rect')
    expect(svg).toContain('fill="black"')
    expect(svg).toContain('fill="white"')
  })

  it('should produce different SVGs for different codes', () => {
    const svg1 = generateClaycodeSvg('00001', 200)
    const svg2 = generateClaycodeSvg('00002', 200)
    expect(svg1).not.toBe(svg2)
  })

  it('should produce the same SVG for the same code', () => {
    const svg1 = generateClaycodeSvg('12345', 200)
    const svg2 = generateClaycodeSvg('12345', 200)
    expect(svg1).toBe(svg2)
  })

  it('should handle edge case code "00000"', () => {
    const svg = generateClaycodeSvg('00000', 200)
    expect(svg).toContain('<svg')
  })

  it('should handle edge case code "99999"', () => {
    const svg = generateClaycodeSvg('99999', 200)
    expect(svg).toContain('<svg')
  })

  it('should work with size 150', () => {
    const svg = generateClaycodeSvg('12345', 150)
    expect(svg).toContain('width="150"')
    expect(svg).toContain('height="150"')
  })
})
