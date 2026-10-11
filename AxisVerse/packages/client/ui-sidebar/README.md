---
description: "AxisVerse top navigation: branding, new questions, history drawer and course materials."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar

English | [中文](README.zh.md)

## Summary

Users can start sessions, browse learning history, and view or download uploaded course PDFs from the top navigation. Question cards appear in an on-demand drawer without a persistent left rail. New Session uses an explicitly selected Workspace, then the current Session's Workspace, then the most recently active Workspace; if none exists, it opens a blank New Session page. Independent slots allow replacement of the brand mark and name.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The top navigation displays the brand, new-question action, history and course materials. The material dialog loads metadata from the authenticated `/api/axisverse/materials` host; downloads use that host for remote PDFs and saved local originals. Cards order actions as Ask from material, Summarize material, Download, and Delete; Ask uses filled blue and the others use outlines. Blue `Processing…` and actual completed-page counts identify ongoing work. Originals remain downloadable during processing or after indexing fails; Ask and Summarize stay disabled until text is searchable, and unknown page counts are omitted. Delete requires confirmation and removes the entry from this installation's library, retaining the PDF; the completion notice provides Undo. Failed removal or restoration remains retryable. Upload receipts and local storage authorize documents instead of listing every shared-library document. Loading failures provide retry; closing cancels reads and restores focus. The settings slot remains declared for administrative compositions but is not rendered in student navigation.

### Brand and New Session

Each uploaded document offers material questions and a section summary. Material questions return to the homepage with a removable document label. Summary selection reads original section titles through the authenticated outline route, then starts a conversation for the selected headings. Select all and Clear all apply to the complete heading list; an empty selection disables summary generation. Failed reads remain retryable; missing headings are not fabricated. The new-question action clears material selection in the resolved blank session.

The brand row renders independent `sidebar.brand.mark` and `sidebar.brand.name` single slots. Without occupants, it shows the book-and-spark mark and AxisVerse · 一纸宇宙. The brand and new-question buttons call the same session-start action.

### History and global panels

The history drawer displays searchable question cards and review bookmarks, without Workspace names or directory controls. The close button, backdrop, and Escape close the drawer; Escape returns focus to the history entry. Starting a session also closes the drawer. Drawer content stays mounted while closed.

Plugins register labeled entries in the root-scoped `sidebar.panellist` list. The same id addresses a panel in the `main` keyed slot; selecting an absent panel throws and preserves selection. Student navigation omits global-panel buttons, including Plugins; panel registrations remain available to administrative integrations. This package does not change panel or Session storage.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shell is pure composition: `SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the declared brand, the `sidebar.workspaces` and `sidebar.settings` child slots, and injected navigation callbacks. Panel entries and their optional titles use the same composition path. Panel metadata is derived from list registrations and locale changes; selection belongs to the layout store.

### Slot discipline

Declaration-aware `slots.inject()` allows replacing packages to activate before or after navigation. `AxisNavigation` renders the Workspace seat with `wide: true` and footer actions with `wide: false`. The `/client` exports the plugin entry and contract types; presentation components remain package-internal.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the surfaces that fill the shell's seats and the composition model.

- [ui-workspace](../ui-workspace/README.md) — the Workspace and Session browser rendered into `sidebar.workspaces`.
- [ui-settings](../ui-settings/README.md) — the settings domain base registering the trigger row at `sidebar.settings`.
- [ui-layout](../ui-layout/README.md) — the frame containing navigation and main content.
- [ui-theme](../ui-theme/README.md) — navigation color and elevation tokens.
- [Slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the composition model behind the seats.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the shell owns versus what its occupants own; they are current package constraints.

- **Session state-dot rendering is owned by ui-workspace** — no done/error notification sources are available to this shell.
- **Workspace browser behavior is composition-owned** — grouping, ordering, search, and row state belong to ui-workspace, not this shell.
- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Panel metadata is a read-only presentation projection of the Slot registry and locale, with no independent write API. The registry owns entry identity and disposal; this package's assembly tests assert the projection after registration and locale notifications settle. The shell owns no separate navigation state to reconcile with those sources.

A split book appears as one original-name card with the complete PDF page count. Questions and summaries become available only after all parts are searchable; downloads return the complete original. Outline pages refer to the original PDF.
