import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExcludeEditor, withPendingPattern } from './ExcludeEditor';

/**
 * The half-typed pattern lives in the form, not the editor, so a test drives
 * it the way the form does.
 */
function Editor({
  value = [],
  onChange = () => {},
  folder,
}: {
  value?: string[];
  onChange?: (next: string[]) => void;
  folder?: string;
}) {
  const [pending, setPending] = useState('');
  return (
    <ExcludeEditor
      value={value}
      onChange={onChange}
      pending={pending}
      onPendingChange={setPending}
      folder={folder}
    />
  );
}

function typePattern(text: string) {
  fireEvent.change(screen.getByLabelText('Pattern to skip'), { target: { value: text } });
}

describe('ExcludeEditor', () => {
  it('adds a pattern', () => {
    const onChange = vi.fn();
    render(<Editor value={['^2019/']} onChange={onChange} />);
    typePattern('/RAW/');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith(['^2019/', '/RAW/']);
  });

  it('refuses a pattern that will not compile, before the server sees it', () => {
    const onChange = vi.fn();
    render(<Editor onChange={onChange} />);
    typePattern('(unclosed');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('not a valid expression');
  });

  it('refuses a duplicate rather than listing it twice', () => {
    const onChange = vi.fn();
    render(<Editor value={['^2019/']} onChange={onChange} />);
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
        <Editor onChange={onChange} />
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
    render(<Editor value={['^2019/', '/RAW/']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop skipping /RAW/' }));
    expect(onChange).toHaveBeenCalledWith(['^2019/']);
  });

  it('says what an exclude does to photos already indexed', () => {
    render(<Editor />);
    expect(screen.getByText(/leave the library on the next scan/i)).toBeTruthy();
  });
  // The patterns belong to one folder. The panel used to say "inside this
  // source" and name nothing, which read as a setting for the whole library.
  it('names the folder its patterns belong to', () => {
    const { rerender } = render(
      <Editor onChange={vi.fn()} folder="/data/photos/backup iPhone XS" />,
    );
    expect(screen.getByText('Skip folders inside /data/photos/backup iPhone XS')).toBeTruthy();
    expect(screen.getByText(/apply to this folder only/)).toBeTruthy();

    // Nothing typed yet on a new folder: no name to give, so no empty claim.
    rerender(<Editor onChange={vi.fn()} />);
    expect(screen.getByText('Skip folders')).toBeTruthy();
  });

  // The box is a staging area with its own Add button, so what sits in it
  // when the folder is saved has to be committed, not dropped.
  describe('withPendingPattern', () => {
    it('appends what was typed but never added', () => {
      expect(withPendingPattern(['^2019/'], '/RAW/')).toEqual(['^2019/', '/RAW/']);
      expect(withPendingPattern([], '  ^2019/  ')).toEqual(['^2019/']);
    });

    it('leaves the list alone when there is nothing usable to add', () => {
      const value = ['^2019/'];
      expect(withPendingPattern(value, '')).toBe(value);
      expect(withPendingPattern(value, '   ')).toBe(value);
      // The editor has already said both of these on screen.
      expect(withPendingPattern(value, '(unclosed')).toBe(value);
      expect(withPendingPattern(value, '^2019/')).toBe(value);
    });
  });
});
