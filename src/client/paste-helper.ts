import type { ClientAction, ModifierKey } from "../shared/protocol.js";

// Owns the hidden (currently debug-visible) <input> that anchors clipboard
// behavior. Native Cmd-C copies straight off this element's selected value
// so the chord stays out of any JS call stack — that's what keeps macOS
// from escalating Cmd-letter chords to the Apple menu.
//
// Two display modes, driven by setRemoteState:
//
//   - "selection" mode (default): the helper mirrors the remote DOM's text
//     selection padded with spaces, " <selection> ", with the content range
//     pre-selected. Native Cmd-C copies the right text. A selectionchange
//     observer detects Cmd-A / Ctrl-A / Ctrl-E from how the selection lands
//     in the padded value and forwards them to the remote.
//
//   - "field" mode: the remote's focused element is an <input> / <textarea>.
//     The helper mirrors the field's full value plus selection range so
//     arrow-key navigation in the helper visually matches what the user
//     would see on the remote. The selectionchange detector is disabled
//     here — keystrokes that move the caret are forwarded directly via the
//     keydown handler, and the field's authoritative state comes back from
//     the server.
export interface PasteHelperOptions {
  el: HTMLInputElement;
  send: (action: ClientAction) => string | null;
  isUrlBarFocused: () => boolean;
  debug?: boolean;
}

// Shape mirrored straight from SelectionMessage minus the wire-protocol
// `type` field. Kept here to avoid a hard dependency on the server message
// type from this module.
export interface RemoteState {
  text: string;
  field?: {
    value: string;
    selectionStart: number;
    selectionEnd: number;
  };
}

export interface PasteHelper {
  focus: () => void;
  setRemoteState: (state: RemoteState) => void;
}

// Caret/selection-moving keys we forward as-is to the remote. preventDefault
// stops the local input from also responding (which would either drift the
// caret out of the baseline in selection mode or fight the field-mirror in
// field mode).
const NAV_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function modifiersFromEvent(e: KeyboardEvent): ModifierKey[] {
  const mods: ModifierKey[] = [];
  if (e.altKey) mods.push("Alt");
  if (e.ctrlKey) mods.push("Control");
  if (e.metaKey) mods.push("Meta");
  if (e.shiftKey) mods.push("Shift");
  return mods;
}

export function setupPasteHelper(opts: PasteHelperOptions): PasteHelper {
  const { el, send, isUrlBarFocused } = opts;

  // Authoritative remote state. Updated by setRemoteState; applied to the
  // <input> via applyState. lastProgrammaticSelection records what we last
  // wrote so the selectionchange observer can ignore our own writes.
  let state: RemoteState = { text: "" };
  let lastProgrammaticSelection: [number, number] = [0, 0];

  const dbg = opts.debug
    ? (event: string, fields?: Record<string, unknown>) => {
        if (fields) console.log(`[clip] ${event}`, fields);
        else console.log(`[clip] ${event}`);
      }
    : (_event: string, _fields?: Record<string, unknown>) => {};

  function expectedValue(): string {
    return state.field ? state.field.value : ` ${state.text} `;
  }

  function expectedSelection(): [number, number] {
    if (state.field) return [state.field.selectionStart, state.field.selectionEnd];
    return [1, 1 + state.text.length];
  }

  function applyState() {
    const value = expectedValue();
    if (el.value !== value) el.value = value;
    const [start, end] = expectedSelection();
    if (document.activeElement === el) el.setSelectionRange(start, end);
    lastProgrammaticSelection = [start, end];
  }

  function focus() {
    if (isUrlBarFocused()) return;
    const wasFocused = document.activeElement === el;
    if (!wasFocused) el.focus({ preventScroll: true });
    applyState();
    dbg("focus-helper", {
      wasFocused,
      mode: state.field ? "field" : "selection",
      valueLen: el.value.length,
      selection: [el.selectionStart, el.selectionEnd],
    });
  }

  function setRemoteState(next: RemoteState) {
    state = next;
    applyState();
    dbg("server-selection", {
      mode: next.field ? "field" : "selection",
      textLen: next.text.length,
      textPreview: next.text.slice(0, 40),
      fieldValueLen: next.field?.value.length,
      fieldSelection: next.field
        ? [next.field.selectionStart, next.field.selectionEnd]
        : undefined,
      helperFocused: document.activeElement === el,
    });
  }

  // Selection-state observer. In selection mode it detects text-system
  // chords (Cmd-A / Ctrl-A / Ctrl-E) by how the selection lands inside the
  // padded value and forwards the matching key action. In field mode it's
  // disabled — keystrokes are forwarded by the keydown handler and the
  // field's state is mirrored back by the server.
  document.addEventListener("selectionchange", () => {
    if (document.activeElement !== el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (
      start === lastProgrammaticSelection[0] &&
      end === lastProgrammaticSelection[1]
    ) {
      return;
    }
    if (state.field) return;
    const len = el.value.length;
    let detected: string | null = null;
    if (start === 0 && end === len) {
      detected = "cmd-a";
      send({ type: "key", key: "a", code: "KeyA", modifiers: ["Meta"], phase: "press" });
    } else if (start === 0 && end === 0) {
      detected = "ctrl-a";
      send({ type: "key", key: "a", code: "KeyA", modifiers: ["Control"], phase: "press" });
    } else if (start === len && end === len) {
      detected = "ctrl-e";
      send({ type: "key", key: "e", code: "KeyE", modifiers: ["Control"], phase: "press" });
    }
    dbg("selectionchange", { start, end, len, detected });
    applyState();
  });

  // Forward navigation keys to the remote. preventDefault keeps the local
  // input's caret pinned at our programmatic baseline; the authoritative
  // post-keystroke state comes back via setRemoteState.
  el.addEventListener("keydown", (e) => {
    if (!NAV_KEYS.has(e.key)) return;
    e.preventDefault();
    const modifiers = modifiersFromEvent(e);
    send({ type: "key", key: e.key, code: e.code, modifiers, phase: "press" });
    dbg("nav-key", { key: e.key, modifiers });
  });

  // Cmd-V: route the system clipboard's plain text to the remote as an
  // IME-friendly insertText. preventDefault stops the local input from also
  // receiving the paste (which would dirty its value and shadow the next
  // remote-state mirror until the server pushed a fresh one).
  el.addEventListener("paste", (e) => {
    if (isUrlBarFocused()) return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    dbg("paste-event", { textLen: text.length, textPreview: text.slice(0, 40) });
    if (text) send({ type: "type", text });
  });

  // Native copy off the input is what produces Cmd-C output. The listener
  // is observation-only (no preventDefault, no setData) — useful while the
  // pipeline is being debugged so we can see exactly what's about to land
  // on the system clipboard.
  el.addEventListener("copy", () => {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = el.value.slice(start, end);
    dbg("copy-event", { start, end, selectedLen: selected.length, selected });
  });

  return { focus, setRemoteState };
}
