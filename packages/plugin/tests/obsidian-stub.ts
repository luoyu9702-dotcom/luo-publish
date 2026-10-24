/** Runtime stand-in so Vitest can load modules that reference Obsidian classes. */
export const testNotices: string[] = [];

export class Notice {
  constructor(
    public message: string,
    public timeout?: number,
  ) {
    testNotices.push(message);
  }
}

export class SuggestModal<T> {
  constructor(_app: unknown) {}
  setPlaceholder(_placeholder: string): void {}
  open(): void {}
}

class FakeEl {
  children: FakeEl[] = [];
  textContent = "";
  className = "";
  empty(): void {
    this.children = [];
  }
  createEl(tag: string, attrs?: { text?: string; cls?: string }): FakeEl {
    const el = new FakeEl();
    if (attrs?.text) el.textContent = attrs.text;
    if (attrs?.cls) el.className = attrs.cls;
    this.children.push(el);
    return el;
  }
  createDiv(attrs?: { cls?: string }): FakeEl {
    return this.createEl("div", attrs);
  }
  createSpan(attrs?: { text?: string }): FakeEl {
    return this.createEl("span", attrs);
  }
  setText(text: string): void {
    this.textContent = text;
  }
  addEventListener(_type: string, _fn: () => void): void {}
  setAttribute(_name: string, _value: string): void {}
}

/** Every modal a command opens, so a test can drive its confirm/cancel. */
export const openedModals: FakeModal[] = [];

export class FakeModal {
  app: unknown;
  containerEl = new FakeEl();
  modalEl = new FakeEl();
  titleEl = new FakeEl();
  contentEl = new FakeEl();
  shouldRestoreSelection = false;
  constructor(app: unknown) {
    this.app = app;
  }
  open(): void {
    openedModals.push(this);
  }
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

/** Obsidian's Modal is an open/close shell with content elements. */
export class Modal extends FakeModal {}

export class Plugin {}

export class TFile {}

export class Vault {}
