import { CMap, CObject, CPresence, Cursor, InitToken } from "@collabs/collabs";
import { v6 as uuid } from "uuid";
import { DocumentID, TrackChangesDocument } from "./c_document";

/**
 * Represents the presence state of a user in the collaborative editing session.
 * Includes user identification, activity status, and current selection/cursor position.
 */
export interface PresenceState {
  /**
   * Unique identifier for the user. Can be used for user lookup or attribution.
   */
  userId: string;
  /**
   * Indicates whether the user is actively viewing or editing the
   * document. If false, e.g. the browsertab is in the background
   */
  viewing: boolean;
  /**
   * The user's current selection or cursor position in a document.
   * If anchor and head differ, a text range is selected; otherwise, a single cursor position.
   * Null if no selection is present.
   */
  selection: { document: DocumentID; anchor: Cursor; head: Cursor } | null;
}

/**
 * Main application class for collaborative editing with track changes support.
 * Manages multiple documents and user presence information.
 *
 * Usage:
 *   - Instantiate with a unique userId per client.
 *   - Use createDocument to add new collaborative documents.
 *   - Use removeDocument to delete documents from the session.
 *   - Access presence to update or read user activity and selection.
 */
export class TrackChangesApplication extends CObject {
  /** Unique identifier for the current user instance. */
  readonly userId: string;

  /** Presence information for all users in the session. */
  readonly presence: CPresence<PresenceState>;
  /** Collaborative map of all documents, indexed by DocumentID. */
  readonly documents: CMap<DocumentID, TrackChangesDocument, []>;

  /**
   * Constructs a new TrackChangesApplication instance.
   * @param init Initialization token from Collabs framework.
   * @param userId Unique identifier for the user.
   */
  constructor(init: InitToken, userId: string) {
    super(init);

    this.userId = userId;

    this.presence = super.registerCollab(
      "presence",
      (init) => new CPresence(init)
    );

    this.documents = super.registerCollab(
      "documents",
      (init) =>
        new CMap(init, (init, key) => {
          return new TrackChangesDocument(init, key, this.userId);
        })
    );
  }

  /**
   * Creates a new collaborative document and adds it to the application.
   * @param fileName The name of the new document.
   * @returns The unique DocumentID of the created document.
   */
  createDocument(fileName: string): DocumentID {
    const id = uuid();

    this.documents.set(id).fileName.insert(0, fileName);

    return id;
  }

  /**
   * Removes a document from the application by its DocumentID.
   * @param id The DocumentID of the document to remove.
   */
  removeDocument(id: DocumentID) {
    this.documents.delete(id);
  }
}
