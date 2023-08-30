import {Facet, ChangeSet, ChangeDesc, StateField, Annotation, EditorState, StateEffect,
        Transaction, combineConfig, Extension} from "@codemirror/state"

/// An update is a set of changes and effects.
export interface Update {
  /// The changes made by this update.
  changes: ChangeSet,
  /// The effects in this update. There'll only ever be effects here
  /// when you configure your collab extension with a
  /// [`sharedEffects`](#collab.collab^config.sharedEffects) option.
  effects?: readonly StateEffect<any>[]
  /// The [ID](#collab.collab^config.clientID) of the client who
  /// created this update.
  clientID: string
}

class LocalUpdate implements Update {
  constructor(
    readonly origin: Transaction,
    readonly changes: ChangeSet,
    readonly effects: readonly StateEffect<any>[],
    readonly clientID: string
  ) {}
}

class CollabState {
  constructor(
    // The version up to which changes have been confirmed.
    readonly version: number,
    // The local updates that havent been successfully sent to the
    // server yet.
    readonly unconfirmed: readonly LocalUpdate[]) {}
}

type CollabConfig = {
  /// The starting document version. Defaults to 0.
  startVersion?: number,
  /// This client's identifying [ID](#collab.getClientID). Will be a
  /// randomly generated string if not provided.
  clientID?: string,
  /// It is possible to share information other than document changes
  /// through this extension. If you provide this option, your
  /// function will be called on each transaction, and the effects it
  /// returns will be sent to the server, much like changes are. Such
  /// effects are automatically remapped when conflicting remote
  /// changes come in.
  sharedEffects?: (tr: Transaction) => readonly StateEffect<any>[]
}

const collabConfig = Facet.define<CollabConfig & {generatedID: string}, Required<CollabConfig>>({
  combine(configs) {
    let combined = combineConfig(configs, {startVersion: 0, clientID: null as any, sharedEffects: () => []}, {
      generatedID: a => a
    })
    if (combined.clientID == null) combined.clientID = (configs.length && configs[0].generatedID) || ""
    return combined
  }
})

const collabReceive = Annotation.define<CollabState>()

const collabField = StateField.define({
  create(state) {
    return new CollabState(state.facet(collabConfig).startVersion, [])
  },

  update(collab: CollabState, tr: Transaction) {
    let isSync = tr.annotation(collabReceive)
    if (isSync) return isSync
    let {sharedEffects, clientID} = tr.startState.facet(collabConfig)
    let effects = sharedEffects(tr)
    if (effects.length || !tr.changes.empty)
      return new CollabState(collab.version, collab.unconfirmed.concat(new LocalUpdate(tr, tr.changes, effects, clientID)))
    return collab
  }
})

/// Create an instance of the collaborative editing plugin.
export function collab(config: CollabConfig = {}): Extension {
  return [collabField, collabConfig.of({generatedID: Math.floor(Math.random() * 1e9).toString(36), ...config})]
}

/// Create a transaction that represents a set of new updates received
/// from the authority. Applying this transaction moves the state
/// forward to adjust to the authority's view of the document.
export function receiveUpdates(state: EditorState, updates: readonly Update[]) {
  let {version, unconfirmed} = state.field(collabField)
  let {clientID} = state.facet(collabConfig)

  version += updates.length
  let effects: readonly StateEffect<any>[] = [], changes = null

  let own = 0
  for (let update of updates) {
    let ours = own < unconfirmed.length ? unconfirmed[own] : null
    if (ours && ours.clientID == update.clientID) {
      if (changes) changes = changes.map(ours.changes, true)
      effects = StateEffect.mapEffects(effects, update.changes)
      own++
    } else {
      effects = StateEffect.mapEffects(effects, update.changes)
      if (update.effects) effects = effects.concat(update.effects)
      changes = changes ? changes.compose(update.changes) : update.changes
    }
  }

  if (own) unconfirmed = unconfirmed.slice(own)
  if (unconfirmed.length) {
    if (changes) unconfirmed = unconfirmed.map(update => {
      let updateChanges = update.changes.map(changes!)
      changes = changes!.map(update.changes, true)
      return new LocalUpdate(update.origin, updateChanges, StateEffect.mapEffects(update.effects, changes!), clientID)
    })
    if (effects.length) {
      let composed = unconfirmed.reduce((ch, u) => ch.compose(u.changes),
                                        ChangeSet.empty(unconfirmed[0].changes.length))
      effects = StateEffect.mapEffects(effects, composed)
    }
  }

  if (!changes)
    return state.update({annotations: [collabReceive.of(new CollabState(version, unconfirmed))]})

  return state.update({
    changes: changes,
    effects,
    annotations: [
      Transaction.addToHistory.of(false),
      Transaction.remote.of(true),
      collabReceive.of(new CollabState(version, unconfirmed))
    ],
    filter: false
  })
}

/// Returns the set of locally made updates that still have to be sent
/// to the authority. The returned objects will also have an `origin`
/// property that points at the transaction that created them. This
/// may be useful if you want to send along metadata like timestamps.
/// (But note that the updates may have been mapped in the meantime,
/// whereas the transaction is just the original transaction that
/// created them.)
export function sendableUpdates(state: EditorState): readonly (Update & {origin: Transaction})[] {
  return state.field(collabField).unconfirmed
}

/// Get the version up to which the collab plugin has synced with the
/// central authority.
export function getSyncedVersion(state: EditorState) {
  return state.field(collabField).version
}

/// Get this editor's collaborative editing client ID.
export function getClientID(state: EditorState) {
  return state.facet(collabConfig).clientID
}

/// Rebase and deduplicate an array of client-submitted updates that
/// came in with an out-of-date version number. `over` should hold the
/// updates that were accepted since the given version (or at least
/// their change descs and client IDs). Will return an array of
/// updates that, firstly, has updates that were already accepted
/// filtered out, and secondly, has been moved over the other changes
/// so that they apply to the current document version.
export function rebaseUpdates(updates: readonly Update[], over: readonly {changes: ChangeDesc, clientID: string}[]) {
  if (!over.length || !updates.length) return updates
  let changes: ChangeDesc | null = null, skip = 0
  for (let update of over) {
    let other = skip < updates.length ? updates[skip] : null
    if (other && other.clientID == update.clientID) {
      if (changes) changes = changes.mapDesc(other.changes, true)
      skip++
    } else {
      changes = changes ? changes.composeDesc(update.changes) : update.changes
    }
  }

  if (skip) updates = updates.slice(skip)
  return !changes ? updates : updates.map(update => {
    let updateChanges = update.changes.map(changes!)
    changes = changes!.mapDesc(update.changes, true)
    return {
      changes: updateChanges,
      effects: update.effects && StateEffect.mapEffects(update.effects, changes!),
      clientID: update.clientID
    }
  })
}
