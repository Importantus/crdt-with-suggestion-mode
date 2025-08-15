# Track Changes Collaborative Application

A TypeScript library for building collaborative editing applications with support for a review mode, based on the Collabs CRDT framework.

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

## Usage Example

```typescript
import { CRuntime } from "@collabs/collabs";
import { TrackChangesApplication } from "track-changes-application";

// Initialize a Collabs runtime
const runtime = new CRuntime();

// Register the collaborative application
const app = runtime.registerCollab(
  "app",
  (init) => new TrackChangesApplication(init, { userId: "user-123" })
);

// Create a new collaborative document
const docId = app.createDocument("example.md");
const document = app.documents.get(docId);

// Edit the document content with track changes
document?.content.insert(0, "Hello collaborative world!", true); // Insert as suggestion
document?.content.addComment(0, 5, "Please review this section");

// Accept or decline a suggestion
document?.content.acceptSuggestion(suggestionId);
document?.content.declineSuggestion(suggestionId);

// Access presence information
console.log(app.presence.get("user-123"))

## Development

- Build: `npm run build`
- Test: `npm test`
- Documentation: `npm run build:docs`
