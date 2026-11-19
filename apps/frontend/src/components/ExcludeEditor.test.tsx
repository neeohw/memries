import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExcludeEditor } from './ExcludeEditor';

function typePattern(text: string) {
  fireEvent.change(screen.getByLabelText('Pattern to skip'), { target: { value: text } });
}

describe('ExcludeEditor', () => {
  it('adds a pattern', () => {
    const onChange = vi.fn();
    render(<ExcludeEditor value={['^2019/']} onChange={onChange} />);
    typePattern('/RAW/');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith(['^2019/', '/RAW/']);
  });

  it('refuses a pattern that will not compile, before the server sees it', () => {
    const onChange = vi.fn();
    render(<ExcludeEditor value={[]} onChange={onChange} />);
    typePattern('(unclosed');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('not a valid expression');
  });

  it('refuses a duplicate rather than listing it twice', () => {
    const onChange = vi.fn();
    render(<ExcludeEditor value={['^2019/']} onChange={onChange} />);
    typePattern('^2019/');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('adds on Enter without submitting the form around it', () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ExcludeEditor value={[]} onChange={onChange} />
      </form>,
    );
    typePattern('^2019/');
    fireEvent.keyDown(screen.getByLabelText('Pattern to skip'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['^2019/']);
    // Enter inside this field must not save a Source still being described.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('removes a pattern, and names which one in the label', () => {
    const onChange = vi.fn();
    render(<ExcludeEditor value={['^2019/', '/RAW/']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop skipping /RAW/' }));
    expect(onChange).toHaveBeenCalledWith(['^2019/']);
  });

  it('says what an exclude does to photos already indexed', () => {
    render(<ExcludeEditor value={[]} onChange={() => {}} />);
    expect(screen.getByText(/leave the library on the next scan/i)).toBeTruthy();
  });
});
