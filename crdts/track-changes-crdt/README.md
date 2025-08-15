# Track Changes CRDT

A collaborative data structure (CRDT) that implements a review mode in text documents. Built on top of the [Collabs](https://collabs.readthedocs.io/) framework, this library.

## Getting Started

### Installation

```bash
npm install
```

### Basic Usage

```typescript
import { CRuntime } from "@collabs/collabs";
import { TrackChanges } from "track-changes-crdt";

// Initialize a Collabs document
const doc = new CRuntime();
const trackChanges = doc.registerCollab(
  "trackChanges",
  (init) => new TrackChanges(init, { userId: "user-123" })
);

// Insert text as a suggestion
trackChanges.insert(0, "Hello world", true);

// Suggest deletion
trackChanges.delete(6, 5, true);

// Add a comment
trackChanges.addComment(0, 5, "Check this intro");

// Accept or decline suggestions
trackChanges.acceptSuggestion(suggestionId);
trackChanges.declineSuggestion(suggestionId);

// Get the current plain text
console.log(trackChanges.toString());
```

For collaborative and persistent usage, connect Collabs to network and storage providers such as `WebSocketNetwork`, `TabSyncNetwork`, and `IndexedDBDocStore`. See the [Collabs documentation](https://collabs.readthedocs.io/en/latest/getting_started.html) for details.

## API Reference

Build the [API documentation](./docs) for detailed information on available methods and types.

## Development

- Build: `npm run build`
- Documentation: `npm run build:docs`

## Contributing

Contributions, bug reports, and suggestions are welcome! Please open an issue or submit a pull request.
