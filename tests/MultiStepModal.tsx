import { App, Modal, TFile, FuzzySuggestModal } from "obsidian";

export class MultiStepModal extends Modal {
  private noteTitles: string[];
  private headers: string[];
  private currentStep: 'selectNote' | 'selectHeader';
  private selectedNote: string | null;
  private onSelectionComplete: (noteTitle: string, header: string) => void;

  constructor(app: App, noteTitles: string[], onSelectionComplete: (noteTitle: string, header: string) => void) {
    super(app);
    this.noteTitles = noteTitles;
    this.headers = [];
    this.currentStep = 'selectNote';
    this.selectedNote = null;
    this.onSelectionComplete = onSelectionComplete;
  }

  onOpen() {
    this.render();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    if (this.currentStep === 'selectNote') {
      new NoteTitleSelectionModal(this.app, this.noteTitles, (noteTitle) => {
        this.selectNote(noteTitle);
      }).open();
    } else if (this.currentStep === 'selectHeader') {
      contentEl.createEl("h2", { text: `Select a Header from ${this.selectedNote}` });
      this.headers.forEach(header => {
        const button = contentEl.createEl("button", { text: header });
        button.onclick = () => this.selectHeader(header);
      });
    }
  }

  private selectNote(noteTitle: string) {
    this.selectedNote = noteTitle;
    this.headers = this.getHeadersForNote(noteTitle); // Fetch headers for the selected note
    this.currentStep = 'selectHeader';
    this.render();
  }

  private selectHeader(header: string) {
    console.log(`Selected header: ${header} from note: ${this.selectedNote}`);
    if (this.selectedNote) {
      this.onSelectionComplete(this.selectedNote, header);
    }
    this.close();
  }

  private getHeadersForNote(noteTitle: string): string[] {
    const file = this.app.vault.getAbstractFileByPath(noteTitle) as TFile;
    if (!file) {
      console.error(`Note not found: ${noteTitle}`);
      return [];
    }

    const headers: string[] = [];
    this.app.vault.read(file).then(content => {
      const lines = content.split('\n');
      lines.forEach(line => {
        const headerMatch = line.match(/^(#+)\s+(.*)/);
        if (headerMatch) {
          headers.push(headerMatch[2]); // Extract the header text
        }
      });
    }).catch(err => {
      console.error(`Error reading note: ${err}`);
    });

    return headers;
  }
}

class NoteTitleSelectionModal extends FuzzySuggestModal<string> {
  private onChooseNoteTitle: (noteTitle: string) => void;
  private noteTitles: string[];

  constructor(app: App, noteTitles: string[], onChooseNoteTitle: (noteTitle: string) => void) {
    super(app);
    this.noteTitles = noteTitles;
    this.onChooseNoteTitle = onChooseNoteTitle;
  }

  getItems(): string[] {
    return this.noteTitles;
  }

  getItemText(noteTitle: string): string {
    return noteTitle;
  }

  onChooseItem(noteTitle: string, evt: MouseEvent | KeyboardEvent) {
    this.onChooseNoteTitle(noteTitle);
  }
}
