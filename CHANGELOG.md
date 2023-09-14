## 6.1.1 (2023-09-14)

### Bug fixes

Fix an issue where the configuration process raised an error when multiple instances of the `collab` extensions were added.

## 6.1.0 (2023-08-22)

### New features

The new `rebaseUpdates` function can be used by a collaborative editing server to accept updates even if they apply to an old document version.

`receiveUpdates` is now able to handle updates that were rebased by the server.

## 6.0.0 (2022-06-08)

### Breaking changes

Update dependencies to 6.0.0

## 0.20.0 (2022-04-20)

### Breaking changes

Update dependencies to 0.20.0

## 0.19.0 (2021-08-11)

### Breaking changes

Update dependencies to 0.19.0

## 0.18.2 (2021-04-06)

### Bug fixes

Add `Transaction.remote` annotation to transactions that include remote updates.

## 0.18.1 (2021-03-12)

### Breaking changes

`Update` objects now have a `clientID` field, and `receiveUpdates` no longer takes its `ownUpdateCount` argument, to simplify the interface.

## 0.18.0 (2021-03-03)

### Breaking changes

Update dependencies to 0.18.

## 0.17.1 (2021-01-06)

### New features

The package now also exports a CommonJS module.

## 0.17.0 (2020-12-29)

### Breaking changes

First numbered release.

