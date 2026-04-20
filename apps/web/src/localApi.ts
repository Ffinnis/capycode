import type { ContextMenuItem, LocalApi } from "@capycode/contracts";

import { confirm as confirmDialog } from "./components/ui/confirmation-dialog.logic";
import { resetGitStatusStateForTests } from "./lib/gitStatusState";
import { resetRequestLatencyStateForTests } from "./rpc/requestLatencyState";
import { resetServerStateForTests } from "./rpc/serverState";
import { resetUsageStateForTests } from "./rpc/usageState";
import { resetWsConnectionStateForTests } from "./rpc/wsConnectionState";
import {
  resetSavedEnvironmentRegistryStoreForTests,
  resetSavedEnvironmentRuntimeStoreForTests,
} from "./environments/runtime";
import {
  getPrimaryEnvironmentConnection,
  resetEnvironmentServiceForTests,
} from "./environments/runtime";
import { type WsRpcClient } from "./rpc/wsRpcClient";
import { showContextMenuFallback } from "./contextMenuFallback";
import {
  readBrowserClientSettings,
  readBrowserSavedEnvironmentRegistry,
  readBrowserSavedEnvironmentSecret,
  removeBrowserSavedEnvironmentSecret,
  writeBrowserClientSettings,
  writeBrowserSavedEnvironmentRegistry,
  writeBrowserSavedEnvironmentSecret,
} from "./clientPersistenceStorage";

let cachedApi: LocalApi | undefined;

function missingRpcMethod(method: string) {
  return async () => {
    throw new Error(`Local API RPC method unavailable: ${method}`);
  };
}

export function createLocalApi(rpcClient: WsRpcClient): LocalApi {
  const desktopBridge = window.desktopBridge;

  return {
    dialogs: {
      pickFolder: async () => {
        if (typeof desktopBridge?.pickFolder !== "function") return null;
        return desktopBridge.pickFolder();
      },
      confirm: async (message) => {
        // Use in-app confirmation dialog instead of native dialogs
        return confirmDialog(message);
      },
    },
    shell: {
      openInEditor: (cwd, editor) => rpcClient.shell.openInEditor({ cwd, editor }),
      openExternal: async (url) => {
        if (typeof desktopBridge?.openExternal === "function") {
          const opened = await desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        return showContextMenuFallback(items, position);
      },
    },
    persistence: {
      getClientSettings: async () => {
        if (typeof desktopBridge?.getClientSettings === "function") {
          return desktopBridge.getClientSettings();
        }
        return readBrowserClientSettings();
      },
      setClientSettings: async (settings) => {
        if (typeof desktopBridge?.setClientSettings === "function") {
          return desktopBridge.setClientSettings(settings);
        }
        writeBrowserClientSettings(settings);
      },
      getSavedEnvironmentRegistry: async () => {
        if (typeof desktopBridge?.getSavedEnvironmentRegistry === "function") {
          return desktopBridge.getSavedEnvironmentRegistry();
        }
        return readBrowserSavedEnvironmentRegistry();
      },
      setSavedEnvironmentRegistry: async (records) => {
        if (typeof desktopBridge?.setSavedEnvironmentRegistry === "function") {
          return desktopBridge.setSavedEnvironmentRegistry(records);
        }
        writeBrowserSavedEnvironmentRegistry(records);
      },
      getSavedEnvironmentSecret: async (environmentId) => {
        if (typeof desktopBridge?.getSavedEnvironmentSecret === "function") {
          return desktopBridge.getSavedEnvironmentSecret(environmentId);
        }
        return readBrowserSavedEnvironmentSecret(environmentId);
      },
      setSavedEnvironmentSecret: async (environmentId, secret) => {
        if (typeof desktopBridge?.setSavedEnvironmentSecret === "function") {
          return desktopBridge.setSavedEnvironmentSecret(environmentId, secret);
        }
        return writeBrowserSavedEnvironmentSecret(environmentId, secret);
      },
      removeSavedEnvironmentSecret: async (environmentId) => {
        if (typeof desktopBridge?.removeSavedEnvironmentSecret === "function") {
          return desktopBridge.removeSavedEnvironmentSecret(environmentId);
        }
        removeBrowserSavedEnvironmentSecret(environmentId);
      },
    },
    server: {
      getConfig: (...args) => {
        const method = rpcClient.server?.getConfig;
        return typeof method === "function"
          ? method(...args)
          : missingRpcMethod("server.getConfig")();
      },
      refreshProviders: (...args) => {
        const method = rpcClient.server?.refreshProviders;
        return typeof method === "function"
          ? method(...args)
          : missingRpcMethod("server.refreshProviders")();
      },
      upsertKeybinding: (...args) => {
        const method = rpcClient.server?.upsertKeybinding;
        return typeof method === "function"
          ? method(...args)
          : missingRpcMethod("server.upsertKeybinding")();
      },
      getSettings: (...args) => {
        const method = rpcClient.server?.getSettings;
        return typeof method === "function"
          ? method(...args)
          : missingRpcMethod("server.getSettings")();
      },
      updateSettings: (...args) => {
        const method = rpcClient.server?.updateSettings;
        return typeof method === "function"
          ? method(...args)
          : missingRpcMethod("server.updateSettings")();
      },
    },
    usage: {
      getDashboard: (...args) => {
        const method = rpcClient.usage?.getDashboard;
        return typeof method === "function"
          ? method(...args)
          : missingRpcMethod("usage.getDashboard")();
      },
      refreshDashboard: (...args) => {
        const method = rpcClient.usage?.refreshDashboard;
        return typeof method === "function"
          ? method(...args)
          : missingRpcMethod("usage.refreshDashboard")();
      },
    },
  };
}

export function readLocalApi(): LocalApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    return cachedApi;
  }

  cachedApi = createLocalApi(getPrimaryEnvironmentConnection().client);
  return cachedApi;
}

export function ensureLocalApi(): LocalApi {
  const api = readLocalApi();
  if (!api) {
    throw new Error("Local API not found");
  }
  return api;
}

export async function __resetLocalApiForTests() {
  cachedApi = undefined;
  const { __resetClientSettingsPersistenceForTests } = await import("./hooks/useSettings");
  __resetClientSettingsPersistenceForTests();
  await resetEnvironmentServiceForTests();
  resetGitStatusStateForTests();
  resetRequestLatencyStateForTests();
  resetSavedEnvironmentRegistryStoreForTests();
  resetSavedEnvironmentRuntimeStoreForTests();
  resetServerStateForTests();
  resetUsageStateForTests();
  resetWsConnectionStateForTests();
}
