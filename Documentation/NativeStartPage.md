# Native start page (personal fork)

The `native-start-page` branch adds a native `about:newtab` interface based on
Max Milton’s New Tab layout. The HTML, CSS, and JavaScript are bundled Ladybird
resources; browser data comes through the existing WebUI IPC transport. There is
no HTTP server, port, sync service, or Microsoft Edge integration.

## Controls

The enhanced page is enabled by default. General browser settings has a switch
for a blank or enhanced `about:newtab`. In enhanced mode, opening a new tab focuses
search. Slash focuses search; Up/Down selects results and Enter opens them.
Ctrl+L still focuses the browser address bar. Web search respects the selected
browser search engine and stays disabled if no engine is selected.

Customize offers section ordering, visibility checkboxes, rows per section,
a bookmark bar, and themes. Hidden sections keep their position when re-enabled.
All sections can be hidden, leaving web search and
customization available. Shortcuts and preferences use Ladybird’s Settings.json.

Tabs are live browser views and click activates the existing tab by stable ID,
including its window. Closed pages reopen their URLs; they do not restore forms.
Normal and private tabs and sessions are kept separate. Private windows do not
read normal browsing history or persist new shortcuts/layout changes. Existing
explicit shortcuts and bookmarks are shared, like the browser’s bookmark UI.

History search uses the browser store, with up to 500 results for each query.
Frequent sites aggregate visits from up to 2,000 recent URL records. Disabled
sections are omitted from the page and its search results. Bookmarks can still
appear in the independently enabled bookmark bar.

## Build

System dependencies are listed in BuildInstructionsLadybird.md. On this laptop
use `omarchy pkg add` for missing Arch packages. Rust 1.98.0 is pinned in both
rust-toolchain.toml and mise.toml.

```sh
mise install
mise exec -- ./Meta/ladybird.py build -j 4 Ladybird
mise exec -- ./Meta/ladybird.py run --no-build
```

The four-job limit keeps resource use reasonable on this laptop. Ccache is enabled
when installed. Keep Build/caches to reuse dependencies; deleting Build/release
requires rebuilding the browser. Do not run builds as root.

To install only the browser runtime in your home directory:

```sh
cmake --install Build/release --component ladybird_Runtime --strip \
  --prefix "$HOME/.local/opt/ladybird-native"
```

The installed runtime includes its helper processes, shared libraries, and bundled
resources. Keep the unstripped build outputs if you want symbols for debugging.
Run TestNewTabSettings and TestSessionStore after building those targets.

## Implementation boundaries

NewTabUI binds to its owning page and rechecks the current about:newtab URL and
renderer before handling each request. Tab activation revalidates the live view
and private context. It does not provide a general JavaScript execution or file
access API. The page’s CSP forbids network connections, object embeds, and form
submissions; external sites are reached through deliberate link navigation.

Relevant tests include TestNewTabSettings, TestSessionStore, and native browser
interaction checks. This is a personal fork; no upstream PR is being opened.
