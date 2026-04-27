// Minimal mapping from DOM KeyboardEvent.key to the CDP key descriptor.
// Covers the common non-printable keys; printable characters fall through to
// the key value itself with a synthesized KeyA / Digit0 / etc. code.

interface KeyDescriptor {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const NAMED: Record<string, KeyDescriptor> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9, text: "\t" },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Insert: { key: "Insert", code: "Insert", keyCode: 45 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Shift: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
  Control: { key: "Control", code: "ControlLeft", keyCode: 17 },
  Alt: { key: "Alt", code: "AltLeft", keyCode: 18 },
  Meta: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  CapsLock: { key: "CapsLock", code: "CapsLock", keyCode: 20 },
  " ": { key: " ", code: "Space", keyCode: 32, text: " " },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
};

for (let i = 1; i <= 12; i++) {
  NAMED[`F${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };
}

export function keyDescriptorFor(key: string, code?: string): KeyDescriptor {
  const named = NAMED[key];
  if (named) {
    return code ? { ...named, code } : named;
  }
  // Single printable character.
  if (key.length === 1) {
    const ch = key;
    const upper = ch.toUpperCase();
    let keyCode: number;
    let synthCode: string;
    if (/[A-Z]/.test(upper)) {
      keyCode = upper.charCodeAt(0); // 'A'..'Z' → 65..90
      synthCode = `Key${upper}`;
    } else if (/[0-9]/.test(upper)) {
      keyCode = upper.charCodeAt(0); // '0'..'9' → 48..57
      synthCode = `Digit${upper}`;
    } else {
      keyCode = upper.charCodeAt(0);
      synthCode = code ?? "";
    }
    return { key: ch, code: code ?? synthCode, keyCode, text: ch };
  }
  // Unknown — let CDP do its best with what we have.
  return { key, code: code ?? key, keyCode: 0 };
}
