# Memries

A server-wide photo library: date-scroll browsing, named Albums, and thumbs from a disk cache rather than blobs in the catalog.

## Language

**Photo**:
An indexed still image. The library is server-wide, so a Photo has no owner: everyone signed in sees the same ones. `_key` is stable identity, kept across a scan when the storage path still matches; `hash` is the content fingerprint and may change when the file is rewritten.
_Avoid_: memory (UI copy only), file, original (that is the source bytes)

**Owner**:
The signed-in user an Album belongs to (`album.owner_id`). Photos have no owner. An **admin** (`MEMRIES_ADMIN_EMAILS`) is the Owner who may also manage Sources.

**Album**:
A named, owner-scoped set of Photos (`album_photos`). Any Photo in the library may go in any Album; the Album itself is owned.
_Avoid_: group, folder, collection

**Album page**:
The in-tab view of one Album’s Photos, reached by opening an Album card.
_Avoid_: album route, album URL

**Timeline Group**:
A date bucket of Photos (year / month / week / day) produced by `groupPhotos`.
_Avoid_: album, album page

**Thumb**:
A 256, 512, or 1024 JPEG in the cache; the catalog stores only the path.
_Avoid_: thumbnail URL as if it were pixels in the catalog, original

**Original**:
The source file on Storage, streamed by `/api/original/{id}` only in the photo viewer.
_Avoid_: full image from the catalog

**TakenAt**:
Capture clock used for Timeline Groups: EXIF `DateTimeOriginal` (then digitized / `DateTime`), else filesystem birth time, else mtime. The UI buckets on `taken_at_local`. See [docs/adr/0005-capture-time-stable-identity.md](docs/adr/0005-capture-time-stable-identity.md).

**Granularity**:
`year` / `month` / `week` / `day` for Timeline Groups.

**Source**:
An admin-managed folder — a path on the server or a WebDAV collection — whose media is indexed into the library. Server-wide, not per Owner. Mount a network share on the server and add it as a path. Originals stay there; Thumbs are made on local disk.
_Avoid_: library (that is every Photo on the server), album, mount

**Index run**:
A persisted scan of every Source that upserts Photos. There is one, because there is one library.
_Avoid_: vite catalog, import script (as the only start path), sync (that is folder Sync in [0005](docs/adr/0005-capture-time-stable-identity.md))

## Relationships

- The **library** holds every **Photo**; every Owner sees all of them
- An **Owner** owns many **Albums** and their own **favorites**; neither is visible to anyone else
- **Sources** are server-wide and added by an admin; the one **Index run** walks all of them
- An **Album** contains zero or more **Photos**; removing a Photo from an Album does not delete the Photo
- A **Timeline Group** is not an **Album**; it is a date bucket on the Memories tab
- A **Thumb** is derived from a **Photo**; an **Original** is the Photo’s source file

## Example dialogue

> **Dev:** "When I open an Album, is that a Timeline Group I can manage?"
> **Domain expert:** "No. The **Album page** shows Photos in that **Album**. A **Timeline Group** is only a date bucket on Memories. Long-press on the Album page unmembers the Photo; it stays in the library."

> **Dev:** "After indexing, do we load the Original from the catalog into the grid?"
> **Domain expert:** "The catalog never holds pixels. Grids request a **Thumb**. The **Original** loads only when the viewer opens."

> **Dev:** "Do I run an import script before opening the app?"
> **Domain expert:** "No. Login starts an **Index run** over that Owner’s Sources. The CLI is a fallback. A library already in the catalog counts as complete."

## Flagged ambiguities

- "group" was used for both a Timeline Group and an Album — resolved: Album is the named set; Timeline Group is the date bucket.
- "full image from the catalog" — resolved: metadata lives in the catalog; bytes come from the cache (Thumb) or Storage (Original).
- "sync" vs **Index run** — resolved: Sync is path/identity refresh ([0005](docs/adr/0005-capture-time-stable-identity.md)); an Index run is the job the splash starts.
