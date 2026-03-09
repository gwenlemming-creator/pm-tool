# Download All — Design

**Date:** 2026-03-09

## Overview

Add a "Download All" button to the PM Command Center that exports all dashboard data as a single `.xlsx` file with one sheet per section.

## Dependency

Add `xlsx` (SheetJS community edition) via `npm install xlsx` in `app/`.

## Export Function

A new `exportAllXLSX(data)` function in `App.jsx`:
1. Builds 5 worksheets from the app's `data` state object
2. Packages them into a single workbook
3. Triggers browser download as `pm-dashboard.xlsx`

## Sheet Columns

| Sheet | Columns |
|---|---|
| Tasks | Title, Priority, Due Date, Done, Notes |
| 1:1 Agenda | Item, Discussed |
| Roadmap Queue | Item, Notes, Target Month, Added to Roadmap, Captured On |
| Recurring | Task, Frequency, Last Done |
| Notes | Title, Body, Created At |

## UI

A single **"Download All"** button in the app header (top-right), styled consistently with the existing UI. Clicking it calls `exportAllXLSX(data)`.

## Out of Scope

- Cell styling / formatting in the xlsx
- Selective section export
- Import / restore from xlsx
