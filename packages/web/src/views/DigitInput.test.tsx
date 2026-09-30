// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DigitInput, digitsOnly, digitsToNumber } from './DigitInput.js'

afterEach(cleanup)

describe('digitsOnly', () => {
  it('drops leading zeros and anything that is not a digit', () => {
    expect(digitsOnly('01')).toBe('1')
    expect(digitsOnly('007')).toBe('7')
    expect(digitsOnly('0')).toBe('0')
    expect(digitsOnly('00')).toBe('0')
    expect(digitsOnly('1.5')).toBe('15')
    expect(digitsOnly('-')).toBe('')
    expect(digitsOnly('abc')).toBe('')
  })
})

describe('digitsToNumber', () => {
  it('reads no digits as 0', () => {
    expect(digitsToNumber('')).toBe(0)
    expect(digitsToNumber('12')).toBe(12)
  })
})

describe('DigitInput', () => {
  it('turns 01 into 1 when a 1 is typed over a 0', () => {
    const onValueChange = vi.fn()
    const { getByRole } = render(<DigitInput value={0} onValueChange={onValueChange} />)
    const input = getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '01' } })
    expect(input.value).toBe('1')
    expect(onValueChange).toHaveBeenLastCalledWith(1)
  })

  it('reports 0 for an emptied field and shows 0 again on blur', () => {
    const onValueChange = vi.fn()
    const { getByRole } = render(<DigitInput value={3} onValueChange={onValueChange} />)
    const input = getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')
    expect(onValueChange).toHaveBeenLastCalledWith(0)
    fireEvent.blur(input)
    expect(input.value).toBe('0')
  })

  it('asks for a numeric keypad', () => {
    const { getByRole } = render(<DigitInput value={2} onValueChange={() => undefined} />)
    expect(getByRole('textbox').getAttribute('inputmode')).toBe('numeric')
  })
})
