# Viewport-forced compact thumbs (ignore DPR)

Compact grids (year thumbs, Album page, covers) request `/api/thumb/{id}?size=256` when the viewport is at least 1280px wide, otherwise `size=512`, and do not use `srcset`. WHATWG lets the user agent pick any `srcset` candidate using density, so a ~140px desktop tile at 2× would often download 512 and keep a larger decoded bitmap; we trade a slightly softer retina tile for lower memory after indexing. Day and featured cards still use 1024; the viewer still loads the Original on open.
