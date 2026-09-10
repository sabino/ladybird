/*
 * Copyright (c) 2026, Sabino.
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

#include <AK/Base64.h>
#include <AK/JsonArray.h>
#include <AK/JsonObject.h>
#include <LibURL/InternalURLs.h>
#include <LibURL/Parser.h>
#include <LibWebView/Application.h>
#include <LibWebView/FaviconStore.h>
#include <LibWebView/HistoryStore.h>
#include <LibWebView/SessionStore.h>
#include <LibWebView/ViewImplementation.h>
#include <LibWebView/WebContentClient.h>
#include <LibWebView/WebUI/NewTabUI.h>

#include <algorithm>

namespace WebView {

static bool is_web_url(URL::URL const& url)
{
    return url.scheme().is_one_of("http"sv, "https"sv) && url.username().is_empty() && url.password().is_empty();
}

static JsonObject link(URL::URL const& url, String const& title)
{
    JsonObject item;
    item.set("url"sv, url.serialize());
    item.set("title"sv, title.is_empty() ? url.serialized_host() : title);
    item.set("domain"sv, url.serialized_host());
    return item;
}

static void add_icon(JsonObject& item, Optional<ByteBuffer> const& png)
{
    if (!png.has_value())
        return;
    if (auto encoded = encode_base64(png->bytes()); !encoded.is_error())
        item.set("icon"sv, MUST(String::formatted("data:image/png;base64,{}", encoded.value())));
}

bool NewTabUI::is_active_page() const
{
    auto source = view();
    // Revalidate the owner on every request. A saved IPC reference must not grant
    // access after this tab navigates or moves to a replacement renderer.
    return source.has_value() && &source->client() == &client() && source->url() == URL::about_newtab();
}

void NewTabUI::register_interfaces()
{
    register_interface("loadNewTab"sv, [this](JsonValue const& data) {
        if (!data.is_object() || !is_active_page())
            return;
        auto query = data.as_object().get_string("query"sv).value_or(String {});
        if (query.bytes().size() > 2000)
            return;
        m_query = move(query);
        send_data(data.as_object().get_integer<i64>("requestId"sv).value_or(0));
    });
    register_interface("saveNewTabSettings"sv, [this](JsonValue const& data) { save_settings(data); });
    register_interface("activateNewTabTarget"sv, [this](JsonValue const& data) { activate_tab(data); });
}

void NewTabUI::send_data(i64 request_id)
{
    if (!is_active_page())
        return;
    auto const& settings = Application::settings();
    auto const& preferences = settings.new_tab_settings();
    auto is_private = client().is_private();
    JsonObject result;
    result.set("requestId"sv, request_id);
    result.set("query"sv, m_query);
    result.set("preferences"sv, preferences);
    result.set("private"sv, is_private == IsPrivate::Yes);
    result.set("updatedAt"sv, UnixDateTime::now().milliseconds_since_epoch());
    if (auto const& engine = settings.search_engine(); engine.has_value())
        result.set("searchURL"sv, engine->query_url);

    auto enabled = [&](StringView name) {
        auto const& sections = preferences.as_object().get_array("sections"sv).value();
        for (auto const& section : sections.values()) {
            if (section.as_string() == name)
                return settings.enhanced_new_tab_page_enabled();
        }
        return false;
    };

    // Shared bookmarks and explicit shortcuts are available in private windows;
    // history, live tabs, favicons, and closed pages use the requesting context.
    if (settings.enhanced_new_tab_page_enabled() && (enabled("bookmarks"sv) || preferences.as_object().get_bool("showBookmarksBar"sv).value_or(false)))
        result.set("bookmarkTree"sv, Application::bookmark_store().serialize_items(Application::favicon_store(IsPrivate::No)));
    else
        result.set("bookmarkTree"sv, JsonArray {});

    JsonArray history;
    if (enabled("history"sv)) {
        auto entries = Application::history_store(is_private).list_entries(m_query, 0, 501);
        result.set("historyHasMore"sv, entries.size() > 500);
        if (entries.size() > 500)
            entries.resize(500);
        for (auto const& entry : entries) {
            auto url = URL::Parser::basic_parse(entry.url);
            if (!url.has_value() || !is_web_url(*url))
                continue;
            auto item = link(*url, entry.title.value_or(String {}));
            item.set("visited"sv, entry.last_visited_time.milliseconds_since_epoch());
            item.set("visits"sv, entry.visit_count);
            add_icon(item, entry.favicon_png);
            history.must_append(move(item));
        }
    }
    result.set("history"sv, move(history));

    JsonArray frequent;
    if (enabled("frequent"sv)) {
        struct Site {
            String host;
            URL::URL url;
            i64 visits { 0 };
            Optional<ByteBuffer> icon;
        };
        Vector<Site> sites;
        HashMap<String, size_t> indexes;
        for (auto const& entry : Application::history_store(is_private).list_entries({}, 0, 2000)) {
            auto url = URL::Parser::basic_parse(entry.url);
            if (!url.has_value() || !is_web_url(*url))
                continue;
            auto host = url->serialized_host();
            auto index = indexes.get(host).value_or(sites.size());
            if (index == sites.size()) {
                auto home = URL::Parser::basic_parse("/"sv, *url);
                if (!home.has_value())
                    continue;
                indexes.set(host, index);
                sites.append({ host, home.release_value(), 0, entry.favicon_png });
            }
            sites[index].visits += entry.visit_count;
        }
        std::stable_sort(sites.begin(), sites.end(), [](auto const& left, auto const& right) { return left.visits > right.visits; });
        for (size_t index = 0; index < min(sites.size(), 40uz); ++index) {
            auto item = link(sites[index].url, sites[index].host);
            item.set("score"sv, sites[index].visits);
            add_icon(item, sites[index].icon);
            frequent.must_append(move(item));
        }
    }
    result.set("frequent"sv, move(frequent));

    JsonArray tabs;
    if (enabled("tabs"sv)) {
        ViewImplementation::for_each_view([&](ViewImplementation& target) {
            if (target.is_private() != is_private || target.url() == URL::about_newtab() || !target.on_activate_tab)
                return IterationDecision::Continue;
            auto item = link(target.url(), target.title().to_utf8());
            item.set("id"sv, target.view_id());
            if (target.favicon_hash().has_value())
                add_icon(item, Application::favicon_store(is_private).favicon_png(*target.favicon_hash()));
            tabs.must_append(move(item));
            return IterationDecision::Continue;
        });
    }
    result.set("tabs"sv, move(tabs));

    JsonArray closed;
    if (enabled("closed"sv)) {
        for (auto const& url : Application::session_store(is_private).recently_closed_urls()) {
            if (!is_web_url(url))
                continue;
            auto entry = Application::history_store(is_private).entry_for_url(url);
            auto item = link(url, entry.has_value() ? entry->title.value_or(String {}) : String {});
            if (entry.has_value())
                add_icon(item, entry->favicon_png);
            closed.must_append(move(item));
        }
    }
    result.set("closed"sv, move(closed));
    async_send_message("newTabData"sv, move(result));
}

void NewTabUI::save_settings(JsonValue const& data)
{
    if (!is_active_page() || !data.is_object())
        return;
    JsonObject result;
    result.set("requestId"sv, data.as_object().get_integer<i64>("requestId"sv).value_or(0));
    auto preferences = data.as_object().get_object("preferences"sv);
    if (client().is_private() == IsPrivate::Yes)
        result.set("error"sv, "Customize shortcuts and layout from a regular window."sv);
    else if (!preferences.has_value())
        result.set("error"sv, "Invalid new-tab settings."sv);
    else {
        Application::settings().set_new_tab_settings(*preferences);
        result.set("preferences"sv, Application::settings().new_tab_settings());
    }
    async_send_message("newTabSettingsSaved"sv, move(result));
}

void NewTabUI::activate_tab(JsonValue const& data)
{
    if (!is_active_page() || !data.is_object())
        return;
    JsonObject result;
    result.set("requestId"sv, data.as_object().get_integer<i64>("requestId"sv).value_or(0));
    auto id = data.as_object().get_integer<u64>("id"sv);
    auto target = id.has_value() ? ViewImplementation::find_view_by_id(*id) : Optional<ViewImplementation&> {};
    if (!Application::settings().enhanced_new_tab_page_enabled() || !target.has_value() || target->is_private() != client().is_private() || !target->on_activate_tab)
        result.set("error"sv, "This tab is no longer available in this window type."sv);
    else {
        target->on_activate_tab();
        result.set("ok"sv, true);
    }
    async_send_message("newTabTargetActivated"sv, move(result));
}

}
