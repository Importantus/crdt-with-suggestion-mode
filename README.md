# CRDTs with suggestion mode support

This monorepo contains libraries for building collaborative editing applications with suggestion (track changes) support, based on the Collabs CRDT framework.

## Suggestion Mode

The suggestion mode (similar to "Suggesting" in Google Docs) allows users to propose changes — such as insertions and deletions — without immediately applying them. Other collaborators can review, accept, or decline these suggestions in real time. All changes and decisions are synchronized across users using CRDTs.

## Packages

- **track-changes-crdt**: Implements the core logic for track changes, suggestions, and comments in collaborative text documents. Provides the CRDT data structure and API for modeling and managing suggestions, accepting/declining changes, and adding comments.
- **track-changes-application**: Builds on track-changes-crdt to provide higher-level collaborative application features like document management and user presence. Uses the CRDT logic from track-changes-crdt and adds real-time presence and multi-document support.

## Repository Structure

- `crdts/track-changes-crdt/` — Core track changes CRDT logic
- `crdts/track-changes-application/` — Collaborative application layer (presence, document management)

## Usage

See individual package READMEs for API details and usage examples.

## License

See individual packages for license information.