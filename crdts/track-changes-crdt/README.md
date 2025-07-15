# Track Changes CRDT for Collabs

This library provides a collaborative data structure (CRDT) for tracking changes and suggestions in text documents, built on top of the [Collabs](https://collabs.readthedocs.io/) framework. It enables real-time collaborative editing with support for suggestions, comments, and change tracking, suitable for applications like document editors.

## Features

- **Track Changes**: Model insertions, deletions, and formatting changes as suggestions.
- **Suggestions**: Propose, accept, or decline changes to the document collaboratively.
- **Comments**: Add and remove comments on text ranges.
- **CRDT-based**: Ensures consistency and conflict-free merging across distributed replicas.
- **TypeScript API**: Strongly typed interfaces for integration and extension.

## Usage

Create a new instance:

// TODO: Add usage example here
```typescript

```

Apply edits and suggestions:

```typescript
trackChanges.insert(0, "Hello world", true); // Insert with suggestion
trackChanges.delete(6, 5, true); // Suggest deletion
trackChanges.addComment(0, 5, "Check this intro");
```

Accept or decline suggestions:

```typescript
trackChanges.acceptSuggestion(index, suggestionId);
trackChanges.declineSuggestion(index, suggestionId);
```

## Development

- Build: `npm run build`
- Test: `npm test`
- Documentation: `npm run build:docs`
