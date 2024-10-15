import ChainManager from "@/LLMProviders/chainManager";
import { useAIState } from "@/aiState";
import { updateChatMemory } from "@/chatUtils";
import ChatSessionIcons from "@/components/ChatComponents/ChatSessionIcons";
import ChatInputFollowup from "@/components/ChatComponents/ChatInputFollowup";
import ChatInputTop from "@/components/ChatComponents/ChatInputTop";
import ChatMessages from "@/components/ChatComponents/ChatMessages";
import { ABORT_REASON, AI_SENDER, EVENT_NAMES, USER_SENDER } from "@/constants";
import { AppContext } from "@/context";
import { CustomPromptProcessor } from "@/customPromptProcessor";
import { getAIResponse } from "@/langchainStream";
import CopilotPlugin from "@/main";
import { CopilotSettings } from "@/settings/SettingsPage";
import SharedState, { ChatMessage, useSharedState } from "@/sharedState";
import {
  createChangeToneSelectionPrompt,
  createTranslateSelectionPrompt,
  eli5SelectionPrompt,
  emojifyPrompt,
  fixGrammarSpellingSelectionPrompt,
  formatDateTime,
  glossaryPrompt,
  removeUrlsFromSelectionPrompt,
  rewriteLongerSelectionPrompt,
  rewritePressReleaseSelectionPrompt,
  rewriteShorterSelectionPrompt,
  rewriteTweetSelectionPrompt,
  rewriteTweetThreadSelectionPrompt,
  simplifyPrompt,
  summarizePrompt,
  tocPrompt,
} from "@/utils";
import { MarkdownView, Notice, TFile } from "obsidian";
import React, { useContext, useEffect, useState } from "react";

// Interface for options used in createEffect function
interface CreateEffectOptions {
  custom_temperature?: number;
  isVisible?: boolean;
  ignoreSystemMessage?: boolean;
}

// Interface for Chat component props
interface ChatProps {
  sharedState: SharedState;
  settings: CopilotSettings;
  chainManager: ChainManager;
  emitter: EventTarget;
  defaultSaveFolder: string;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
  updateUserMessageHistory: (newMessage: string) => void;
  plugin: CopilotPlugin;
  debug: boolean;
}

// Main Chat component
const Chat: React.FC<ChatProps> = ({
  sharedState,
  settings,
  chainManager,
  emitter,
  defaultSaveFolder,
  onSaveChat,
  updateUserMessageHistory,
  plugin,
  debug,
}) => {
  // State hooks for managing chat state
  const [chatHistory, addMessage, clearMessages] = useSharedState(sharedState);
  const [currentModelKey, setModelKey, currentChain, setChain, clearChatMemory] =
    useAIState(chainManager);
  const [currentAiMessage, setCurrentAiMessage] = useState("");
  const [inputMessageTop, setInputMessageTop] = useState(""); // Separate state for ChatInputTop
  const [inputMessageBottom, setInputMessageBottom] = useState(""); // Separate state for ChatInput
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [chatIsVisible, setChatIsVisible] = useState(false);

  // Effect to handle chat visibility
  useEffect(() => {
    const handleChatVisibility = (evt: CustomEvent<{ chatIsVisible: boolean }>) => {
      setChatIsVisible(evt.detail.chatIsVisible);
    };
    emitter.addEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleChatVisibility);

    // Cleanup function
    return () => {
      emitter.removeEventListener(EVENT_NAMES.CHAT_IS_VISIBLE, handleChatVisibility);
    };
  }, []);

  // Context for accessing the app instance
  const app = plugin.app || useContext(AppContext);

  // Function to handle sending a message
  const handleSendMessage = async () => {
    if (!inputMessageTop && !inputMessageBottom) return;

    const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault, settings);
    const processedUserMessage = await customPromptProcessor.processCustomPrompt(
      inputMessageTop || inputMessageBottom,
      "",
      app.workspace.getActiveFile() as TFile | undefined
    );

    const timestamp = formatDateTime(new Date());

    const userMessage: ChatMessage = {
      message: inputMessageTop || inputMessageBottom,
      sender: USER_SENDER,
      isVisible: true,
      timestamp: timestamp,
    };

    const promptMessageHidden: ChatMessage = {
      message: processedUserMessage,
      sender: USER_SENDER,
      isVisible: false,
      timestamp: timestamp,
    };

    // Add user message to chat history
    addMessage(userMessage);
    addMessage(promptMessageHidden);

    // Add to user message history
    updateUserMessageHistory(inputMessageTop || inputMessageBottom);
    setHistoryIndex(-1);

    // Clear input
    setInputMessageBottom("");

    // Display running dots to indicate loading
    setLoading(true);
    await getAIResponse(
      promptMessageHidden,
      chainManager,
      addMessage,
      setCurrentAiMessage,
      setAbortController,
      { debug }
    );
    setLoading(false);
  };

  // Function to navigate through message history
  const navigateHistory = (direction: "up" | "down"): string => {
    const history = plugin.userMessageHistory;
    if (direction === "up" && historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      return history[history.length - 1 - historyIndex - 1];
    } else if (direction === "down" && historyIndex > -1) {
      setHistoryIndex(historyIndex - 1);
      return historyIndex === 0 ? "" : history[history.length - 1 - historyIndex + 1];
    }
    return inputMessageTop || inputMessageBottom;
  };

  // Function to save chat as a note
  const handleSaveAsNote = async (openNote = false) => {
    if (!app) {
      console.error("App instance is not available.");
      return;
    }

    // Filter visible messages
    const visibleMessages = chatHistory.filter((message) => message.isVisible);

    if (visibleMessages.length === 0) {
      new Notice("No messages to save.");
      return;
    }

    // Get the epoch of the first message
    const firstMessageEpoch = visibleMessages[0].timestamp?.epoch || Date.now();

    // Format the chat content
    const chatContent = visibleMessages
      .map(
        (message) =>
          `**${message.sender}**: ${message.message}\n[Timestamp: ${message.timestamp?.display}]`
      )
      .join("\n\n");

    try {
      // Check if the default folder exists or create it
      const folder = app.vault.getAbstractFileByPath(defaultSaveFolder);
      if (!folder) {
        await app.vault.createFolder(defaultSaveFolder);
      }

      const { fileName: timestampFileName } = formatDateTime(new Date(firstMessageEpoch));

      // Get the first user message
      const firstUserMessage = visibleMessages.find((message) => message.sender === USER_SENDER);

      // Get the first 10 words from the first user message and sanitize them
      const firstTenWords = firstUserMessage
        ? firstUserMessage.message
            .split(/\s+/)
            .slice(0, 10)
            .join(" ")
            .replace(/[\\/:*?"<>|]/g, "") // Remove invalid filename characters
            .trim()
        : "Untitled Chat";

      // Create the file name (limit to 100 characters to avoid excessively long names)
      const sanitizedFileName = `${firstTenWords.slice(0, 100)}@${timestampFileName}`.replace(
        /\s+/g,
        "_"
      );
      const noteFileName = `${defaultSaveFolder}/${sanitizedFileName}.md`;

      // Add the timestamp and model properties to the note content
      const noteContentWithTimestamp = `---
epoch: ${firstMessageEpoch}
modelKey: ${currentModelKey}
tags:
  - ${settings.defaultConversationTag}
---

${chatContent}`;

      // Check if the file already exists
      const existingFile = app.vault.getAbstractFileByPath(noteFileName);
      if (existingFile instanceof TFile) {
        // If the file exists, update its content
        await app.vault.modify(existingFile, noteContentWithTimestamp);
        new Notice(`Chat updated in existing note: ${noteFileName}`);
      } else {
        // If the file doesn't exist, create a new one
        await app.vault.create(noteFileName, noteContentWithTimestamp);
        new Notice(`Chat saved as new note: ${noteFileName}`);
      }

      if (openNote) {
        const file = app.vault.getAbstractFileByPath(noteFileName);
        if (file instanceof TFile) {
          const leaf = app.workspace.getLeaf();
          leaf.openFile(file);
        }
      }
    } catch (error) {
      console.error("Error saving chat as note:", error);
      new Notice("Failed to save chat as note. Check console for details.");
    }
  };

  // Function to refresh the vault context
  const refreshVaultContext = async () => {
    if (!app) {
      console.error("App instance is not available.");
      return;
    }

    try {
      await plugin.vectorStoreManager.indexVaultToVectorStore();
      new Notice("Vault index refreshed.");
    } catch (error) {
      console.error("Error refreshing vault index:", error);
      new Notice("Failed to refresh vault index. Check console for details.");
    }
  };

  // Function to clear the current AI message
  const clearCurrentAiMessage = () => {
    setCurrentAiMessage("");
  };

  // Function to stop generating a response
  const handleStopGenerating = (reason?: ABORT_REASON) => {
    if (abortController) {
      if (plugin.settings.debug) {
        console.log(`stopping generation..., reason: ${reason}`);
      }
      abortController.abort(reason);
      setLoading(false);
    }
  };

  // Function to regenerate a message
  const handleRegenerate = async (messageIndex: number) => {
    const lastUserMessageIndex = messageIndex - 1;

    if (lastUserMessageIndex < 0 || chatHistory[lastUserMessageIndex].sender !== USER_SENDER) {
      new Notice("Cannot regenerate the first message or a user message.");
      return;
    }

    // Get the last user message
    const lastUserMessage = chatHistory[lastUserMessageIndex];

    // Remove all messages after the AI message to regenerate
    const newChatHistory = chatHistory.slice(0, messageIndex);
    clearMessages();
    newChatHistory.forEach(addMessage);

    // Update the chain's memory with the new chat history
    chainManager.memoryManager.clearChatMemory();
    for (let i = 0; i < newChatHistory.length; i += 2) {
      const userMsg = newChatHistory[i];
      const aiMsg = newChatHistory[i + 1];
      if (userMsg && aiMsg) {
        await chainManager.memoryManager
          .getMemory()
          .saveContext({ input: userMsg.message }, { output: aiMsg.message });
      }
    }

    setLoading(true);
    try {
      const regeneratedResponse = await chainManager.runChain(
        lastUserMessage.message,
        new AbortController(),
        setCurrentAiMessage,
        addMessage,
        { debug }
      );
      if (regeneratedResponse && debug) {
        console.log("Message regenerated successfully");
      }
    } catch (error) {
      console.error("Error regenerating message:", error);
      new Notice("Failed to regenerate message. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Function to edit a message
  const handleEdit = async (messageIndex: number, newMessage: string) => {
    const oldMessage = chatHistory[messageIndex].message;

    // Check if the message has actually changed
    if (oldMessage === newMessage) {
      return; // Exit the function if the message hasn't changed
    }

    const newChatHistory = [...chatHistory];
    newChatHistory[messageIndex].message = newMessage;
    clearMessages();
    newChatHistory.forEach(addMessage);

    // Update the chain's memory with the new chat history
    await updateChatMemory(newChatHistory, chainManager.memoryManager);

    // Trigger regeneration of the AI message if the edited message was from the user
    if (
      newChatHistory[messageIndex].sender === USER_SENDER &&
      messageIndex < newChatHistory.length - 1
    ) {
      handleRegenerate(messageIndex + 1);
    }
  };

  // Effect to handle token counting on selection
  useEffect(() => {
    async function handleSelection(event: CustomEvent) {
      const wordCount = event.detail.selectedText.split(" ").length;
      const tokenCount = await chainManager.chatModelManager.countTokens(event.detail.selectedText);
      const tokenCountMessage: ChatMessage = {
        sender: AI_SENDER,
        message: `The selected text contains ${wordCount} words and ${tokenCount} tokens.`,
        isVisible: true,
        timestamp: formatDateTime(new Date()),
      };
      addMessage(tokenCountMessage);
    }

    emitter.addEventListener("countTokensSelection", handleSelection);

    // Cleanup function to remove the event listener when the component unmounts
    return () => {
      emitter.removeEventListener("countTokensSelection", handleSelection);
    };
  }, []);

  // Function to create an effect for each event type (Copilot command on selected text)
  const createEffect = (
    eventType: string,
    promptFn: (selectedText: string, eventSubtype?: string) => string | Promise<string>,
    options: CreateEffectOptions = {}
  ) => {
    return () => {
      const {
        isVisible = false,
        ignoreSystemMessage = true, // Ignore system message by default for commands
      } = options;
      const handleSelection = async (event: CustomEvent) => {
        const messageWithPrompt = await promptFn(
          event.detail.selectedText,
          event.detail.eventSubtype
        );
        // Create a user message with the selected text
        const promptMessage: ChatMessage = {
          message: messageWithPrompt,
          sender: USER_SENDER,
          isVisible: isVisible,
          timestamp: formatDateTime(new Date()),
        };

        if (isVisible) {
          addMessage(promptMessage);
        }

        setLoading(true);
        await getAIResponse(
          promptMessage,
          chainManager,
          addMessage,
          setCurrentAiMessage,
          setAbortController,
          {
            debug,
            ignoreSystemMessage,
          }
        );
        setLoading(false);
      };

      emitter.addEventListener(eventType, handleSelection);

      // Cleanup function to remove the event listener when the component unmounts
      return () => {
        emitter.removeEventListener(eventType, handleSelection);
      };
    };
  };

  // Effects for various selection-based commands
  useEffect(createEffect("fixGrammarSpellingSelection", fixGrammarSpellingSelectionPrompt), []);
  useEffect(createEffect("summarizeSelection", summarizePrompt), []);
  useEffect(createEffect("tocSelection", tocPrompt), []);
  useEffect(createEffect("glossarySelection", glossaryPrompt), []);
  useEffect(createEffect("simplifySelection", simplifyPrompt), []);
  useEffect(createEffect("emojifySelection", emojifyPrompt), []);
  useEffect(createEffect("removeUrlsFromSelection", removeUrlsFromSelectionPrompt), []);
  useEffect(
    createEffect("rewriteTweetSelection", rewriteTweetSelectionPrompt, { custom_temperature: 0.2 }),
    []
  );
  useEffect(
    createEffect("rewriteTweetThreadSelection", rewriteTweetThreadSelectionPrompt, {
      custom_temperature: 0.2,
    }),
    []
  );
  useEffect(createEffect("rewriteShorterSelection", rewriteShorterSelectionPrompt), []);
  useEffect(createEffect("rewriteLongerSelection", rewriteLongerSelectionPrompt), []);
  useEffect(createEffect("eli5Selection", eli5SelectionPrompt), []);
  useEffect(createEffect("rewritePressReleaseSelection", rewritePressReleaseSelectionPrompt), []);
  useEffect(
    createEffect("translateSelection", (selectedText, language) =>
      createTranslateSelectionPrompt(language)(selectedText)
    ),
    []
  );
  useEffect(
    createEffect("changeToneSelection", (selectedText, tone) =>
      createChangeToneSelectionPrompt(tone)(selectedText)
    ),
    []
  );

  // Custom prompt processor effect
  const customPromptProcessor = CustomPromptProcessor.getInstance(app.vault, settings);
  useEffect(
    createEffect(
      "applyCustomPrompt",
      async (selectedText, customPrompt) => {
        if (!customPrompt) {
          return selectedText;
        }
        return await customPromptProcessor.processCustomPrompt(
          customPrompt,
          selectedText,
          app.workspace.getActiveFile() as TFile | undefined
        );
      },
      { isVisible: debug, ignoreSystemMessage: true, custom_temperature: 0.1 }
    ),
    []
  );

  // Ad-hoc prompt processor effect
  useEffect(
    createEffect(
      "applyAdhocPrompt",
      async (selectedText, customPrompt) => {
        if (!customPrompt) {
          return selectedText;
        }
        return await customPromptProcessor.processCustomPrompt(
          customPrompt,
          selectedText,
          app.workspace.getActiveFile() as TFile | undefined
        );
      },
      { isVisible: debug, ignoreSystemMessage: true, custom_temperature: 0.1 }
    ),
    []
  );

  // Function to insert a message at the cursor in the active note
  const handleInsertAtCursor = async (message: string) => {
    let leaf = app.workspace.getMostRecentLeaf();
    if (!leaf) {
      new Notice("No active leaf found.");
      return;
    }

    if (!(leaf.view instanceof MarkdownView)) {
      leaf = app.workspace.getLeaf(false);
      await leaf.setViewState({ type: "markdown", state: leaf.view.getState() });
    }

    if (!(leaf.view instanceof MarkdownView)) {
      new Notice("Failed to open a markdown view.");
      return;
    }

    const editor = leaf.view.editor;
    const cursor = editor.getCursor();
    editor.replaceRange(message, cursor);
    new Notice("Message inserted into the active note.");
  };

  // Expose handleSaveAsNote to parent
  useEffect(() => {
    if (onSaveChat) {
      onSaveChat(handleSaveAsNote);
    }
  }, [onSaveChat]);

  // Function to delete a message
  const handleDelete = async (messageIndex: number) => {
    const newChatHistory = [...chatHistory];
    newChatHistory.splice(messageIndex, 1);
    clearMessages();
    newChatHistory.forEach(addMessage);

    // Update the chain's memory with the new chat history
    await updateChatMemory(newChatHistory, chainManager.memoryManager);
  };

  return (
    <div className="chat-container">
      <div className="header">
      <strong>YAY GO KATHY</strong>
    </div>
      <div className="top-container">
        <ChatSessionIcons
          currentModelKey={currentModelKey}
          setCurrentModelKey={setModelKey}
          onNewChat={async (openNote: boolean) => {
            handleStopGenerating(ABORT_REASON.NEW_CHAT);
            if (settings.autosaveChat && chatHistory.length > 0) {
              await handleSaveAsNote(openNote);
            }
            clearMessages();
            clearChatMemory();
            clearCurrentAiMessage();
          }}
          onRefreshVaultContext={refreshVaultContext}
          onFindSimilarNotes={(content, activeFilePath) =>
            plugin.findSimilarNotes(content, activeFilePath)
          }
          addMessage={addMessage}
          settings={settings}
          vault={app.vault}
          vault_qa_strategy={plugin.settings.indexVaultToVectorStore}
          debug={debug}
        />
        <ChatInputTop
            inputMessage={inputMessageTop}
            setInputMessage={setInputMessageTop}
            handleSendMessage={handleSendMessage}
            isGenerating={loading}
            onStopGenerating={() => handleStopGenerating(ABORT_REASON.USER_STOPPED)}
            app={app}
            settings={settings}
            navigateHistory={navigateHistory}
            chatIsVisible={chatIsVisible}
          />
        {/* ChatIcons component for chat controls */}
        
        </div>
      <ChatMessages
        chatHistory={chatHistory}
        currentAiMessage={currentAiMessage}
        loading={loading}
        app={app}
        onInsertAtCursor={handleInsertAtCursor}
        onRegenerate={handleRegenerate}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
      <div className="bottom-container">

        {/* ChatInput component for user input */}
        <ChatInputFollowup
          inputMessage={inputMessageBottom}
          setInputMessage={setInputMessageBottom}
          handleSendMessage={handleSendMessage}
          isGenerating={loading}
          onStopGenerating={() => handleStopGenerating(ABORT_REASON.USER_STOPPED)}
          app={app}
          settings={settings}
          navigateHistory={navigateHistory}
          chatIsVisible={chatIsVisible}
        />
      </div>
    </div>
  );
};

export default Chat;