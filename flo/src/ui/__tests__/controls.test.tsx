import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorField, NumberField } from '../common/controls';

describe('NumberField', () => {
  it('commits typed values and simple arithmetic, clamped to bounds', () => {
    const onChange = vi.fn();
    render(<NumberField label="W" value={100} min={0} max={500} onChange={onChange} testId="n" />);
    const input = screen.getByTestId('n');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '120+8' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(128, true);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '9000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(500, true);
  });

  it('ignores invalid input', () => {
    const onChange = vi.fn();
    render(<NumberField label="W" value={10} onChange={onChange} testId="n" />);
    const input = screen.getByTestId('n');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('10');
  });
});

describe('ColorField', () => {
  it('accepts valid hex (including shorthand) and rejects invalid colors', () => {
    const onChange = vi.fn();
    render(<ColorField color="#000000" onChange={onChange} testId="c" />);
    const input = screen.getByTestId('c');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'f0a' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith('#FF00AA', undefined, true);
    onChange.mockClear();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzzzzz' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
