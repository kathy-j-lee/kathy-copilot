import { CustomModel, SetChainOptions } from "@/aiParams";
import { CopilotPlusModal } from "@/components/CopilotPlusModal";
import { SimilarNotesModal } from "@/components/SimilarNotesModal";
import { AI_SENDER, VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { CustomError } from "@/error";
import { CopilotSettings } from "@/settings/SettingsPage";
import { ChatMessage } from "@/sharedState";
import { formatDateTime } from "@/utils";
import { Notice, Vault } from "obsidian";
import React, { useEffect, useState } from "react";

import { ChainType } from "@/chainFactory";
import {
  ConnectionIcon,
  RefreshIcon,
  PlusIcon,
  SaveAsNoteIcon,
  UseActiveNoteAsContextIcon,
} from "@/components/Icons";
import { stringToChainType } from "@/utils";

interface ChatSessionIconsProps {
  currentModelKey: string;
  setCurrentModelKey: (modelKey: string) => void;
  onNewChat: (openNote: boolean) => void;
  onRefreshVaultContext: () => void;
  onFindSimilarNotes: (content: string, activeFilePath: string) => Promise<any>;
  addMessage: (message: ChatMessage) => void;
  settings: CopilotSettings;
  vault: Vault;
  vault_qa_strategy: string;
  debug?: boolean;
}

const ChatSessionIcons: React.FC<ChatSessionIconsProps> = ({
  currentModelKey,
  setCurrentModelKey,
  onNewChat,
  onRefreshVaultContext,
  onFindSimilarNotes,
  addMessage,
  settings,
  vault,
  vault_qa_strategy,
  debug,
}) => {
  const getModelKey = (model: CustomModel) => `${model.name}|${model.provider}`;

  const handleModelChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedModelKey = event.target.value;
    setCurrentModelKey(selectedModelKey);
  };

  const handleFindSimilarNotes = async () => {
    const activeFile = app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    const activeNoteContent = await app.vault.cachedRead(activeFile);
    const similarChunks = await onFindSimilarNotes(activeNoteContent, activeFile.path);
    new SimilarNotesModal(app, similarChunks).open();
  };

  return (
    <div className="chat-session-icons-container">
      <div className="chat-icon-selection-tooltip">
        <div className="select-wrapper">
          <select
            id="aiModelSelect"
            className="chat-icon-selection model-select"
            value={currentModelKey}
            onChange={handleModelChange}
          >
            {settings.activeModels
              .filter((model) => model.enabled)
              .map((model) => (
                <option key={getModelKey(model)} value={getModelKey(model)}>
                  {model.name}
                </option>
              ))}
          </select>
          <span className="tooltip-text">Model Selection</span>
        </div>
      </div>
      <button className="chat-icon-button clickable-icon" onClick={() => onNewChat(false)}>
        <PlusIcon className="icon-scaler" />
        <span className="tooltip-text">
          New Chat
          <br />
          (unsaved history will be lost)
        </span>
      </button>
      <button className="chat-icon-button clickable-icon" onClick={onRefreshVaultContext}>
        <UseActiveNoteAsContextIcon className="icon-scaler" />
        <span className="tooltip-text">
          Refresh Index
          <br />
          for Vault
        </span>
      </button>
      <button className="chat-icon-button clickable-icon" onClick={handleFindSimilarNotes}>
        <ConnectionIcon className="icon-scaler" />
        <span className="tooltip-text">Find Similar Notes for Active Note</span>
      </button>
    </div>
  );
};

export default ChatSessionIcons;
