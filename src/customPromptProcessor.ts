import { CustomError } from "@/error";
import { PromptUsageStrategy } from "@/promptUsageStrategy";
import { CopilotSettings } from "@/settings/SettingsPage";
import {
  extractNoteTitles,
  getFileContent,
  getFileName,
  getNoteFileFromTitle,
  getNotesFromPath,
  getNotesFromTags,
  processVariableNameForNotePath,
} from "@/utils";
import { match } from "assert";
import { normalizePath, Notice, TFile, Vault } from "obsidian";

export interface CustomPrompt {
  title: string;
  content: string;
}

export class CustomPromptProcessor {
  private static instance: CustomPromptProcessor;

  private constructor(
    private vault: Vault,
    private settings: CopilotSettings,
    private usageStrategy?: PromptUsageStrategy
  ) {}

  static getInstance(
    vault: Vault,
    settings: CopilotSettings,
    usageStrategy?: PromptUsageStrategy
  ): CustomPromptProcessor {
    if (!CustomPromptProcessor.instance) {
      if (!usageStrategy) {
        console.warn("PromptUsageStrategy not initialize");
      }
      CustomPromptProcessor.instance = new CustomPromptProcessor(vault, settings, usageStrategy);
    }
    return CustomPromptProcessor.instance;
  }

  async recordPromptUsage(title: string) {
    return this.usageStrategy?.recordUsage(title).save();
  }

  async getAllPrompts(): Promise<CustomPrompt[]> {
    const folder = this.settings.customPromptsFolder;
    const files = this.vault
      .getFiles()
      .filter((file) => file.path.startsWith(folder) && file.extension === "md");

    const prompts: CustomPrompt[] = [];
    for (const file of files) {
      const content = await this.vault.read(file);
      prompts.push({
        title: file.basename,
        content: content,
      });
    }

    // Clean up promptUsageTimestamps
    this.usageStrategy?.removeUnusedPrompts(prompts.map((prompt) => prompt.title)).save();

    return prompts.sort((a, b) => this.usageStrategy?.compare(b.title, a.title) || 0);
  }

  async getPrompt(title: string): Promise<CustomPrompt | null> {
    const filePath = `${this.settings.customPromptsFolder}/${title}.md`;
    const file = this.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      const content = await this.vault.read(file);
      return { title, content };
    }
    return null;
  }

  async savePrompt(title: string, content: string): Promise<void> {
    const folderPath = normalizePath(this.settings.customPromptsFolder);
    const filePath = `${folderPath}/${title}.md`;

    // Check if the folder exists and create it if it doesn't
    const folderExists = await this.vault.adapter.exists(folderPath);
    if (!folderExists) {
      await this.vault.createFolder(folderPath);
    }

    // Create the file
    await this.vault.create(filePath, content);
  }

  async updatePrompt(originTitle: string, newTitle: string, content: string): Promise<void> {
    const filePath = `${this.settings.customPromptsFolder}/${originTitle}.md`;
    const file = this.vault.getAbstractFileByPath(filePath);

    if (file instanceof TFile) {
      if (originTitle !== newTitle) {
        const newFilePath = `${this.settings.customPromptsFolder}/${newTitle}.md`;
        const newFileExists = this.vault.getAbstractFileByPath(newFilePath);

        if (newFileExists) {
          throw new CustomError(
            "Error saving custom prompt. Please check if the title already exists."
          );
        }

        await Promise.all([
          this.usageStrategy?.updateUsage(originTitle, newTitle).save(),
          this.vault.rename(file, newFilePath),
        ]);
      }
      await this.vault.modify(file, content);
    }
  }

  async deletePrompt(title: string): Promise<void> {
    const filePath = `${this.settings.customPromptsFolder}/${title}.md`;
    const file = this.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await Promise.all([
        this.usageStrategy?.removeUnusedPrompts([title]).save(),
        this.vault.delete(file),
      ]);
    }
  }

  /**
   * Extracts variables from a custom prompt and retrieves their content.
   * 
   * This function processes a custom prompt string, identifying variables enclosed in curly braces {},
   * and fetches the corresponding content for each variable. It handles different types of variables:
   * - {activeNote}: Content of the currently active note
   * - {#tag1,#tag2,...}: Content of notes with specified tags
   * - {path/to/note}: Content of notes matching the specified path
   * 
   * @param {string} customPrompt - The custom prompt string containing variables to extract
   * @param {TFile} [activeNote] - The currently active note file (optional)
   * @returns {Promise<string[]>} An array of strings, each containing the content for a matched variable
   */
  public async extractVariablesFromPrompt(
    customPrompt: string,
    activeNote?: TFile
  ): Promise<string[]> {
    const variablesWithContent: string[] = [];
    const variableRegex = /\{([^}]+)\}/g;
    let match;

    console.log(
      `*** EXTRACT VARIABLES FROM PROMPT ***\n` +
      `prompt: ${customPrompt}`
    )
    // matching curly braces only {}
    while ((match = variableRegex.exec(customPrompt)) !== null) {
      const variableName = match[1].trim();
      
      const notes = [];

      if (variableName.toLowerCase() === "activenote") {
        if (activeNote) {
          const content = await getFileContent(activeNote, this.vault);
          if (content) {
            notes.push({ name: getFileName(activeNote), content });
          }
        } else {
          new Notice("No active note found.");
        }
      } else if (variableName.startsWith("#")) {
        // Handle tag-based variable for multiple tags
        const tagNames = variableName
          .slice(1)
          .split(",")
          .map((tag) => tag.trim());
        const noteFiles = await getNotesFromTags(this.vault, tagNames);
        for (const file of noteFiles) {
          const content = await getFileContent(file, this.vault);
          if (content) {
            notes.push({ name: getFileName(file), content });
          }
        }
      } else {
        const processedVariableName = processVariableNameForNotePath(variableName);
        const noteFiles = await getNotesFromPath(this.vault, processedVariableName);
        for (const file of noteFiles) {
          const content = await getFileContent(file, this.vault);
          console.log('note content:', content)
          if (content) {
            notes.push({ name: getFileName(file), content });
          }
        }
      }

      if (notes.length > 0) {
        const markdownContent = notes
          .map((note) => `## ${note.name}\n\n${note.content}`)
          .join("\n\n");
        variablesWithContent.push(markdownContent);
      } else {
        new Notice(`Warning: No valid notes found for the provided path '${variableName}'.`);
      }
    }

    return variablesWithContent;
  }

  /**
   * Processes a custom prompt by:
   * 1. Extracting variables from the prompt
   * 2. Handling selected text or active note content
   * 3. Processing note titles in [[]] syntax
   * 4. Combining all information into a final processed prompt
   * 
   * @param customPrompt - The original custom prompt to process
   * @param selectedText - The text currently selected by the user
   * @param activeNote - The currently active note file
   * @returns A promise that resolves to the processed prompt string
   */
  async processCustomPrompt(
    customPrompt: string,
    selectedText: string,
    activeNote?: TFile
  ): Promise<string> {

    console.log(
      `*** PROCESS CUSTOM PROMPT ***`
    )

    const variablesWithContent = await this.extractVariablesFromPrompt(customPrompt, activeNote);
    let processedPrompt = customPrompt;

    // Extract all variable matches (enclosed in {}) from the processed prompt
    const matches = [...processedPrompt.matchAll(/\{([^}]+)\}/g)];

    let additionalInfo = "";
    let activeNoteContent: string | null = null;

    if (processedPrompt.includes("{}")) {
      processedPrompt = processedPrompt.replace(/\{\}/g, "{selectedText}");
      if (selectedText) {
        additionalInfo += `selectedText:\n\n ${selectedText}`;
      } else if (activeNote) {
        activeNoteContent = await getFileContent(activeNote, this.vault);
        additionalInfo += `selectedText (entire active note):\n\n ${activeNoteContent}`;
      } else {
        additionalInfo += `selectedText:\n\n (No selected text or active note available)`;
      }
    }

    for (let i = 0; i < variablesWithContent.length; i++) {
      if (matches[i]) {
        const varname = matches[i][1];
        if (varname.toLowerCase() === "activenote" && activeNoteContent) {
          // Skip adding activeNote content if it's already added as selectedText
          continue;
        }
        additionalInfo += `\n\n${varname}:\n\n${variablesWithContent[i]}`;
      }
    }

    // Process [[note title]] syntax
    // This is where getHeaderContent has to get called, i think
    console.log('extract note titles from processed prompt:', processedPrompt)
    const noteTitles = extractNoteTitles(processedPrompt);
    let noteHeading: string | undefined;

    for (const noteTitle of noteTitles) {
      // Check if this note title wasn't already processed in extractVariablesFromPrompt
      if (!matches.some((match) => match[1].includes(`[[${noteTitle}]]`))) {

        // Process header if noteTitle contains '#'
        let parsedNoteTitle = noteTitle;
        if (noteTitle.includes('#')) {
          const [titlePart, headingPart] = noteTitle.split('#').map(part => part.trim());
          parsedNoteTitle = titlePart;
          noteHeading = headingPart;
        }
        console.log('note title passed to getNoteFileFromTitle:', parsedNoteTitle)
        console.log('note heading:', noteHeading)

        const noteFile = await getNoteFileFromTitle(this.vault, parsedNoteTitle);
        if (noteFile) {
          console.log('getting note content for: ', parsedNoteTitle)
          const noteContent = await getFileContent(noteFile, this.vault, noteHeading);
          console.log('note content returned:\n', noteContent)
          additionalInfo += `\n\n[[${noteTitle}]]:\n\n${noteContent}`;
        }
      }
    }

    return processedPrompt + "\n\n" + additionalInfo;
  }
}
