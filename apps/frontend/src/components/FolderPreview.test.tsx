import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FolderPreview as Preview, FolderPreviewNode } from '../models/source';
import { FolderPreview } from './FolderPreview';

function node(partial: Partial<FolderPreviewNode> & { name: string }): FolderPreviewNode {
  return {
    path: partial.name,
    photos: 0,
    total: 0,
    children: [],
    more: 0,
    ...partial,
  };
}

function preview(partial: Partial<Preview> = {}): Preview {
  return {
    name: 'Photos',
    location: '/data/photos',
    photos: 0,
    skipped: 0,
    others: 0,
    folders: 0,
    truncated: false,
    tree: null,
    ...partial,
  };
}

const library = preview({
  photos: 1204,
  folders: 3,
  others: 12,
  tree: node({
    name: 'Photos',
    path: '',
    total: 1204,
    children: [
      node({
        name: '2019',
        path: '2019',
        total: 1200,
        children: [
          node({ name: 'summer', path: '2019/summer', photos: 1000, total: 1000 }),
          node({ name: 'winter', path: '2019/winter', photos: 200, total: 200 }),
        ],
      }),
      node({ name: '2020', path: '2020', photos: 4, total: 4 }),
    ],
  }),
});

describe('FolderPreview', () => {
  it('counts the photos and folders a scan would add', () => {
    render(<FolderPreview preview={library} />);
    const section = screen.getByRole('region', { name: 'What a scan would add' });
    expect(section).toHaveTextContent('1,204');
    expect(section).toHaveTextContent('Folders');
    expect(section).toHaveTextContent('Other files');
  });

  it('shows the tree with a count per folder', () => {
    const { container } = render(<FolderPreview preview={library} />);
    const summer = container.querySelector('[data-preview-node="2019/summer"]');
    expect(summer).toHaveTextContent('summer');
    expect(summer).toHaveTextContent('1,000');
    // A parent carries its subtree's total, so a collapsed folder still says
    // what is inside it.
    expect(container.querySelector('[data-preview-node="2019"]')).toHaveTextContent('1,200');
  });

  it('collapses and expands a folder', () => {
    const { container } = render(<FolderPreview preview={library} />);
    expect(container.querySelector('[data-preview-node="2019/summer"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide the folders in 2019' }));
    expect(container.querySelector('[data-preview-node="2019/summer"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show the folders in 2019' }));
    expect(container.querySelector('[data-preview-node="2019/summer"]')).toBeTruthy();
  });

  // The excludes are the half of a scan that removes photos, so the dry run
  // names the pattern responsible rather than leaving the folder out.
  it('names the exclude that skips a folder', () => {
    const { container } = render(
      <FolderPreview
        preview={preview({
          photos: 10,
          skipped: 40,
          folders: 1,
          tree: node({
            name: 'Photos',
            path: '',
            total: 50,
            children: [
              node({ name: 'keep', path: 'keep', photos: 10, total: 10 }),
              node({ name: 'RAW', path: 'RAW', photos: 40, total: 40, excluded: '^RAW' }),
            ],
          }),
        })}
      />,
    );
    const raw = container.querySelector('[data-preview-node="RAW"]');
    expect(raw).toHaveTextContent('skipped by ^RAW');
    expect(screen.getByText(/Skipped photos sit in folders/)).toBeTruthy();
    expect(container.querySelector('[data-preview-node="keep"]')).not.toHaveTextContent('skipped');
  });

  it('says when it stopped early and when children were left out', () => {
    render(
      <FolderPreview
        preview={preview({
          photos: 5,
          folders: 1,
          truncated: true,
          tree: node({ name: 'Photos', path: '', photos: 5, total: 5, more: 300 }),
        })}
      />,
    );
    expect(screen.getByText(/the real counts are higher/)).toBeTruthy();
    expect(screen.getByText('300 more folders')).toBeTruthy();
  });

  it('says plainly when there is nothing to add', () => {
    render(<FolderPreview preview={preview()} />);
    expect(screen.getByRole('status')).toHaveTextContent('No photos in this folder.');
  });
});
