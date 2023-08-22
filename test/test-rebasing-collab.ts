import {EditorState, Text, StateCommand} from "@codemirror/state"
import {history, undo} from "@codemirror/commands"
import ist from "ist"
import {collab, receiveUpdates, sendableUpdates, rebaseUpdates, Update, getSyncedVersion} from "@codemirror/collab"

type Event =
  ["send", string] |
  ["receive", string] |
  ["type", string, string, number?] |
  ["tr", string, (state: EditorState) => EditorState]

function send(id: string): Event { return ["send", id] }
function receive(id: string): Event { return ["receive", id] }
function type(id: string, text: string, at?: number, to?: number): Event {
  return ["tr", id, state => state.update({changes: {from: at ?? state.doc.length, to, insert: text}}).state]
}
function cmd(id: string, command: StateCommand): Event {
  return ["tr", id, state => {command({state, dispatch: tr => state = tr.state}); return state}]
}

function test(doc: string, events: Event[], endDoc?: string) {
  let startDoc = Text.of(doc.split("\n")), serverDoc = startDoc
  let updates: Update[] = []
  let peers: {[id: string]: EditorState} = Object.create(null)

  function send(id: string) {
    let state = peers[id], version = getSyncedVersion(state)
    let sendable: readonly Update[] = sendableUpdates(state)
    if (version != updates.length) sendable = rebaseUpdates(sendable, updates.slice(version))
    if (!sendable.length) return
    for (let update of sendable) {
      updates.push(update)
      serverDoc = update.changes.apply(serverDoc)
    }
  }

  function receive(id: string) {
    let state = peers[id], version = getSyncedVersion(state)
    if (version < updates.length) {
      peers[id] = receiveUpdates(state, updates.slice(version)).state
    }
  }

  for (let event of events) {
    let id = event[1]
    if (!(id in peers)) {
      peers[event[1]] = EditorState.create({doc: startDoc, extensions: [
        history(),
        collab({clientID: event[1], startVersion: 0})
      ]})
    }
    if (event[0] == "send") {
      send(id)
    } else if (event[0] == "receive") {
      receive(id)
    } else if (event[0] == "tr") {
      peers[id] = event[2](peers[id])
    }
  }

  for (let id in peers) send(id)
  if (endDoc) ist(serverDoc.toString(), endDoc)
  else endDoc = serverDoc.toString()

  for (let id in peers) receive(id)
  for (let id in peers) ist("[" + id + "]" + peers[id].doc.toString(), "[" + id + "]" + endDoc)
}

describe("rebasing collab", () => {
  it("works for simple cases", () => test("bcd", [
    type("a", "a", 0),
    type("b", "e", 3),
    send("a")
  ], "abcde"))

  it("works for multiple rebased changes", () => test("abc", [
    type("a", "d", 3),
    type("a", "e", 4),
    type("b", "0", 0),
    send("b"),
    send("a")
  ], "0abcde"))

  it("works for multiple peer changes", () => test("abc", [
    type("a", "d", 3),
    type("a", "e", 4),
    type("b", "0", 0),
    type("b", "1", 1),
    send("b"),
    send("a")
  ], "01abcde"))

  it("works with local unconfirmed changes", () => test("x", [
    type("a", "y"),
    type("b", "0", 0),
    send("b"),
    send("a"),
    type("a", "z"),
    receive("a")
  ], "0xyz"))

  it("works with multiple local unconfirmed changes", () => test("x", [
    type("a", "y"),
    type("b", "0", 1),
    type("b", "1", 2),
    send("b"),
    send("a"),
    type("a", "z"),
    type("a", "!", 0),
    receive("a")
  ], "!x01yz"))

  it("works with local changes sandwiched between peer changes", () => test("-", [
    type("a", "X"),
    type("a", "Y"),
    type("b", "U", 0),
    type("b", "V", 1),
    send("b"),
    send("a"),
    receive("b"),
    type("b", "W", 2),
    type("b", "!", 6),
    send("b"),
    type("a", "Z"),
    receive("a")
  ], "UVW-XY!Z"))

  it("works when multiple sets of local changes are in-flight", () => test("123", [
    type("a", "X", 1),
    type("a", "Y", 2),
    type("b", "A", 0),
    type("b", "B", 1),
    send("a"),
    send("b"),
    receive("b"),
    type("a", "Z", 4),
    type("a", ".", 5),
    send("a"),
    receive("b"),
    type("b", "?"),
    send("b")
  ], "AB1XY2Z.3?"))

  it("can handle two changesets from the same client on top of each other", () => test("abcde", [
    type("b", "x", 3),
    send("b"),
    type("a", "yyy", 1, 3),
    send("a"),
    type("a", "?", 2)
  ], "ay?yyxde"))

  it("properly undoes rebased changes", () => test("one two", [
    type("a", "three", 4, 7),
    type("b", "?", 0, 3),
    send("b"),
    send("a"),
    receive("a"),
    cmd("a", undo)
  ], "? two"))

  function r(n: number) { return Math.floor(Math.random() * n) }

  function randomString(len: number) {
    let result = "", chars = "abcdefghijklmnopqrstuvwxyz     .!?"
    for (let i = 0; i < len; i++) result += chars[r(chars.length)]
    return result
  }

  function randomChange(len: number): {from: number, to?: number, insert?: string} {
    let type = r(10), from = r(len)
    if (type < 7) return {from, insert: randomString(r(1) + 1) }
    let to = from + r(Math.min(len - from, 5))
    return {from, to, insert: type == 9 ? randomString(r(6) + 2) : undefined}
  }

  function randomChanges(n: number, record: any[]) {
    return (state: EditorState) => {
      let changes = []
      for (let i = 0; i < n; i++) changes.push(record[3 + i] = randomChange(state.doc.length))
      return state.update({changes}).state
    }
  }

  it("works for random input", () => {
    for (let i = 0; i < 100; i++) {
      let events: Event[] = [], peers = ["a", "b", "c"], doc = randomString(r(i) + 5)
      for (let j = 0; j < i + 10; j++) {
        let id = peers[r(peers.length)], type = r(6)
        if (type < 4) {
          let record: any[] = ["tr", id]
          record.push(randomChanges(3, record))
          events.push(record as any)
        } else if (type == 4) {
          events.push(["send", id])
        } else {
          events.push(["receive", id])
        }
      }
      try {
        test(doc, events)
      } catch (e: any) {
        console.log(doc, events)
        throw e
      }
    }
  })
})
