import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { FolderPreview as Preview, FolderPreviewNode } from '../models/source';
import { ChevronDownIcon, ChevronRightIcon, FoldersIcon } from './icons';

/**
 * Levels open on arrival. The top two answer "did I pick the right folder",
 * which is the question a dry run is for; deeper is browsing, and browsing is
 * a click away.
 */
const OPEN_DEPTH = 2;

/** One step of indentation, in pixels. */
const INDENT = 14;

/**
 * The result of a dry run: the folder tree a scan would add, and how many
 * photos sit in each folder (ADR 0027).
 *
 * The counts are a summary rather than a sentence because every number here
 * is plural in a different way in a different language, and three stats read
 * faster than a clause that has to agree with all of them.
 */
export function FolderPreview({ preview }: { preview: Preview }) {
  const { t, intl } = useI18n();
  const num = (value: number) => new Intl.NumberFormat(intl).format(value);

  return (
    <section
      data-folder-preview
      aria-labelledby="folder-preview-title"
      className="grid gap-3 rounded-xl bg-cream p-4 ring-1 ring-plum/10"
    >
      <h3 id="folder-preview-title" className="text-sm font-medium text-plum">
        {t('folders.previewTitle')}
      </h3>

      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        <Stat label={t('folders.previewPhotosLabel')} value={num(preview.photos)} strong />
        <Stat label={t('folders.previewFoldersLabel')} value={num(preview.folders)} />
        {preview.skipped > 0 && (
          <Stat label={t('folders.previewSkippedLabel')} value={num(preview.skipped)} />
        )}
        {preview.others > 0 && (
          <Stat label={t('folders.previewOthersLabel')} value={num(preview.others)} />
        )}
      </dl>

      {preview.truncated && <p className="text-xs text-ink">{t('folders.previewTruncated')}</p>}
      {preview.skipped > 0 && <p className="text-xs text-ink">{t('folders.previewSkippedNote')}</p>}

      {preview.photos === 0 && preview.skipped === 0 ? (
        <p className="text-sm text-plum" role="status">
          {t('folders.previewEmpty')}
        </p>
      ) : (
        preview.tree && (
          <ul className="m-0 grid list-none gap-0.5 p-0">
            <Row node={preview.tree} depth={0} />
          </ul>
        )
      )}
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink">{label}</dt>
      <dd
        className={`m-0 tabular-nums ${strong ? 'text-lg font-semibold text-plum' : 'text-lg text-plum/80'}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Row({ node, depth }: { node: FolderPreviewNode; depth: number }) {
  const { t, intl } = useI18n();
  const [open, setOpen] = useState(depth < OPEN_DEPTH);
  const num = (value: number) => new Intl.NumberFormat(intl).format(value);
  // `more` counts children the server left out to stay within its bound. A
  // folder can have all of them dropped, so the row must still open to say so.
  const expandable = node.children.length > 0 || node.more > 0;
  const excluded = node.excluded !== undefined;

  return (
    <li data-preview-node={node.path}>
      <div
        className="flex min-h-8 items-center gap-1.5 rounded-lg pr-2 hover:bg-surface/60"
        style={{ paddingLeft: depth * INDENT }}
      >
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            aria-label={t(open ? 'folders.previewCollapse' : 'folders.previewExpand', {
              name: node.name,
            })}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink hover:text-plum"
          >
            {open ? (
              <ChevronDownIcon className="h-3.5 w-3.5" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="grid h-6 w-6 shrink-0 place-items-center text-plum/40">
            <FoldersIcon className="h-3.5 w-3.5" />
          </span>
        )}

        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            excluded ? 'text-ink line-through' : 'text-plum'
          }`}
          title={node.path || node.name}
        >
          {node.name}
        </span>

        {excluded && (
          <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] text-ink">
            {t('folders.previewExcludedBy', { pattern: node.excluded ?? '' })}
          </span>
        )}

        {/* The subtree's count, so a collapsed folder still says what is in
            it. The direct count is the title, which is the detail you only
            want once the number itself surprises you. */}
        <span
          className={`shrink-0 tabular-nums text-xs ${excluded ? 'text-ink/60' : 'text-ink'}`}
          title={t('folders.previewDirect', { count: node.photos })}
        >
          {num(node.total)}
        </span>
      </div>

      {open && expandable && (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {node.children.map((child) => (
            <Row key={child.path} node={child} depth={depth + 1} />
          ))}
          {node.more > 0 && (
            <li
              className="py-1 text-xs text-ink"
              style={{ paddingLeft: (depth + 1) * INDENT + 30 }}
            >
              {t('folders.previewMore', { count: node.more })}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
