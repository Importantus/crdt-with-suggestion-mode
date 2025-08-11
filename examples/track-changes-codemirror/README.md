# Track Changes Collaborative Application

A TypeScript library for building collaborative editing applications with suggestion-mode support, based on the Collabs CRDT framework.

## Overview

This library provides:
- **TrackChangesApplication**: The main class for managing collaborative documents and user presence.
- **TrackChangesDocument**: Represents a single collaborative document with suggestion-mode functionality.
- **PresenceState**: Interface for user presence and selection tracking.

Documents are managed in real time, with support for multiple users, live presence, and a suggestion mode.

## Main Classes

### TrackChangesApplication
- Manages multiple collaborative documents.
- Tracks user presence and selection.
- API:
  - `createDocument(fileName: string): DocumentID` — Creates a new document.
  - `removeDocument(id: DocumentID)` — Removes a document.
  - `documents` — Collaborative map of all documents.
  - `presence` — Collaborative presence information for all users.

### TrackChangesDocument
- Represents a collaborative document.
- Contains:
  - `id`: Unique document identifier.
  - `fileName`: Collaborative text field for the document name.
  - `content`: Collaborative content with track changes.

## Installation

Install via npm:

```bash
npm install track-changes-application
```

Peer dependencies:
- `@collabs/collabs`
- `track-changes-crdt`
- `uuid`

## Usage Example

// TODO: Add usage example here
```typescript

```

## Development

- Build: `npm run build`
- Test: `npm test`
- Documentation: `npm run build:docs`
