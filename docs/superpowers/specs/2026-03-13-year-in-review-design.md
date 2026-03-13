# Year In Review — Design Spec

**Date:** 2026-03-13
**Status:** Approved

## Overview

Add a "Year In Review" tab to the PM Command Center dashboard. The tab lets the user document photos and notes/wins for each month of the current calendar year.

## Layout

- A vertical accordion list of all 12 months (January through December)
- Each month row shows name + a summary ("No entries yet" or "N images · notes added")
- Clicking a row expands it; clicking again collapses it (one open at a time or multiple — keep it simple, allow multiple open)
- The year displayed is always the current year (no year switcher)

## Expanded Month Content

Each expanded month contains two sections:

1. **Photos** — Uploaded image thumbnails displayed in a wrapping flex row. An "+ Add" dashed button opens a file picker. Images can be removed via a delete control on hover.
2. **Notes & Wins** — A free-form textarea for documenting achievements, reflections, or anything notable.

A **Save** button commits the notes text. Images are saved immediately on upload.

## Data Storage

- **Notes text** — stored in localStorage under the existing `pmData` key, in a new `yearInReview` field: `{ "2026": { "1": { notes: "..." }, ... } }`
- **Images** — stored in IndexedDB (database: `pmYearInReview`, object store: `images`). Each record keyed by `"YYYY-MM-index"`. Thumbnails rendered via `createObjectURL` or stored as blob.

## Architecture

- New `YearInReview` component added to `App.jsx` (consistent with existing tab components)
- Small `imageDb.js` helper module encapsulates all IndexedDB operations: `saveImage`, `getImages`, `deleteImage`
- `App.jsx` state gains a `yearInReview` key with the same shape as other data sections
- Tab added to `SECTIONS` array: `["Today", "Tasks", "1:1 Agenda", "Roadmap Queue", "Recurring", "Notes", "Year In Review"]`

## Styling

Follows existing app conventions: same font, color palette, card/border styles. Month header uses a blue highlight (`#eff6ff` / `#1e40af`) when expanded, matching the mockup.
