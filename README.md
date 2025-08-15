# Review Mode for Raw Text Editing

This monorepo contains libraries and a research prototype for building real-time collaborative applications featuring "Review Mode" functionality, specifically designed for raw text formats (such as Markdown, LaTeX, or source code). The core logic is implemented as a custom CRDT built on top of the Collabs framework.

This project is an academic prototype developed as part of my bachelor's thesis. It serves as a proof of concept for the proposed CRDT architecture for handling review mode in raw text.
While functional for demonstration purposes, it is not production-ready and has not been extensively tested. Handling of some concurrent edge cases may not yet align with intuitive user expectations. Feedback, bug reports, and contributions to improve robustness are encouraged!

## What is "Review Mode"?

Review mode (often called "Suggestion Mode" or "Track Changes") allows users to review text documents and manage revisions asynchronously. Instead of applying edits directly to a document, this mode captures them as distinct proposals.

- **Proposing Edits:** When a user edits the text, their changes are visually marked.
- **Reviewing:** Collaborators can review each proposal individually.
- **Accepting & Rejecting:** Each proposal can be accepted, which integrates the change into the main document, or rejected, which discards the change.

The goal of this library is to implement this process - proposing, reviewing, and resolving changes - using [Conflict-free Replicated Data Types (CRDT)](https://crdt.tech/).
This presents some challenges:

- Markup-based approaches are not conflict-free. Simply inserting markup characters (e.g., `{--deleted--}`) into a standard text CRDT can lead to invalid states when concurrent edits interleave the markup tags.
- Generic JSON CRDTs are insufficient. Modeling text as a list of objects can cause segment duplication and loss of user intent when concurrent operations split the same text segment differently.

The approach explored in this project aims to solve these problems by implementing a CRDT structure that decouples the text content from the suggestion metadata.

## Technical Approach

The core of this library is a custom CRDT that manages annotations separately from the text.

It consists of two main parts:

- **Text CRDT:** A standard text CRDT (`CValueList` from Collabs) manages the sequence of characters.
- **Annotation Layer CRDT:** A separate CRDT manages the metadata for suggestions and comments. These annotations are anchored to stable character identifiers within the text CRDT.

## Packages in this Monorepo

This repository is structured as a monorepo containing the following packages:

- `track-changes-crdt`: The core CRDT implementation. Provides the low-level data structures and logic for managing text and conflict-free annotations (suggestions & comments).
- `track-changes-application`: A higher-level library for demonstrating how to build full applications. It adds document management and user presence on top of the core CRDT.
- `track-changes-codemirror`: A binding that integrates the `track-changes-crdt` logic into the CodeMirror 6 editor, providing UI for suggestions, comments, and cursors.
- `text-editor` (Demo): An example application demonstrating how to use all the libraries together to create a collaborative raw text editor.

## Getting Started

**Prerequisites**

- Node.js (v18 or later)
- npm (for managing the monorepo workspaces)

### Development Setup

Clone the repository:

```bash
git clone https://github.com/your-username/your-repository.git
cd your-repository
```

Install all dependencies:

```bash
npm install
```

Build the packages:

```bash
npm run build
```

Run the example text editor:

```bash
cd examples/text-editor
npm run dev
```

This will launch the demo application, typically at http://localhost:5173. You can open multiple browser tabs to simulate a collaborative session.

# Usage

For detailed information on how to use each library, please refer to the README.md file within each package's directory:

- packages/track-changes-crdt/README.md
- packages/track-changes-application/README.md
- packages/track-changes-codemirror/README.md