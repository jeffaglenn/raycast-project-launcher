import {
  ActionPanel,
  List,
  Action,
  showToast,
  Toast,
  Icon,
  LocalStorage,
  getPreferenceValues,
  useNavigation,
} from "@raycast/api";
import { exec } from "child_process";
import { readdirSync, existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { useState, useEffect } from "react";
import { join, relative, dirname } from "path";

const FAVORITES_KEY = "favorites";
const RECENT_PROJECTS_KEY = "recent_projects";
const MAX_RECENT_PROJECTS = 10;

function getBaseFolder(): string {
  const { projectsDirectory } = getPreferenceValues<Preferences>();
  const configured = projectsDirectory?.trim();
  if (!configured) {
    return join(homedir(), "Projects");
  }
  // fs doesn't expand "~", but the preference default does use it
  return configured.startsWith("~") ? join(homedir(), configured.slice(1)) : configured;
}

const BASE_FOLDER = getBaseFolder();

interface Folder {
  /** Folder name, e.g. "roi" */
  name: string;
  /** Absolute path */
  path: string;
  /** Path relative to BASE_FOLDER, e.g. "brother/roi". Stable identity for favorites/recents. */
  id: string;
  projectType?: "ddev" | "astro" | "unknown";
  isFavorite?: boolean;
}

function toId(folderPath: string): string {
  return relative(BASE_FOLDER, folderPath);
}

/** The containing folder, e.g. "brother" for "brother/roi". Empty for top-level projects. */
function parentLabel(id: string): string {
  const parent = dirname(id);
  return parent === "." ? "" : parent;
}

function isNested(id: string): boolean {
  return parentLabel(id) !== "";
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
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (packageJson.dependencies?.astro || packageJson.devDependencies?.astro) {
        return "astro";
      }
    } catch (error) {
      // If we can't read package.json, continue
    }
  }

  return "unknown";
}

/** DDEV project names don't have to match the folder name, so read it from the config. */
function getDdevProjectName(folderPath: string): string | undefined {
  const ddevConfigPath = join(folderPath, ".ddev", "config.yaml");
  try {
    const config = readFileSync(ddevConfigPath, "utf8");
    const match = config.match(/^name:\s*["']?([^"'\s#]+)["']?/m);
    return match?.[1];
  } catch (error) {
    return undefined;
  }
}

function readFolders(parentPath: string, favorites: string[]): Folder[] {
  return readdirSync(parentPath, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .filter((dirent) => !dirent.name.startsWith("."))
    .map((dirent) => toFolder(join(parentPath, dirent.name), favorites));
}

function toFolder(folderPath: string, favorites: string[]): Folder {
  const id = toId(folderPath);
  return {
    name: folderPath.split("/").pop() || id,
    path: folderPath,
    id,
    projectType: detectProjectType(folderPath),
    isFavorite: favorites.includes(id),
  };
}

/**
 * Favorites and recents can live in subfolders, which the root scan never reaches.
 * Resolve those directly so they still surface on the first screen.
 */
function readNestedPinned(favorites: string[], recent: string[]): Folder[] {
  const ids = [...new Set([...favorites, ...recent])].filter(isNested);

  return ids
    .filter((id) => {
      const folderPath = join(BASE_FOLDER, id);
      try {
        return existsSync(folderPath) && statSync(folderPath).isDirectory();
      } catch (error) {
        return false;
      }
    })
    .map((id) => toFolder(join(BASE_FOLDER, id), favorites));
}

function sortFolders(folders: Folder[], recent: string[]): Folder[] {
  return [...folders].sort((a, b) => {
    // Sort: favorites first, then recent, then alphabetical
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;

    const aRecentIndex = recent.indexOf(a.id);
    const bRecentIndex = recent.indexOf(b.id);

    if (aRecentIndex !== -1 && bRecentIndex === -1) return -1;
    if (aRecentIndex === -1 && bRecentIndex !== -1) return 1;
    if (aRecentIndex !== -1 && bRecentIndex !== -1) {
      return aRecentIndex - bRecentIndex;
    }

    return a.name.localeCompare(b.name);
  });
}

async function addToRecent(folder: Folder) {
  const recentData = await LocalStorage.getItem<string>(RECENT_PROJECTS_KEY);
  const recent: string[] = recentData ? JSON.parse(recentData) : [];
  const newRecent = [folder.id, ...recent.filter((id) => id !== folder.id)].slice(0, MAX_RECENT_PROJECTS);
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
      title: `Opened ${folder.id}`,
    });
  });
}

async function openInITerm(folder: Folder, { withClaudeCode = false } = {}) {
  const projectType = folder.projectType || "unknown";
  let command = `cd "${folder.path}"`;

  // Add the appropriate dev command based on project type
  if (projectType === "ddev") {
    command += " && ddev npm run dev";
  } else if (projectType === "astro") {
    command += " && npm run dev";
  }

  const escapedPath = folder.path.replace(/"/g, '\\"');
  const escapedCommand = command.replace(/"/g, '\\"');

  const claudeTabScript = withClaudeCode
    ? `
        tell newWindow
          create tab with default profile
          tell current session
            write text "cd \\"${escapedPath}\\" && claude"
          end tell
          create tab with default profile
          tell current session
            write text "cd \\"${escapedPath}\\""
          end tell
        end tell
      `
    : "";

  const script = `
    tell application "iTerm"
      set newWindow to (create window with default profile)
      tell current session of newWindow
        write text "${escapedCommand}"
      end tell
      ${claudeTabScript}
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
      title: `Opened ${folder.id} in iTerm${projectTypeLabel}${withClaudeCode ? " + Claude Code" : ""}`,
    });
  });
}

async function openITermTab(folder: Folder) {
  const escapedPath = folder.path.replace(/"/g, '\\"');
  const script = `
    tell application "iTerm"
      if (count of windows) > 0 then
        tell current window
          create tab with default profile
          tell current session
            write text "cd \\"${escapedPath}\\""
          end tell
        end tell
      else
        create window with default profile
        tell current session of current window
          write text "cd \\"${escapedPath}\\""
        end tell
      end if
    end tell
  `;

  exec(`osascript -e '${script}'`, async (error) => {
    if (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to open iTerm tab",
        message: error.message,
      });
      return;
    }
    await showToast({
      style: Toast.Style.Success,
      title: `Opened ${folder.id} in new iTerm tab`,
    });
  });
}

async function openClaudeCode(folder: Folder) {
  const escapedPath = folder.path.replace(/"/g, '\\"');
  const script = `
    tell application "iTerm"
      if (count of windows) > 0 then
        tell current window
          create tab with default profile
          tell current session
            write text "cd \\"${escapedPath}\\" && claude"
          end tell
        end tell
      else
        create window with default profile
        tell current session of current window
          write text "cd \\"${escapedPath}\\" && claude"
        end tell
      end if
    end tell
  `;

  exec(`osascript -e '${script}'`, async (error) => {
    if (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to open Claude Code",
        message: error.message,
      });
      return;
    }

    await showToast({
      style: Toast.Style.Success,
      title: `Started Claude Code in ${folder.id}`,
    });
  });
}

async function openInSafari(folder: Folder) {
  const projectType = folder.projectType || "unknown";
  let url = "";

  if (projectType === "ddev") {
    url = `https://${getDdevProjectName(folder.path) || folder.name}.ddev.site`;
  } else if (projectType === "astro") {
    url = "http://localhost:4321/";
  }

  if (!url) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Cannot open in Safari",
      message: "Unknown project type",
    });
    return;
  }

  exec(`open -a "Safari" "${url}"`, async (error) => {
    if (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to open Safari",
        message: error.message,
      });
    } else {
      await showToast({
        style: Toast.Style.Success,
        title: `Opened ${url} in Safari`,
      });
    }
  });
}

async function openProject(folder: Folder) {
  // Open Cursor, iTerm (with Claude Code tab), and Safari
  openInCursor(folder);
  openInITerm(folder, { withClaudeCode: true });
  openInSafari(folder);
}

function ProjectList({ parentPath, isRoot = true }: { parentPath: string; isRoot?: boolean }) {
  const { pop } = useNavigation();
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

        const loadedFavorites: string[] = favoritesData ? JSON.parse(favoritesData) : [];
        const loadedRecent: string[] = recentData ? JSON.parse(recentData) : [];

        setFavorites(loadedFavorites);
        setRecentProjects(loadedRecent);

        const scanned = readFolders(parentPath, loadedFavorites);
        const visible = isRoot ? [...scanned, ...readNestedPinned(loadedFavorites, loadedRecent)] : scanned;

        setFolders(sortFolders(visible, loadedRecent));
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
  }, [parentPath, isRoot]);

  const filteredFolders = folders.filter((folder) =>
    folder.id.toLowerCase().includes(searchText.toLowerCase())
  );

  async function toggleFavorite(folder: Folder) {
    const newFavorites = folder.isFavorite
      ? favorites.filter((id) => id !== folder.id)
      : [...favorites, folder.id];

    setFavorites(newFavorites);
    await LocalStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));

    setFolders((prevFolders) =>
      sortFolders(
        prevFolders.map((f) => (f.id === folder.id ? { ...f, isFavorite: !f.isFavorite } : f)),
        recentProjects
      )
    );

    await showToast({
      style: Toast.Style.Success,
      title: folder.isFavorite ? `Removed ${folder.id} from favorites` : `Added ${folder.id} to favorites`,
    });
  }

  // Categorize folders — sections only at the root level
  const favoriteFolders = filteredFolders.filter((f) => f.isFavorite);
  const recentFolders = filteredFolders.filter((f) => !f.isFavorite && recentProjects.includes(f.id));
  // Nested entries only appear at root because they're pinned; once unpinned they
  // don't belong in "All Projects" alongside the actual top-level folders.
  const otherFolders = filteredFolders.filter(
    (f) => !f.isFavorite && !recentProjects.includes(f.id) && !isNested(f.id)
  );

  function renderItem(folder: Folder) {
    return (
      <FolderListItem
        key={folder.id}
        folder={folder}
        recentProjects={recentProjects}
        toggleFavorite={toggleFavorite}
        isRoot={isRoot}
      />
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search folders... (e.g., 'orp' for 'orpheum')"
      onSearchTextChange={setSearchText}
      navigationTitle={isRoot ? undefined : toId(parentPath)}
      throttle
    >
      {filteredFolders.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Folder}
          title="No folders found"
          description={searchText ? `No matches for "${searchText}"` : "No folders in this directory"}
          actions={
            // Without this the list has no ActionPanel at all, leaving an empty
            // subfolder with no way back out.
            <ActionPanel>
              {!isRoot && (
                <Action
                  title="Go Back"
                  icon={Icon.ArrowLeft}
                  shortcut={{ modifiers: [], key: "arrowLeft" }}
                  onAction={() => pop()}
                />
              )}
              <Action.ShowInFinder path={parentPath} />
              <Action.CopyToClipboard title="Copy Path" content={parentPath} />
            </ActionPanel>
          }
        />
      ) : isRoot ? (
        <>
          {favoriteFolders.length > 0 && (
            <List.Section title="Favorites" subtitle={`${favoriteFolders.length} projects`}>
              {favoriteFolders.map(renderItem)}
            </List.Section>
          )}

          {recentFolders.length > 0 && (
            <List.Section title="Recent" subtitle={`${recentFolders.length} projects`}>
              {recentFolders.map(renderItem)}
            </List.Section>
          )}

          {otherFolders.length > 0 && (
            <List.Section title="All Projects" subtitle={`${otherFolders.length} projects`}>
              {otherFolders.map(renderItem)}
            </List.Section>
          )}
        </>
      ) : (
        filteredFolders.map(renderItem)
      )}
    </List>
  );
}

export default function Command() {
  return <ProjectList parentPath={BASE_FOLDER} />;
}

interface FolderListItemProps {
  folder: Folder;
  recentProjects: string[];
  toggleFavorite: (folder: Folder) => void;
  isRoot: boolean;
}

function FolderListItem({ folder, recentProjects, toggleFavorite, isRoot }: FolderListItemProps) {
  const { push, pop } = useNavigation();
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
  const recentIndex = recentProjects.indexOf(folder.id);
  if (recentIndex !== -1 && recentIndex < 5 && !folder.isFavorite) {
    accessories.push({ icon: Icon.Clock, tooltip: "Recently opened" });
  }

  return (
    <List.Item
      key={folder.id}
      title={folder.name}
      // Inside a subfolder the parent is already the navigation title, so it'd just be noise.
      subtitle={isRoot ? parentLabel(folder.id) : ""}
      icon={folder.isFavorite ? Icon.Star : Icon.Folder}
      accessories={accessories}
      actions={
        <ActionPanel>
          <Action title="Open Project" onAction={() => openProject(folder)} icon={Icon.Rocket} />
          <Action
            title="Browse Subfolders"
            icon={Icon.ArrowRight}
            shortcut={{ modifiers: [], key: "arrowRight" }}
            onAction={() => push(<ProjectList parentPath={folder.path} isRoot={false} />)}
          />
          <Action
            title={folder.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
            onAction={() => toggleFavorite(folder)}
            icon={folder.isFavorite ? Icon.StarDisabled : Icon.Star}
            shortcut={{ modifiers: ["cmd"], key: "f" }}
          />
          <Action
            title="Open in Cursor Only"
            onAction={() => openInCursor(folder)}
            icon={Icon.Code}
            shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
          />
          <Action title="Open in iTerm Only" onAction={() => openInITerm(folder)} icon={Icon.Terminal} />
          <Action title="Open iTerm Tab" onAction={() => openITermTab(folder)} icon={Icon.Terminal} />
          <Action
            title="Open Claude Code"
            onAction={() => openClaudeCode(folder)}
            icon={Icon.Terminal}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
          <Action title="Open in Safari Only" onAction={() => openInSafari(folder)} icon={Icon.Globe} />
          <Action.ShowInFinder path={folder.path} />
          <Action.CopyToClipboard title="Copy Path" content={folder.path} />
          {!isRoot && (
            <Action
              title="Go Back"
              icon={Icon.ArrowLeft}
              shortcut={{ modifiers: [], key: "arrowLeft" }}
              onAction={() => pop()}
            />
          )}
        </ActionPanel>
      }
    />
  );
}
