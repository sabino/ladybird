/* Native adaptation of maxmilton/new-tab. SPDX-License-Identifier: MIT. See newtab-license.txt. */
"use strict";
(() => {
    const $ = id => document.getElementById(id);
    let data = null,
        filter = "all",
        query = "",
        folder = "",
        selected = -1;
    let limits = {},
        loading = false,
        serviceFailed = false,
        toastTimer;
    const sectionNames = {
        pins: "Pinned",
        bookmarks: "Bookmarks",
        tabs: "Open tabs",
        history: "Recent history",
        frequent: "Frequent sites",
        closed: "Recently closed pages",
    };
    const defaultSections = Object.keys(sectionNames);
    let draftSections = [],
        searchTimer,
        connected = false,
        requestId = 0;
    const pending = new Map();
    const icons = { star: "☆", pinned: "★" };

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function toast(message) {
        $("toast").textContent = message;
        $("toast").hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            $("toast").hidden = true;
        }, 3500);
    }

    function send(name, fields = {}) {
        return new Promise((resolve, reject) => {
            if (!connected) {
                reject(new Error("The native start page is not connected. Reload this tab."));
                return;
            }
            const id = ++requestId;
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error("Ladybird did not respond. Reload this tab."));
            }, 10000);
            pending.set(id, { resolve, reject, timer });
            ladybird.sendMessage(name, Object.assign({}, fields, { requestId: id }));
        });
    }

    function flattenBookmarks(tree, folders = [], output = []) {
        for (const item of tree || []) {
            if (item.type === "folder")
                flattenBookmarks(item.children, [...folders, item.title || "Untitled folder"], output);
            else {
                try {
                    const url = new URL(item.url);
                    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
                    output.push({
                        url: url.href,
                        title: item.title || url.hostname,
                        domain: url.hostname,
                        folder: folders.join(" / "),
                        icon: item.favicon ? "data:image/png;base64," + item.favicon : "",
                    });
                } catch (_) {
                    /* Ignore unsupported bookmark URLs. */
                }
            }
        }
        return output;
    }

    function normalize(payload) {
        return Object.assign({ history: [], tabs: [], closed: [], frequent: [], warnings: [] }, payload, {
            bookmarks: flattenBookmarks(payload.bookmarkTree),
        });
    }

    async function api(path, body) {
        if (path === "data") return normalize(await send("loadNewTab", { query }));
        if (path === "preferences") {
            const result = await send("saveNewTabSettings", { preferences: Object.assign({}, data.preferences, body) });
            return result.preferences;
        }
        return send("activateNewTabTarget", body);
    }

    document.addEventListener("WebUIMessage", event => {
        const message = event.detail;
        if (!["newTabData", "newTabSettingsSaved", "newTabTargetActivated"].includes(message.name)) return;
        const payload = message.data;
        const request = pending.get(payload.requestId);
        if (request) {
            clearTimeout(request.timer);
            pending.delete(payload.requestId);
            payload.error ? request.reject(new Error(payload.error)) : request.resolve(payload);
        } else if (message.name === "newTabData" && payload.query === query) {
            data = normalize(payload);
            render();
        }
    });

    function relativeTime(timestamp) {
        if (!timestamp) return "";
        const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
        if (minutes < 1) return "just now";
        if (minutes < 60) return minutes + "m ago";
        if (minutes < 1440) return Math.floor(minutes / 60) + "h ago";
        if (minutes < 10080) return Math.floor(minutes / 1440) + "d ago";
        return new Date(timestamp).toLocaleDateString();
    }

    function icon(item) {
        const holder = element("span", "initial", (item.domain || item.title || "?")[0]);
        if ((item.icon || "").startsWith("data:image/png;base64,")) {
            const image = document.createElement("img");
            image.alt = "";
            image.src = item.icon;
            image.addEventListener("load", () => {
                holder.textContent = "";
                holder.appendChild(image);
            });
        }
        return holder;
    }

    function pinItems() {
        return data.preferences.pins.map(pin => {
            const known =
                data.bookmarks.find(x => x.url === pin.url) || data.history.find(x => x.url === pin.url) || {};
            return Object.assign({}, known, pin, { domain: new URL(pin.url).hostname.replace(/^www\./, "") });
        });
    }

    function matches(item) {
        const haystack = [item.title, item.url, item.folder].join(" ").toLocaleLowerCase();
        return query
            .toLocaleLowerCase()
            .split(/\s+/)
            .filter(Boolean)
            .every(word => haystack.includes(word));
    }

    function filtered(items) {
        return query ? items.filter(matches) : items;
    }

    function row(item, kind) {
        const li = element("li", "link-row");
        const anchor = element(kind === "tabs" ? "button" : "a", "link-main");
        if (kind === "tabs") {
            anchor.type = "button";
            anchor.addEventListener("click", async event => {
                event.preventDefault();
                try {
                    await api("activate", { id: item.id });
                } catch (error) {
                    toast(error.message);
                    refresh();
                }
            });
        } else anchor.href = item.url;
        anchor.title = item.title + "\n" + item.url;
        anchor.appendChild(icon(item));
        const copy = element("span", "link-copy");
        copy.appendChild(element("span", "link-title", item.title || item.domain));
        const details = [item.domain];
        if (kind === "bookmarks" && item.folder) details.push(item.folder);
        if (kind === "tabs") details.push("Switch to tab");
        if ((kind === "history" || kind === "closed") && item.visited) details.push(relativeTime(item.visited));
        if (kind === "frequent") details.push(item.score + " visits");
        copy.appendChild(element("span", "link-detail", details.filter(Boolean).join(" · ")));
        anchor.appendChild(copy);
        li.appendChild(anchor);
        const pinned = data.preferences.pins.some(pin => pin.url === item.url);
        const button = element("button", "row-action" + (pinned ? " pinned" : ""), pinned ? icons.pinned : icons.star);
        button.type = "button";
        button.disabled = data.private || !/^https?:\/\//.test(item.url);
        button.title = pinned ? "Unpin shortcut" : "Pin shortcut";
        button.setAttribute("aria-label", button.title + ": " + item.title);
        button.addEventListener("click", async () => {
            if (!pinned && data.preferences.pins.length >= 100) {
                toast("Remove a shortcut before adding another. The limit is 100.");
                return;
            }
            button.disabled = true;
            const pins = data.preferences.pins.filter(pin => pin.url !== item.url);
            if (!pinned) pins.push({ url: item.url, title: item.title });
            try {
                data.preferences = await api("preferences", { pins });
                render();
                toast(pinned ? "Shortcut unpinned" : "Shortcut pinned");
            } catch (error) {
                button.disabled = false;
                toast(error.message);
            }
        });
        li.appendChild(button);
        return li;
    }

    function showPinEditor() {
        $("pin-editor").hidden = false;
        $("pin-message").textContent = "";
        $("pin-name").focus();
    }

    function section(kind, items, note) {
        const container = element("section", "section");
        container.dataset.section = kind;
        const heading = element("div", "section-heading");
        const title = element("h2", "", sectionNames[kind]);
        title.appendChild(element("span", "count", String(items.length)));
        heading.appendChild(title);
        if (kind === "pins") {
            const add = element("button", "quiet", "+ Add shortcut");
            add.disabled = data.private;
            add.addEventListener("click", showPinEditor);
            heading.appendChild(add);
        }
        if (kind === "bookmarks" && data.bookmarks.length) {
            const picker = element("select", "folder-select");
            picker.setAttribute("aria-label", "Bookmark folder");
            picker.appendChild(new Option("All folders", ""));
            [...new Set(data.bookmarks.map(x => x.folder || "Unfiled"))]
                .sort()
                .forEach(name => picker.appendChild(new Option(name, name)));
            picker.value = folder;
            picker.addEventListener("change", () => {
                folder = picker.value;
                limits = {};
                render();
            });
            heading.appendChild(picker);
        }
        container.appendChild(heading);
        if (note) container.appendChild(element("p", "section-note", note));
        if (!items.length) {
            const messages = {
                pins: "Pin a link with ☆, or add your own shortcut.",
                bookmarks: "Save bookmarks with Ladybird’s star button. They appear here automatically.",
                history: "Pages you visit in Ladybird will appear here.",
                tabs: "No other open tabs to show.",
                closed: "Recently closed pages will appear here.",
                frequent: "Your frequently visited sites will appear as you browse.",
            };
            container.appendChild(element("p", "empty", query || folder ? "No matching links." : messages[kind]));
            return container;
        }
        const limit = limits[kind] || (query || filter !== "all" ? 30 : data.preferences.rowsPerSection);
        const list = element("ul", "link-list");
        items.slice(0, limit).forEach(item => list.appendChild(row(item, kind)));
        container.appendChild(list);
        if (items.length > limit) {
            const more = element("button", "more", "Show more (" + (items.length - limit) + " remaining)");
            more.addEventListener("click", () => {
                limits[kind] = limit + 30;
                render();
            });
            container.appendChild(more);
        }
        return container;
    }

    function webSearchURL(text) {
        return data.searchURL.replaceAll("%s", encodeURIComponent(text));
    }

    function renderFilters() {
        const bar = $("filters");
        bar.textContent = "";
        for (const kind of ["all", ...data.preferences.sections]) {
            const button = element(
                "button",
                kind === filter ? "active" : "",
                kind === "all"
                    ? "All"
                    : { history: "History", tabs: "Tabs", frequent: "Frequent", closed: "Closed" }[kind] ||
                          sectionNames[kind]
            );
            button.dataset.filter = kind;
            button.setAttribute("aria-pressed", String(kind === filter));
            bar.appendChild(button);
        }
    }

    function render() {
        if (!data) return;
        document.documentElement.classList.toggle("blank", !data.preferences.enabled);
        document.documentElement.dataset.theme = data.preferences.theme;
        $("private-note").hidden = !data.private;
        if (filter !== "all" && !data.preferences.sections.includes(filter)) filter = "all";
        renderFilters();
        selected = -1;
        const content = $("content");
        content.textContent = "";
        const groups = {
            pins: filtered(pinItems()),
            bookmarks: filtered(data.bookmarks).filter(x => !folder || (x.folder || "Unfiled") === folder),
            history: filtered(data.history),
            tabs: filtered(data.tabs),
            closed: filtered(data.closed),
            frequent: filtered(data.frequent),
        };
        const kinds = filter === "all" ? data.preferences.sections : [filter];
        if (!kinds.length) {
            content.appendChild(
                element("p", "empty", "All sections are hidden. Use Customize to choose what appears here.")
            );
        }
        let count = 0;
        kinds.forEach(kind => {
            count += groups[kind].length;
            if (query && !groups[kind].length) return;
            const note =
                kind === "tabs"
                    ? "Click to switch to the existing tab, including tabs in another window."
                    : kind === "closed"
                      ? "Reopen the page URL; form state is not restored."
                      : null;
            content.appendChild(section(kind, groups[kind], note));
        });
        if (query) {
            if (data.searchURL) {
                const search = element("a", "web-search more", "Search the web for “" + query + "”");
                search.href = webSearchURL(query);
                content.appendChild(search);
            }
            $("status").textContent = count + (count === 1 ? " matching link" : " matching links");
        } else {
            $("status").textContent =
                data.bookmarks.length + " bookmarks · " + data.history.length + " history entries";
        }
        if (data.historyHasMore && (filter === "all" || filter === "history")) {
            const more = element("a", "more", "View full browsing history");
            more.href = "about:history";
            content.appendChild(more);
        }
        renderBar();
        $("warnings").hidden = !data.warnings.length;
        $("warnings").textContent = data.warnings.join(" ");
        $("freshness").textContent =
            "Updated " + new Date(data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function renderBar() {
        const bar = $("bookmark-bar");
        bar.hidden = !data.preferences.showBookmarksBar;
        bar.textContent = "";
        data.bookmarks.slice(0, 60).forEach(item => {
            const link = document.createElement("a");
            link.href = item.url;
            link.title = [item.folder, item.title, item.url].filter(Boolean).join("\n");
            link.appendChild(icon(item));
            link.appendChild(element("span", "bookmark-label", item.title));
            bar.appendChild(link);
        });
        if (!data.bookmarks.length)
            bar.appendChild(element("span", "hint", "Your Ladybird bookmarks will appear here"));
    }

    async function refresh(manual = false) {
        if (loading || !connected) return;
        const requestedQuery = query;
        loading = true;
        $("refresh").disabled = true;
        try {
            const next = await api("data");
            if (next.query !== query) return;
            const changed =
                !data ||
                JSON.stringify(Object.assign({}, data, { updatedAt: 0, requestId: 0 })) !==
                    JSON.stringify(Object.assign({}, next, { updatedAt: 0, requestId: 0 }));
            data = next;
            if (changed || manual || serviceFailed) render();
            serviceFailed = false;
            if (manual) toast("Bookmarks and history refreshed");
            document.documentElement.dataset.ready = "true";
        } catch (error) {
            serviceFailed = true;
            $("warnings").hidden = false;
            $("warnings").textContent = "Could not load the native start page. Reload this tab to retry.";
            if (!data) $("status").textContent = "Your links are temporarily unavailable.";
        } finally {
            loading = false;
            $("refresh").disabled = false;
            if (requestedQuery !== query) refresh();
        }
    }

    function openSettings() {
        if (!data) return;
        const prefs = data.preferences;
        $("theme").value = prefs.theme;
        $("rows-per-section").value = String(prefs.rowsPerSection);
        $("show-bookmarks-bar").checked = prefs.showBookmarksBar;
        draftSections = prefs.sectionOrder.map(name => ({ name, enabled: prefs.sections.includes(name) }));
        renderSectionOrder();
        $("settings-form")
            .querySelectorAll('input, select, button[type="submit"], #reset-layout')
            .forEach(control => {
                control.disabled = data.private;
            });
        $("settings-message").textContent = data.private ? "Customize shortcuts and layout from a regular window." : "";
        $("settings").hidden = false;
        $("settings-button").setAttribute("aria-expanded", "true");
        $("theme").focus();
    }

    function renderSectionOrder() {
        const list = $("section-order");
        list.textContent = "";
        draftSections.forEach((item, index) => {
            const li = element("li", "order-row");
            const label = element("label", "check");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = item.enabled;
            checkbox.disabled = data.private;
            checkbox.addEventListener("change", () => {
                item.enabled = checkbox.checked;
            });
            label.append(checkbox, document.createTextNode(sectionNames[item.name]));
            li.appendChild(label);
            for (const [delta, caption] of [
                [-1, "↑"],
                [1, "↓"],
            ]) {
                const button = element("button", "", caption);
                button.type = "button";
                button.disabled = data.private || index + delta < 0 || index + delta >= draftSections.length;
                button.setAttribute("aria-label", "Move " + sectionNames[item.name] + (delta < 0 ? " up" : " down"));
                button.addEventListener("click", () => {
                    const [moved] = draftSections.splice(index, 1);
                    draftSections.splice(index + delta, 0, moved);
                    renderSectionOrder();
                    list.children[index + delta].querySelector("input").focus();
                });
                li.appendChild(button);
            }
            list.appendChild(li);
        });
    }
    $("reset-layout").addEventListener("click", () => {
        draftSections = defaultSections.map(name => ({ name, enabled: true }));
        $("rows-per-section").value = "6";
        renderSectionOrder();
    });

    $("refresh").addEventListener("click", () => refresh(true));
    $("settings-button").addEventListener("click", () =>
        $("settings").hidden ? openSettings() : $("settings-close").click()
    );
    $("settings-close").addEventListener("click", () => {
        $("settings").hidden = true;
        $("settings-button").setAttribute("aria-expanded", "false");
        $("settings-button").focus();
    });
    $("pin-close").addEventListener("click", () => {
        $("pin-editor").hidden = true;
        $("search").focus();
    });
    $("search").addEventListener("input", () => {
        query = $("search").value.trim();
        limits = {};
        render();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(refresh, 160);
    });
    $("filters").addEventListener("click", event => {
        const button = event.target.closest("[data-filter]");
        if (!button) return;
        filter = button.dataset.filter;
        limits = {};
        render();
    });
    $("search-form").addEventListener("submit", event => {
        event.preventDefault();
        if (!data) return;
        const links = [...document.querySelectorAll("#content .link-main")];
        if (selected >= 0 && links[selected]) {
            links[selected].click();
            return;
        }
        if (links.length && query) {
            links[0].click();
            return;
        }
        if (query && data.searchURL) location.href = webSearchURL(query);
    });
    function moveSelection(key) {
        const links = [...document.querySelectorAll("#content .link-main")];
        if (!links.length) return;
        selected =
            selected < 0
                ? key === "ArrowDown"
                    ? 0
                    : links.length - 1
                : (selected + (key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
        document.querySelectorAll(".link-row.selected").forEach(node => node.classList.remove("selected"));
        links[selected].parentElement.classList.add("selected");
        // Keep typing and Enter available after browsing from elsewhere on the page.
        $("search").focus({ preventScroll: true });
        links[selected].scrollIntoView({ block: "nearest" });
    }
    document.addEventListener("keydown", event => {
        if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        const active = document.activeElement;
        const searching = active === $("search");
        const editing =
            active && (["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName) || active.isContentEditable);
        const panelOpen = !$("settings").hidden || !$("pin-editor").hidden;
        if (event.key === "Escape") {
            if (!$("settings").hidden) $("settings-close").click();
            else if (!$("pin-editor").hidden) $("pin-close").click();
            else {
                $("search").value = "";
                query = "";
                limits = {};
                render();
                refresh();
            }
            event.preventDefault();
            return;
        }
        if (panelOpen || (editing && !searching)) return;
        if (event.key === "/" && (!searching || !$("search").value)) {
            event.preventDefault();
            $("search").focus();
        } else if (["ArrowDown", "ArrowUp"].includes(event.key) && !event.shiftKey) {
            event.preventDefault();
            moveSelection(event.key);
        } else if (
            event.key === "Enter" &&
            selected >= 0 &&
            (searching || active === document.body || active === document.documentElement)
        ) {
            event.preventDefault();
            const link = document.querySelectorAll("#content .link-main")[selected];
            if (link) link.click();
        }
    });
    $("settings-form").addEventListener("submit", async event => {
        event.preventDefault();
        const button = event.target.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            data.preferences = await api("preferences", {
                theme: $("theme").value,
                rowsPerSection: Number($("rows-per-section").value),
                showBookmarksBar: $("show-bookmarks-bar").checked,
                sections: draftSections.filter(item => item.enabled).map(item => item.name),
                sectionOrder: draftSections.map(item => item.name),
            });
            render();
            await refresh();
            $("settings-message").textContent = "Saved";
            toast("Settings saved");
        } catch (error) {
            $("settings-message").textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
    $("pin-form").addEventListener("submit", async event => {
        event.preventDefault();
        const button = event.target.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const url = new URL($("pin-url").value);
            if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
                throw new Error("Use an HTTP or HTTPS website address without a username or password.");
            if (data.preferences.pins.some(pin => pin.url === url.href))
                throw new Error("This website is already pinned.");
            if (data.preferences.pins.length >= 100)
                throw new Error("Remove a shortcut before adding another. The limit is 100.");
            data.preferences = await api("preferences", {
                pins: [...data.preferences.pins, { title: $("pin-name").value, url: url.href }],
            });
            event.target.reset();
            $("pin-editor").hidden = true;
            render();
            toast("Shortcut saved");
        } catch (error) {
            $("pin-message").textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
    window.addEventListener("focus", () => refresh());
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) refresh();
    });
    setInterval(() => {
        if (!document.hidden && $("settings").hidden && $("pin-editor").hidden) refresh();
    }, 5000);
    // Browsers pause/resume timers around their back-forward cache. Do not clear
    // this on pagehide: a restored start page must keep refreshing its sources.
    document.addEventListener("WebUILoaded", () => {
        connected = true;
        refresh();
        $("search").focus();
    });
})();
