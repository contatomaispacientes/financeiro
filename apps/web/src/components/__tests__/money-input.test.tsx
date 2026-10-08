import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoneyInput } from '../money-input';

function Harness({ initial = null as number | null, onValue = (_: number | null) => {} }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <label>
      Valor
      <MoneyInput
        value={value}
        onChange={(cents) => {
          setValue(cents);
          onValue(cents);
        }}
      />
    </label>
  );
}

const nbsp = ' ';

describe('MoneyInput', () => {
  it('digitar enche da direita para a esquerda e devolve centavos inteiros', async () => {
    const values: Array<number | null> = [];
    render(<Harness onValue={(v) => values.push(v)} />);
    const input = screen.getByLabelText('Valor');

    await userEvent.type(input, '123456');

    expect(input).toHaveValue(`R$${nbsp}1.234,56`);
    expect(values.at(-1)).toBe(123456);
    expect(values.every((v) => v === null || Number.isInteger(v))).toBe(true);
  });

  it('mostra o valor inicial formatado', () => {
    render(<Harness initial={500} />);
    expect(screen.getByLabelText('Valor')).toHaveValue(`R$${nbsp}5,00`);
  });

  it('apagar tudo devolve null', async () => {
    const values: Array<number | null> = [];
    render(<Harness initial={12} onValue={(v) => values.push(v)} />);
    await userEvent.clear(screen.getByLabelText('Valor'));
    expect(values.at(-1)).toBeNull();
    expect(screen.getByLabelText('Valor')).toHaveValue('');
  });

  it('ignora letras e aceita colar "1.234,56"', async () => {
    const values: Array<number | null> = [];
    render(<Harness onValue={(v) => values.push(v)} />);
    const input = screen.getByLabelText('Valor');
    await userEvent.type(input, 'ab');
    expect(input).toHaveValue('');

    await userEvent.click(input);
    await userEvent.paste('1.234,56');
    expect(values.at(-1)).toBe(123456);
  });

  it('abre o teclado numérico no celular', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Valor')).toHaveAttribute('inputmode', 'numeric');
  });
});
