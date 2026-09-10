/*
 * Copyright (c) 2026, Sabino.
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

#pragma once

#include <LibWebView/BookmarkStore.h>
#include <LibWebView/Settings.h>
#include <LibWebView/WebUI.h>

namespace WebView {

class NewTabUI final
    : public WebUI
    , public SettingsObserver
    , public BookmarkStoreObserver {
    WEB_UI(NewTabUI);

private:
    virtual void register_interfaces() override;
    virtual void new_tab_settings_changed() override { send_data(); }
    virtual void bookmarks_changed() override { send_data(); }
    bool is_active_page() const;
    void send_data(i64 request_id = 0);
    void save_settings(JsonValue const&);
    void activate_tab(JsonValue const&);
    String m_query;
};

}
