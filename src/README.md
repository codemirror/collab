This package provides the scaffolding for basic operational-transform
based collaborative editing. When it is enabled, the editor will
accumulate [local changes](#collab.sendableUpdates), which can be sent
to a central service. When new changes are received from the service,
they can be applied to the state with
[`receiveUpdates`](#collab.receiveUpdates).

See the [collaborative editing example](../../examples/collab) for a
more detailed description of the protocol.

@collab

@Update

@receiveUpdates

@sendableUpdates

@getSyncedVersion

@getClientID
