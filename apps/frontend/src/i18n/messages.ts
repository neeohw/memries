/**
 * Interface copy, English first (ADR 0021).
 *
 * `en` is the source of truth and its shape is the `Messages` type, so a key
 * added here and forgotten in `nl.ts` is a compile error rather than an
 * English word appearing mid-sentence in a Dutch interface.
 *
 * Placeholders are `{named}`. A message that varies by count has `.one` and
 * `.other` forms chosen through `Intl.PluralRules`, because "1 photos" is the
 * kind of thing nobody notices until a reader does.
 */
export const en = {
  app: {
    name: 'Memries',
    signOut: 'Sign out',
    loading: 'Loading',
    unreachableTitle: 'We could not reach the server',
    unreachableBody: 'Check that Memries is running, then retry.',
    retry: 'Try again',
  },
  nav: {
    main: 'Main',
    memories: 'Memories',
    albums: 'Albums',
    favorites: 'Favorites',
    folders: 'Folders',
  },
  timeline: {
    scanFolder: 'Scan your folder',
    scanning: 'Scanning your folder…',
    heading: 'Your memries',
    empty: 'No memories here yet.',
    loadingMore: 'Loading more memories…',
    backToToday: 'Back to today',
    currentPeriod: 'Current period',
    filter: 'Filter',
    syncFolder: 'Sync folder',
    syncing: 'Syncing…',
    jumpToDate: 'Jump to date',
    zoomGroup: 'Timeline zoom',
    zoomIn: 'Zoom in, group by a shorter period',
    zoomOut: 'Zoom out, group by a longer period',
    zoomInTitle: 'Zoom in (Ctrl + scroll)',
    zoomOutTitle: 'Zoom out (Ctrl + scroll)',
    groupedBy: 'Grouped by {level}',
    zoomInTo: 'Zoom in to {nouns}',
    level: {
      year: 'Year',
      month: 'Month',
      week: 'Week',
    },
    levelPlural: {
      year: 'years',
      month: 'months',
      week: 'weeks',
    },
  },
  photo: {
    open: 'Open photo, {when}',
    openFavorited: 'Open favorited photo, {when}',
    select: 'Select photo, {when}',
    deselect: 'Deselect photo, {when}',
    favorited: 'favorited',
    previous: 'Previous photo',
    next: 'Next photo',
    close: 'Close photo',
    actions: 'Photo actions',
    fallbackName: 'Photo',
  },
  selection: {
    count: {
      one: '{count} selected',
      other: '{count} selected',
    },
    toolbar: 'Selected photos',
    clear: 'Clear selection',
    addToFavorites: 'Add to favorites',
    removeFromFavorites: 'Remove from favorites',
    addToAlbum: 'Add to album',
    newAlbum: 'New album',
    newAlbumName: 'New album name',
    create: 'Create',
    albumOfPhotos: {
      one: 'Album of {count} photo',
      other: 'Album of {count} photos',
    },
  },
  albums: {
    heading: 'Albums',
    fallbackName: 'Album',
    empty: 'No albums yet.',
    newAlbum: 'New album',
    name: 'Album name',
    namePlaceholder: 'Family photos',
    create: 'Create',
    cancel: 'Cancel',
    creating: 'Creating album…',
    backToAlbums: 'Back to albums',
    emptyAlbum: 'No photos in this album yet.',
    photoCount: {
      one: '{count} photo',
      other: '{count} photos',
    },
    open: 'Open album {name}, {count}',
    select: 'Select album {name}',
    deselect: 'Deselect album {name}',
    selectWithCount: 'Select album {name}, {count}',
    deselectWithCount: 'Deselect album {name}, {count}',
    toolbar: 'Selected albums',
    deleteCount: {
      one: 'Delete {count} album',
      other: 'Delete {count} albums',
    },
    removeFromAlbum: 'Remove from album',
  },
  favorites: {
    heading: 'Favorites',
    emptyTitle: 'Nothing favorited yet',
    emptyBody:
      'Tap the heart on a photo you love and it will gather here, like a little private album.',
    count: {
      one: '{count} memory',
      other: '{count} memories',
    },
  },
  signIn: {
    heading: 'Sign in',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    failed: 'Invalid login or password.',
  },
  indexing: {
    opening: 'Opening your album…',
    heading: 'Indexing your files',
    progress: 'Indexing progress',
    unreachable: 'We could not reach the library.',
    retry: 'Try again',
    retrying: 'Retrying…',
  },
  folders: {
    heading: 'Folders',
    add: 'Add folder',
    connect: 'Connect folder',
    cancel: 'Cancel',
    edit: 'Edit',
    remove: 'Remove',
    removeConfirm: 'Remove and hide its photos',
    removing: 'Removing…',
    scanNow: 'Scan now',
    editNamed: 'Edit {name}',
    checking: 'Checking connection…',
    save: 'Save',
    scanning: 'Scanning…',
    empty: 'No photo folders are connected yet.',
    name: 'Name',
    optional: '(optional)',
    namePlaceholder: 'Family photos',
    username: 'Username',
    password: 'Password',
    passwordKeep: 'Leave blank to keep',
    signedInAs: 'Signed in as {username}',
    typeLocal: 'On this server',
    typeWebdav: 'WebDAV',
    labelLocal: 'Server folder',
    labelWebdav: 'WebDAV',
    locationLocal: 'Folder path',
    locationWebdav: 'URL',
    hintLocal:
      'An absolute path the server can read, inside an allowed folder. Mount a network share on the server first, then add it here.',
    hintWebdav: 'Nextcloud, ownCloud, Synology, or any WebDAV server.',
    excludeTitle: 'Skip folders',
    excludeHelp:
      "Regular expressions, matched against each folder's path inside this source. A matching folder is never read, and photos already indexed from it leave the library on the next scan.",
    excludeAdd: 'Add',
    excludeField: 'Pattern to skip',
    excludeStop: 'Stop skipping {pattern}',
    excludeInvalid: 'That is not a valid expression.',
    excludeDuplicate: 'That pattern is already in the list.',
  },
  settings: {
    heading: 'Server settings',
    open: 'Server settings',
    thumbnailsTitle: 'Thumbnail folder',
    thumbnailsHelp:
      'Where the generated thumbnails are written. Point this at external storage to keep them off the system card.',
    thumbnailsLabel: 'Folder on the server',
    current: 'Now using',
    usingDefault: 'the install default',
    allowedRoots: 'Must sit under: {roots}',
    freeSpace: '{size} free',
    save: 'Save folder',
    saving: 'Saving…',
    reset: 'Back to the default',
    movedTitle: 'Thumbnails moved',
    movedBody:
      'Existing thumbnails stayed in the old folder. Scan a folder to generate them again in the new one.',
  },
  account: {
    heading: 'Account',
    open: 'Account settings',
    signedInAs: 'Signed in as',
    languageTitle: 'Language',
    languageHelp: 'Dates and times follow the language you choose here.',
    appearanceTitle: 'Appearance',
    signOutTitle: 'Session',
  },
  language: {
    label: 'Language',
    systemShort: 'Auto',
    system: 'Match my browser',
    en: 'English',
    nl: 'Nederlands',
  },
  errors: {
    generic: 'Something went wrong.',
  },
} as const;

/**
 * The shape of a catalogue: English's keys, with the values widened to
 * `string`.
 *
 * `as const` above freezes each value to its own literal type, which is what
 * makes a missing key an error — but without widening here, Dutch could only
 * ever repeat the English words.
 */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

export type Messages = Widen<typeof en>;
