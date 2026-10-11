---
description: "AxisVerse learning records: question cards, topic search, review bookmarks, title edits and reversible removal."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace

English | [中文](README.zh.md)

## Summary

Users can revisit questions, search titles and topic hints, mark records for review, rename them, and remove them with an undo action. Learning records omit Workspace names, directory paths, blank sessions, and delegated sessions. The conversation picker remains available to compositions that need Workspace selection.

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

Open **Learning records** in the top navigation. Cards show the stored question title, a topic hint inferred from that title, the latest user-activity time, and a review bookmark. Clicking the question opens its existing conversation and closes the drawer. Records appear newest first within To review, Today, Last 7 days, or Earlier; review records appear only in their own group.

**All** and **To review** filter the cards. Search matches title and localized topic text, ignoring case and surrounding whitespace. It does not search message bodies or Workspace names. Blank and archived Sessions never appear.

The star toggles a review bookmark stored in the current browser origin. It survives reloads but is not an account-synchronized learning assessment. Edit title writes through the Session service; failed writes leave a retryable dialog with a student-facing message. **Delete record** asks for confirmation and archives the Session without erasing its contents. The latest removal can be undone in the drawer; archived-session settings also retain their restore action.

The conversation Workspace picker can adopt a directory when a directory-flow provider is composed. It preserves the Host-owned Workspace and Session navigation behavior.

The session-start operation accepts an optional preparation callback for the resolved blank Session before navigation. It returns navigation completion and rejects on failure; superseded navigation does not run the callback.

-----

`ctx.uiWorkspace.openSession(target)` synchronously replaces the owned `mainView` reference and returns the main area to Conversation without waiting for `reference.ready`, so history loading renders inside the selected Session view. The target may be a known Session id or a durable direct-parent subagent address; an explicit address does not require a preloaded parent catalog. `openWorkspace(id, beforeOpen?)` and `forkSession(id)` open their result only if no later navigation has superseded the request; New Session uses `openWorkspace`. The optional synchronous preparation callback runs after the target is retained and only for a current Workspace request, so superseded requests do not move composer drafts. Navigation or owner disposal suppresses the late UI commit, not the underlying Session creation. Archiving the main Session releases its reference and clears the main selection. Selection failure leaves a global panel visible. Session rows read `usePanelInfo` to suppress their selected appearance while a global panel is active; search and directory-picker focus alone do not leave that panel.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`StudyHistory` fills `sidebar.workspaces` using framework-provided Session and archive snapshots. The registered store owns only browser-local review bookmarks under `axisverse.study-history.v1`; conversation titles and archive membership remain Host-owned. Topic hints are deterministic title matches, not retrieved textbook metadata or model-assessed mastery. Calendar groups use the browser timezone and refresh once per minute.

`WorkspacePicker` fills `conversation.hero.workspace` and declares its directory-flow child. The student history entry declares no directory picker. Slot injection follows each owner's declaration lifetime. Generic Workspace browser helpers remain package-internal and are not mounted in student history.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the sidebar host, the hero surface, and the picking backends.

- [ui-sidebar](../ui-sidebar/README.md) — the sidebar shell hosting the `sidebar.workspaces` hole.
- [ui-conversation](../ui-conversation/README.md) — the chat surface hosting the Session Intent hero's picker hole.
- [directory-picker-native](../../host/directory-picker-native/README.md) — the OS-chooser backend filling the directory-flow hole.
- [Workspace Controller](../../api/workspace-controller/README.md) — the Host mutations and framework-neutral Client projection that own Workspaces, membership, and Workspace group order.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Review bookmarks are local to this browser and origin; clearing site data removes them. Each record represents one conversation, not each question within a multi-question conversation. Topic hints depend on the title and can be incomplete. Student submissions, verified source references, account synchronization, and student-confirmed mastery are deferred. Removal archives the conversation rather than permanently deleting it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This is a pure-consumer plugin that registers presentational components into two host-declared slots and registers its locale dictionaries; its inject face consists of stateless RPC wrappers plus a create-and-open call. It emits no Cordis events and owns no cross-plugin mutable state.
