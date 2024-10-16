import { App, Modal } from "obsidian";

export class NoteHeadersModal extends Modal {
  private headers: string[];

  constructor(app: App, headers: string[]) {
    super(app);
    this.headers = headers;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Note Headers" });
    this.headers.forEach(header => {
      contentEl.createEl("div", { text: header });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
