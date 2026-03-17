# Product Requirements Document: PM Command Center

**Author:** Gwen Lemming
**Date:** March 2026
**Version:** 1.2
**Status:** Live

---

## Overview

A tool for a PM to keep track of all the moving parts of their job. Tasks, roadmap, recurring work, notes, and more — all in one place, accessible from any device.

## Problem Statement

There are too many places to look to review data and bring it all together to figure out what the focus of the day is.

---

## Sections

- **Today** — aggregates overdue tasks, items due this week, and recurring tasks due today, plus upcoming roadmap preview
- **Tasks** — grouped by priority (High/Medium/Low) with due dates, notes, editing
- **1:1 Agenda** — items to discuss with a manager, toggled as "discussed"
- **Roadmap Queue** — ideas/features grouped by target month, exportable to CSV
- **Recurring** — tasks tracked by last-done date (Daily/Weekly/Biweekly/Monthly)
- **Notes** — free-form notes with title/body, searchable, masonry grid layout
- **Year In Review** — monthly notes for end-of-year reflection

---

## Deployment

- **Hosting:** GitHub Pages at `https://gwenlemming-creator.github.io/pm-tool/`
- **CI/CD:** GitHub Actions — auto-deploys on every push to `main`
- **Tech Stack:** React 18, Vite, Firebase v10

---

## Data & Sync

- **Primary storage:** Firebase Realtime Database (real-time sync across all devices)
- **Auth:** Google Sign-In (personal Gmail account)
- **Fallback:** localStorage (used when signed out)
- **First sign-in migration:** existing localStorage data is automatically uploaded to Firebase
- **Security:** Firebase Rules restrict data to authenticated user only (`/users/{uid}/`)

---

## Data Export / Backup

- **Download All** — exports all data to `.xlsx` (Excel)
- **Export JSON** — exports raw data as `.json` for backup/restore
- **Import JSON** — imports a previously exported `.json` file to restore data on any device

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Mar 2026 | MVP — all sections, localStorage persistence |
| 1.1 | Mar 2026 | GitHub Pages deployment, Download All (XLSX), JSON export/import |
| 1.2 | Mar 2026 | Firebase real-time sync, Google sign-in, Year In Review tab |
