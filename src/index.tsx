import { ActionPanel, List, Action, showToast, Toast, Icon, LocalStorage } from "@raycast/api";
import { exec } from "child_process";
import { readdirSync, existsSync } from "fs";
import { homedir } from "os";
import { useState, useEffect } from "react";
import { join } from "path";

// Update this path to your projects folder
const BASE_FOLDER = `${homedir()}/Sites`;

const FAVORITES_KEY = "favorites";
const RECENT_PROJECTS_KEY = "recent_projects";
const MAX_RECENT_PROJECTS = 10;

interface Folder {
  name: string;
  path: string;
  projectType?: "ddev" | "astro" | "unknown";
  isFavorite?: boolean;
  lastOpened?: number;
}

function detectProjectType(folderPath: string): "ddev" | "astro" | "unknown" {
  // Check for DDEV project
  const ddevConfigPath = join(folderPath, ".ddev", "config.yaml");
  if (existsSync(ddevConfigPath)) {
    return "ddev";
  }

  // Check for Astro project
  const packageJsonPath = join(folderPath, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = require(packageJsonPath);
      if (packageJson.dependencies?.astro || packageJson.devDependencies?.astro) {
        return "astro";
      }
    } catch (error) {
      // If we can't read package.json, continue
    }
  }

  return "unknown";
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        // Load favorites and recent projects
        const favoritesData = await LocalStorage.getItem<string>(FAVORITES_KEY);
        const recentData = await LocalStorage.getItem<string>(RECENT_PROJECTS_KEY);

        const loadedFavorites = favoritesData ? JSON.parse(favoritesData) : [];
        const loadedRecent = recentData ? JSON.parse(recentData) : [];

        setFavorites(loadedFavorites);
        setRecentProjects(loadedRecent);

        // Load folders
        const allFolders = readdirSync(BASE_FOLDER, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .filter((dirent) => !dirent.name.startsWith("."))
          .map((dirent) => {
            const folderPath = `${BASE_FOLDER}/${dirent.name}`;
            return {
              name: dirent.name,
              path: folderPath,
              projectType: detectProjectType(folderPath),
              isFavorite: loadedFavorites.includes(dirent.name),
            };
          })
          .sort((a, b) => {
            // Sort: favorites first, then recent, then alphabetical
            if (a.isFavorite && !b.isFavorite) return -1;
            if (!a.isFavorite && b.isFavorite) return 1;

            const aRecentIndex = loadedRecent.indexOf(a.name);
            const bRecentIndex = loadedRecent.indexOf(b.name);

            if (aRecentIndex !== -1 && bRecentIndex === -1) return -1;
            if (aRecentIndex === -1 && bRecentIndex !== -1) return 1;
            if (aRecentIndex !== -1 && bRecentIndex !== -1) {
              return aRecentIndex - bRecentIndex;
            }

            return a.name.localeCompare(b.name);
          });

        setFolders(allFolders);
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to read folders",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  const filteredFolders = folders.filter((folder) =>
    folder.name.toLowerCase().includes(searchText.toLowerCase())
  );

  async function toggleFavorite(folder: Folder) {
    const newFavorites = folder.isFavorite
      ? favorites.filter((name) => name !== folder.name)
      : [...favorites, folder.name];

    setFavorites(newFavorites);
    await LocalStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));

    // Update the folder in the list
    setFolders((prevFolders) =>
      prevFolders
        .map((f) => (f.name === folder.name ? { ...f, isFavorite: !f.isFavorite } : f))
        .sort((a, b) => {
          // Re-sort after toggling favorite
          if (a.isFavorite && !b.isFavorite) return -1;
          if (!a.isFavorite && b.isFavorite) return 1;

          const aRecentIndex = recentProjects.indexOf(a.name);
          const bRecentIndex = recentProjects.indexOf(b.name);

          if (aRecentIndex !== -1 && bRecentIndex === -1) return -1;
          if (aRecentIndex === -1 && bRecentIndex !== -1) return 1;
          if (aRecentIndex !== -1 && bRecentIndex !== -1) {
            return aRecentIndex - bRecentIndex;
          }

          return a.name.localeCompare(b.name);
        })
    );

    await showToast({
      style: Toast.Style.Success,
      title: folder.isFavorite ? `Removed ${folder.name} from favorites` : `Added ${folder.name} to favorites`,
    });
  }

  async function addToRecent(folder: Folder) {
    const newRecent = [folder.name, ...recentProjects.filter((name) => name !== folder.name)].slice(
      0,
      MAX_RECENT_PROJECTS
    );

    setRecentProjects(newRecent);
    await LocalStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(newRecent));
  }

  async function openInCursor(folder: Folder) {
    await addToRecent(folder);
    exec(`cursor "${folder.path}"`, async (error) => {
      if (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to open folder",
          message: error.message,
        });
        return;
      }

      await showToast({
        style: Toast.Style.Success,
        title: `Opened ${folder.name}`,
      });
    });
  }

  async function openInITerm(folder: Folder) {
    const projectType = folder.projectType || "unknown";
    let command = `cd "${folder.path}"`;

    // Add the appropriate dev command based on project type
    if (projectType === "ddev") {
      command += " && ddev npm run dev";
    } else if (projectType === "astro") {
      command += " && npm run dev";
    }

    const script = `
      tell application "iTerm"
        create window with default profile
        tell current session of current window
          write text "${command.replace(/"/g, '\\"')}"
        end tell
      end tell
    `;

    exec(`osascript -e '${script}'`, async (error) => {
      if (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to open iTerm",
          message: error.message,
        });
        return;
      }

      const projectTypeLabel = projectType === "ddev" ? " (DDEV)" : projectType === "astro" ? " (Astro)" : "";
      await showToast({
        style: Toast.Style.Success,
        title: `Opened ${folder.name} in iTerm${projectTypeLabel}`,
      });
    });
  }

  async function openInChrome(folder: Folder) {
    const projectType = folder.projectType || "unknown";
    let url = "";

    if (projectType === "ddev") {
      url = `https://${folder.name}.ddev.site`;
    } else if (projectType === "astro") {
      url = "http://localhost:4321/";
    }

    if (!url) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Cannot open in Chrome",
        message: "Unknown project type",
      });
      return;
    }

    exec(`open -a "Google Chrome" "${url}"`, async (error) => {
      if (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to open Chrome",
          message: error.message,
        });
      } else {
        await showToast({
          style: Toast.Style.Success,
          title: `Opened ${url} in Chrome`,
        });
      }
    });
  }

  async function openProject(folder: Folder) {
    // Open Cursor, iTerm, and Chrome
    openInCursor(folder);
    openInITerm(folder);
    openInChrome(folder);
  }

  // Categorize folders
  const favoriteFolders = filteredFolders.filter((f) => f.isFavorite);
  const recentFolders = filteredFolders.filter(
    (f) => !f.isFavorite && recentProjects.includes(f.name)
  );
  const otherFolders = filteredFolders.filter(
    (f) => !f.isFavorite && !recentProjects.includes(f.name)
  );

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search folders... (e.g., 'orp' for 'orpheum')"
      onSearchTextChange={setSearchText}
      throttle
    >
      {filteredFolders.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Folder}
          title="No folders found"
          description={searchText ? `No matches for "${searchText}"` : "No folders in this directory"}
        />
      ) : (
        <>
          {favoriteFolders.length > 0 && (
            <List.Section title="Favorites" subtitle={`${favoriteFolders.length} projects`}>
              {favoriteFolders.map((folder) => (
                <FolderListItem key={folder.name} folder={folder} recentProjects={recentProjects} toggleFavorite={toggleFavorite} openProject={openProject} openInCursor={openInCursor} openInITerm={openInITerm} openInChrome={openInChrome} />
              ))}
            </List.Section>
          )}

          {recentFolders.length > 0 && (
            <List.Section title="Recent" subtitle={`${recentFolders.length} projects`}>
              {recentFolders.map((folder) => (
                <FolderListItem key={folder.name} folder={folder} recentProjects={recentProjects} toggleFavorite={toggleFavorite} openProject={openProject} openInCursor={openInCursor} openInITerm={openInITerm} openInChrome={openInChrome} />
              ))}
            </List.Section>
          )}

          {otherFolders.length > 0 && (
            <List.Section title="All Projects" subtitle={`${otherFolders.length} projects`}>
              {otherFolders.map((folder) => (
                <FolderListItem key={folder.name} folder={folder} recentProjects={recentProjects} toggleFavorite={toggleFavorite} openProject={openProject} openInCursor={openInCursor} openInITerm={openInITerm} openInChrome={openInChrome} />
              ))}
            </List.Section>
          )}
        </>
      )}
    </List>
  );
}

interface FolderListItemProps {
  folder: Folder;
  recentProjects: string[];
  toggleFavorite: (folder: Folder) => void;
  openProject: (folder: Folder) => void;
  openInCursor: (folder: Folder) => void;
  openInITerm: (folder: Folder) => void;
  openInChrome: (folder: Folder) => void;
}

function FolderListItem({ folder, recentProjects, toggleFavorite, openProject, openInCursor, openInITerm, openInChrome }: FolderListItemProps) {
  const accessories = [];

  // Add favorite indicator
  if (folder.isFavorite) {
    accessories.push({ icon: Icon.Star, tooltip: "Favorite" });
  }

  // Add project type tag
  if (folder.projectType === "ddev") {
    accessories.push({ tag: { value: "DDEV", color: "#2563eb" } });
  } else if (folder.projectType === "astro") {
    accessories.push({ tag: { value: "Astro", color: "#dc2626" } });
  }

  // Add recent indicator
  const recentIndex = recentProjects.indexOf(folder.name);
  if (recentIndex !== -1 && recentIndex < 5 && !folder.isFavorite) {
    accessories.push({ icon: Icon.Clock, tooltip: "Recently opened" });
  }

  return (
    <List.Item
      key={folder.name}
      title={folder.name}
      icon={folder.isFavorite ? Icon.Star : Icon.Folder}
      accessories={accessories}
      actions={
        <ActionPanel>
          <Action title="Open Project" onAction={() => openProject(folder)} icon={Icon.Rocket} />
          <Action
            title={folder.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
            onAction={() => toggleFavorite(folder)}
            icon={folder.isFavorite ? Icon.StarDisabled : Icon.Star}
            shortcut={{ modifiers: ["cmd"], key: "f" }}
          />
          <Action title="Open in Cursor Only" onAction={() => openInCursor(folder)} icon={Icon.Code} shortcut={{ modifiers: ["cmd", "shift"], key: "return" }} />
          <Action title="Open in iTerm Only" onAction={() => openInITerm(folder)} icon={Icon.Terminal} />
          <Action title="Open in Chrome Only" onAction={() => openInChrome(folder)} icon={Icon.Globe} />
          <Action.ShowInFinder path={folder.path} />
          <Action.CopyToClipboard title="Copy Path" content={folder.path} />
        </ActionPanel>
      }
    />
  );
}