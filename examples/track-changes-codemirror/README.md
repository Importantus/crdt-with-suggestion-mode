# Track Changes CodeMirror Binding Example

This example library demonstrates how to implement the track changes crdt in a CodeMirror editor, allowing for collaborative editing with suggestion mode.

## Features

- **Remote Cursors**: Displays cursors of other users in real-time.
- **Collaborative Editing**: Users can edit text collaboratively, with changes tracked and displayed.
- **Display Annotations**: Highlights annotations for changes and comments made by other users.

## Setup

To use the Track Changes CodeMirror Binding in your project, follow these steps:

1. **Install Dependencies**
   > Note: `track-changes-codemirror` and `track-changes-application` are currently not available on npm. You will need to clone the repository and build them locally.

   Make sure you have the required packages installed:

   ```bash
   npm install @codemirror/state @codemirror/view track-changes-codemirror track-changes-application @collabs/collabs
   ```

2. **Initialize Collaboration Runtime and Application**

   Set up the collabs runtime and main application instance.

   ```typescript
   import { CRuntime } from '@collabs/collabs';
   import { TrackChangesApplication } from 'track-changes-application';

   const runtime = new CRuntime();
   const userId = 'your-user-id'; // Generate or assign a unique user ID
   const app = runtime.registerCollab('app', (init) => new TrackChangesApplication(init, userId));
   ```

3. **Create or Select a Collaborative Document**

   Use the application instance to create or select a document for editing.

   ```typescript
   // Create a new document
   const docId = app.createDocument('MyDocument.txt');
   const doc = app.documents.get(docId);

   // Or select an existing document
   // const doc = app.documents.get(existingDocId);
   ```

4. **Set Up Presence (Optional)**

   If you want to display remote cursors and selections, use the application's presence system.

   ```typescript
   // Connect presence tracking
   app.presence.connect();
   ```

5. **Configure Track Changes API**

   Instantiate the `TrackChangesAPI` with your document and presence information.

   ```typescript
   import { TrackChangesAPI } from 'track-changes-codemirror';

   const api = new TrackChangesAPI({
     doc,
     userId,
     presence: app.presence
   });
   ```

6. **Create the CodeMirror Editor**

   Set up the CodeMirror editor with the required extensions, including those from the Track Changes API.

   ```typescript
   import { EditorState } from '@codemirror/state';
   import { EditorView } from '@codemirror/view';

   const state = EditorState.create({
     doc: doc.content.toString(),
     extensions: [
       ...api.getExtensions(),
       // Add any additional CodeMirror extensions here
     ]
   });

   const view = new EditorView({
     state,
     parent: document.getElementById('editor')
   });
   ```

## Example

Here's a complete example of setting up the Track Changes CodeMirror Binding:

```typescript
import { CRuntime } from '@collabs/collabs';
import { TrackChangesApplication } from 'track-changes-application';
import { TrackChangesAPI } from 'track-changes-codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// Initialize collaboration runtime
const runtime = new CRuntime();
const userId = 'your-user-id';
const app = runtime.registerCollab('app', (init) => new TrackChangesApplication(init, userId));

// Create or select a document
const docId = app.createDocument('MyDocument.txt');
const doc = app.documents.get(docId);

// Set up presence (optional)
app.presence.connect();

// Configure Track Changes API
const api = new TrackChangesAPI({
  doc,
  userId,
  presence: app.presence
});

// Create the CodeMirror editor
const state = EditorState.create({
  doc: doc.content.toString(),
  extensions: [
    ...api.getExtensions(),
    // Add any additional CodeMirror extensions here
  ]
});

const view = new EditorView({
  state,
  parent: document.getElementById('editor')
});

// Clean up on disconnect
window.addEventListener('beforeunload', () => {
  view.destroy();
  app.presence.disconnect();
  runtime.destroy();
});
```

