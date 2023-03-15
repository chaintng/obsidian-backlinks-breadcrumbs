const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    home: 'Home',
    maxDepth: '5',
    separator: '→',
    displayCurrentFile: false,
    showNoticeOnAmbiguity: true,
};

class BacklinksBreadcrumbsPlugin extends obsidian.Plugin {
    registerLayoutChangeEvent() {
        this.registerEvent(app.workspace.on('layout-change', () => {
            // This event fires when navigating from links and files
            this.drawBreadcrumbs();
        }));
    }

    registerMetadataCacheEvent() {
        const activeFile = app.workspace.getActiveFile();
        this.registerEvent(app.metadataCache.on('dataview:metadata-change', (type, file) => {
            // This event fires when Dataview metadata is updated,
            // Looks like every 2 seconds after the user types anything
            if (type === 'update' && file.path === activeFile.path) {
                this.drawBreadcrumbs();
            }
        }));
    }

    async onload() {
        console.log('loading Backlinks Breadcrumbs plugin');

        await this.loadSettings();

        this.addSettingTab(new BacklinksBreadcrumbsSettingTab(this.app, this));

        app.workspace.onLayoutReady(() => {
            this.registerLayoutChangeEvent();
            this.registerMetadataCacheEvent();
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    drawBreadcrumbs () {
        const file = app.workspace.getActiveFile();
        const backlinks = this.processBacklinks(file);
        const breadcrumbs = this.generateBreadCrumbs(backlinks);

        const activeMDView = app.workspace.getActiveViewOfType(obsidian.MarkdownView);

        // Destroy the backlinks breadcrumbs element if it exists
        activeMDView?.contentEl?.querySelector('.backlinks-breadcrumbs')?.remove();

        if (breadcrumbs && activeMDView) {
            const breadcrumbsEl = createDiv({
                cls: 'backlinks-breadcrumbs',
                attr: {
                    style: `
                        max-width: var(--file-line-width);
                        margin: 0 auto 0.5em auto;
                        font-size: var(--font-ui-small);
                        width: 100%;
                        color: var(--text-muted);
                    `,
                },
            });

            // Add each breadcrumb to the div
            breadcrumbs.forEach((l, i, a) => {
                breadcrumbsEl.appendChild(l);
                if (i < a.length - 1) breadcrumbsEl.append(` ${this.settings.separator} `);
            });

            // Add the div to the view
            const mode = activeMDView.getMode() || 'source';
            if (mode === 'source') {
                activeMDView.contentEl.querySelector('.cm-sizer').prepend(breadcrumbsEl);
            } else {
                activeMDView.contentEl.querySelector('.markdown-preview-view').prepend(breadcrumbsEl);
            }
        }
    }

    processBacklinks(file, result = []) {
        if (file && !this.isHome(file.path)) {
            let backlink;
            const backlinksObject = app.metadataCache.getBacklinksForFile(file).data;
            const backlinks = Object.keys(backlinksObject); // An array of paths with extensions

            // Add the currently opened file as a first element
            if (result.length === 0 && this.settings.displayCurrentFile) result.push(file.path);

            // Let's find out if we have a parent metadata for this file from
            // Dataview's inline fields or from Front Matter.
            // If so, it will take precedence over this file's backlinks
            backlink = this.getParentFromMetadata(file);

            // Next, ensure we have one or more backlinks
            if (backlink || backlinks.length) {
                // If we don't have a backlink from parent metadata,
                if (!backlink) {
                    // If there is more than one backlink, alert the
                    // user about the ambiguity of the ancestry
                    if (backlinks.length > 1 && this.settings.showNoticeOnAmbiguity) {
                        new Notice(`Backlinks Breadcrumbs:\nThe ancestry for "${file.basename}" is ambiguous!\nPlease specify it with parent:: Path-to-file`, 10000);
                    }

                    // Take the first backlink
                    backlink = backlinks[0]; // FIXME: This is naive, can we do better ?
                }

                // Add it in front of the result array
                result.unshift(backlink);

                // Continue recursively until at Home or reached the maximum depth
                if (!this.isHome(backlink) && result.length < Number(this.settings.maxDepth)) {
                    this.processBacklinks(this.getFileByPath(backlink), result);
                }
            }
        }
        return result;
    }

    getParentFromMetadata(file) {
        let parent;
        // Why use Dataview ? To be able to use inline fields as well as Front Matter
        const dataviewApi = app.plugins.plugins.dataview?.api;
        if (dataviewApi) {
            parent = dataviewApi.page(file.path)?.parent;
        } else {
            // No Dataview API, let's try Front Matter
            parent = app.metadataCache.getFileCache(file)?.frontmatter?.parent;
        }

        // Have we found a parent metadata ?
        if (parent) {
            const parentFile = this.getFileByPath(`${parent}.md`);
            // Ensure we have a valid parent path metadata
            if (parentFile) {
                return parentFile.path;
            }
        }

        return null;
    }

    isHome(path) {
        return path === `${this.settings.home}.md`;
    }

    getFileByPath(path) {
        return app.vault.getFiles().find(f => f.path === path);
    }

    generateBreadCrumbs(backlinks) {
        if (backlinks.length) {
            return backlinks.map(path => this.createLink(path));
        }
    }

    createLink(target) {
        const link = createEl('span', {
            cls: 'internal-link',
            attr: {
                style: 'cursor: var(--cursor-link);text-decoration: none;',
            },
        });
        link.innerText = this.getFileBaseNameFromPath(target);
        link.addEventListener('click', (e) => {
            openOrSwitch(target, e); // This async/await is useless
        });
        return link;
    }

    getFileBaseNameFromPath(path) {
        // Keep only the file name, without extension or path
        let name = path.substring(0, path.lastIndexOf('.')) || path;
        name = name.substring(name.lastIndexOf('/') + 1, name.length) || name;
        return name;
    }
}

module.exports = BacklinksBreadcrumbsPlugin;

// Cherry picked from Obsidian-community-lib #c9aeb89 for brevity, with light reformatting
// Source: https://github.com/obsidian-community/obsidian-community-lib/blob/3721e6f73c610c59a95c8f6eb9c361f625050353/dist/utils.js#L180
// Doc: https://obsidian-community.github.io/obsidian-community-lib/modules.html#openOrSwitch
// License: ISC
async function openOrSwitch(dest, event, options = { createNewFile: true }) {
    const { workspace } = app;
    let destFile = app.metadataCache.getFirstLinkpathDest(dest, "");
    // If dest doesn't exist, make it
    if (!destFile && options.createNewFile) {
        destFile = await createNewMDNote(dest);
    } else if (!destFile && !options.createNewFile) {
        return;
    }
    // Check if it's already open
    const leavesWithDestAlreadyOpen = [];
    // For all open leaves, if the leave's basename is equal to the link destination, rather activate that leaf instead of opening it in two panes
    workspace.iterateAllLeaves((leaf) => {
        var _a;
        if (leaf.view instanceof obsidian.MarkdownView) {
            const file = (_a = leaf.view) === null || _a === void 0 ? void 0 : _a.file;
            if (file && file.basename + "." + file.extension === dest) {
                leavesWithDestAlreadyOpen.push(leaf);
            }
        }
    });
    // Rather switch to it if it is open
    if (leavesWithDestAlreadyOpen.length > 0) {
        workspace.setActiveLeaf(leavesWithDestAlreadyOpen[0]);
    } else {
        const mode = app.vault.getConfig("defaultViewMode");
        const leaf = event.ctrlKey || event.getModifierState("Meta")
            ? workspace.splitActiveLeaf()
            : workspace.getUnpinnedLeaf();
            // This is not how a ternary operator should be used
        await leaf.openFile(destFile, { active: true, mode });
    }
}

class BacklinksBreadcrumbsSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;

        containerEl.empty();

        new obsidian.Setting(containerEl)
            .setName('Homepage')
            .setDesc('The name of the index or home file of your vault.')
            .addText(text => text
                .setPlaceholder(this.plugin.settings.home)
                .setValue(this.plugin.settings.home)
                .onChange(async (value) => {
                    this.plugin.settings.home = value;
                    this.plugin.drawBreadcrumbs();
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Separator')
            .setDesc('The glyph used to separate the breadcrumbs')
            .addText(text => text
                .setPlaceholder(this.plugin.settings.separator)
                .setValue(this.plugin.settings.separator)
                .onChange(async (value) => {
                    this.plugin.settings.separator = value;
                    this.plugin.drawBreadcrumbs();
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Maximum depth')
            .setDesc('The maximum depth the plugin will go up the backlinks chain from the current openend file to find Home.')
            .addText(text => text
                .setPlaceholder(this.plugin.settings.maxDepth)
                .setValue(this.plugin.settings.maxDepth)
                .onChange(async (value) => {
                    this.plugin.settings.maxDepth = value;
                    this.plugin.drawBreadcrumbs();
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Show current file')
            .setDesc('Add the current openend file at the end of the breadcrumbs')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.displayCurrentFile)
                .onChange(async (value) => {
                    this.plugin.settings.displayCurrentFile = value;
                    this.plugin.drawBreadcrumbs();
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Show notice if ambiguous ancestry')
            .setDesc('Display a notice if there is more than one backlink from the currently opened file. You can add the parent:: name_of_file metadata to lift this ambiguity.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showNoticeOnAmbiguity)
                .onChange(async (value) => {
                    this.plugin.settings.showNoticeOnAmbiguity = value;
                    await this.plugin.saveSettings();
                }));
    }
}
